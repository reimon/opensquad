import type { Plugin, ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { watch as chokidarWatch } from "chokidar";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SquadInfo, SquadState, WsMessage } from "../types/state";

function resolveSquadsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "../squads"),  // started from dashboard/
    path.resolve(process.cwd(), "squads"),     // started from project root
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), "../squads"); // default (will be created on demand)
}

async function discoverSquads(squadsDir: string): Promise<SquadInfo[]> {
  let entries;
  try {
    entries = await fsp.readdir(squadsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const squads: SquadInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

    const yamlPath = path.join(squadsDir, entry.name, "squad.yaml");
    try {
      const raw = await fsp.readFile(yamlPath, "utf-8");
      const parsed = parseYaml(raw);
      const s = parsed?.squad;
      if (s) {
        squads.push({
          code: typeof s.code === "string" ? s.code : entry.name,
          name: typeof s.name === "string" ? s.name : entry.name,
          description: typeof s.description === "string" ? s.description : "",
          icon: typeof s.icon === "string" ? s.icon : "\u{1F4CB}",
          agents: Array.isArray(s.agents) ? (s.agents as unknown[]).filter((a): a is string => typeof a === "string") : [],
        });
        continue;
      }
    } catch {
      // No squad.yaml or invalid YAML — fall through to default
    }

    squads.push({
      code: entry.name,
      name: entry.name,
      description: "",
      icon: "\u{1F4CB}",
      agents: [],
    });
  }

  return squads;
}

function isValidState(data: unknown): data is SquadState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.status === "string" &&
    d.step != null && typeof d.step === "object" &&
    Array.isArray(d.agents)
  );
}

async function readActiveStates(squadsDir: string): Promise<Record<string, SquadState>> {
  const states: Record<string, SquadState> = {};

  let entries;
  try {
    entries = await fsp.readdir(squadsDir, { withFileTypes: true });
  } catch {
    return states;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(squadsDir, entry.name, "state.json");

    try {
      const raw = await fsp.readFile(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) {
        states[entry.name] = parsed;
      }
    } catch {
      // Skip missing or invalid JSON
    }
  }

  return states;
}

async function buildSnapshot(squadsDir: string): Promise<WsMessage> {
  return {
    type: "SNAPSHOT",
    squads: await discoverSquads(squadsDir),
    activeStates: await readActiveStates(squadsDir),
  };
}

function broadcast(wss: WebSocketServer, msg: WsMessage) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch {
        // Client connection dying — ws library will clean it up
      }
    }
  }
}

export function squadWatcherPlugin(): Plugin {
  return {
    name: "squad-watcher",
    configureServer(server: ViteDevServer) {
      if (!server.httpServer) {
        server.config.logger.warn("[squad-watcher] no httpServer — skipping");
        return;
      }

      const squadsDir = resolveSquadsDir();
      server.config.logger.info(`[squad-watcher] squads dir: ${squadsDir}`);

      // Create WebSocket server with noServer to avoid intercepting Vite's HMR
      const wss = new WebSocketServer({ noServer: true });
      (server.httpServer as Server).on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (req.url === "/__squads_ws") {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
        // Let Vite handle all other upgrade requests (HMR)
      });

      // Send snapshot on new connection
      wss.on("connection", async (ws) => {
        try {
          const snap = await buildSnapshot(squadsDir);
          ws.send(JSON.stringify(snap));
        } catch {
          // Connection may have closed before snapshot was ready
        }
      });

      // Ensure squads directory exists
      fsp.mkdir(squadsDir, { recursive: true }).catch((err) => {
        server.config.logger.error(`[squad-watcher] failed to create squads dir: ${err.message}`);
      });

      const CONTENT_TYPES: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".yaml": "text/yaml; charset=utf-8",
        ".yml": "text/yaml; charset=utf-8",
      };

      function getSquadNameFromUrl(reqUrl: string, host: string | undefined): string | undefined {
        const urlObj = new URL(reqUrl, `http://${host ?? "localhost"}`);
        return urlObj.pathname.split("/")[3] || undefined;
      }

      function isInsideSquad(resolvedPath: string, squadName: string): boolean {
        const root = path.resolve(squadsDir, squadName);
        const rootWithSep = root + path.sep;
        return resolvedPath === root || resolvedPath.startsWith(rootWithSep);
      }

      // REST API fallback and Checkpoint POST
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/api/checkpoint/") && req.method === "POST") {
          const squadName = getSquadNameFromUrl(req.url, req.headers.host);
          if (!squadName) {
            res.writeHead(400);
            return res.end("Missing squad name");
          }

          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", async () => {
            try {
              const data = JSON.parse(body);
              const responsePath = path.join(squadsDir, squadName, "checkpoint_response.json");
              await fsp.writeFile(responsePath, JSON.stringify(data, null, 2), "utf-8");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              server.config.logger.error(`[squad-watcher] failed to save checkpoint response for ${squadName}: ${(err as Error).message}`);
              res.writeHead(500);
              res.end("Failed to save response");
            }
          });
          return;
        }

        if (req.url?.startsWith("/api/squad-file/") && req.method === "GET") {
          const urlObj = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
          const squadName = urlObj.pathname.split("/")[3];
          const relativePath = urlObj.searchParams.get("path");
          if (!squadName || !relativePath) {
            res.writeHead(400);
            return res.end("Missing squad name or file path");
          }

          const resolvedPath = path.resolve(squadsDir, squadName, relativePath);
          // Sandbox check — resolvedPath must be inside squads/{squadName}/ (with trailing separator)
          if (!isInsideSquad(resolvedPath, squadName)) {
            res.writeHead(403);
            return res.end("Forbidden: Directory traversal attempt");
          }

          try {
            const stats = await fsp.stat(resolvedPath);
            if (!stats.isFile()) {
              res.writeHead(400);
              return res.end("Requested path is not a file");
            }

            const ext = path.extname(resolvedPath).toLowerCase();
            const contentType = CONTENT_TYPES[ext] ?? "text/plain; charset=utf-8";

            const data = await fsp.readFile(resolvedPath);
            res.writeHead(200, {
              "Content-Type": contentType,
              "Content-Length": data.length,
            });
            res.end(data);
          } catch (err) {
            res.writeHead(404);
            res.end("File not found");
          }
          return;
        }

        if (req.url?.startsWith("/api/squad-settings/") && req.method === "GET") {
          const squadName = getSquadNameFromUrl(req.url, req.headers.host);
          if (!squadName) {
            res.writeHead(400);
            return res.end("Missing squad name");
          }
          const settingsPath = path.join(squadsDir, squadName, "settings.json");
          try {
            const raw = await fsp.readFile(settingsPath, "utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(raw);
          } catch {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
          }
          return;
        }

        if (req.url?.startsWith("/api/squad-settings/") && req.method === "POST") {
          const squadName = getSquadNameFromUrl(req.url, req.headers.host);
          if (!squadName) {
            res.writeHead(400);
            return res.end("Missing squad name");
          }
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", async () => {
            try {
              const data = JSON.parse(body);
              const settingsPath = path.join(squadsDir, squadName, "settings.json");
              await fsp.writeFile(settingsPath, JSON.stringify(data, null, 2), "utf-8");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              server.config.logger.error(`[squad-watcher] failed to save settings for ${squadName}: ${(err as Error).message}`);
              res.writeHead(500);
              res.end("Failed to save settings");
            }
          });
          return;
        }

        if (req.url !== "/api/snapshot") return next();
        try {
          const snapshot = await buildSnapshot(squadsDir);
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify(snapshot));
        } catch {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });

      // File watcher using chokidar — reliable cross-platform, handles partial writes
      const watcher = chokidarWatch(squadsDir, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
        ignored: [/(^|[/\\])\./, /node_modules/, /output[/\\]/],
        depth: 2,
      });

      function handleFileChange(filePath: string) {
        const relative = path.relative(squadsDir, filePath).replace(/\\/g, "/");
        const parts = relative.split("/");
        if (parts.length < 2) return;

        const squadName = parts[0];
        const fileName = parts[1];

        if (fileName === "state.json") {
          fsp.readFile(filePath, "utf-8").then((raw) => {
            const parsed = JSON.parse(raw);
            if (!isValidState(parsed)) return;
            broadcast(wss, { type: "SQUAD_UPDATE", squad: squadName, state: parsed });
          }).catch(() => {
            // Invalid JSON — next change event will retry
          });
        } else if (fileName === "squad.yaml") {
          buildSnapshot(squadsDir).then((snap) => broadcast(wss, snap));
        }
      }

      function handleFileRemoval(filePath: string) {
        const relative = path.relative(squadsDir, filePath).replace(/\\/g, "/");
        const parts = relative.split("/");
        if (parts.length < 2) return;

        const squadName = parts[0];
        const fileName = parts[1];

        if (fileName === "state.json") {
          broadcast(wss, { type: "SQUAD_INACTIVE", squad: squadName });
        } else if (fileName === "squad.yaml") {
          buildSnapshot(squadsDir).then((snap) => broadcast(wss, snap));
        }
      }

      watcher.on("add", handleFileChange);
      watcher.on("change", handleFileChange);
      watcher.on("unlink", handleFileRemoval);

      server.httpServer.on("close", () => {
        watcher.close();
      });
    },
  };
}

