/**
 * state.js — Pipeline state writer for the Opensquad dashboard.
 *
 * Implements the state.json contract defined in runner.pipeline.md.
 * squads/{name}/state.json is the live feed — the dashboard watches this file.
 * At run completion it is copied to squads/{name}/output/{runId}/state.json
 * (permanent history) and then deleted from the squad root.
 */

import { readFile, writeFile, mkdir, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

// ─────────────────────────────────────────────────────────────
// CSV parser (header row required)
// ─────────────────────────────────────────────────────────────

function parseCsv(raw) {
  const lines = raw
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

// ─────────────────────────────────────────────────────────────
// Agent builder from squad-party.csv
// ─────────────────────────────────────────────────────────────

/**
 * Parse squad-party.csv and build the agents array for state.json.
 * Desk positions follow the runner spec: col=(i%3)+1, row=floor(i/3)+1
 *
 * @param {string} squadDir  Absolute path to squads/{name}/
 * @returns {Promise<Array>} agents array
 */
export async function buildAgentsFromParty(squadDir) {
  const csvPath = join(squadDir, "squad-party.csv");
  const raw = await readFile(csvPath, "utf-8");
  const rows = parseCsv(raw);

  return rows.map((row, i) => {
    // id: strip ./agents/ prefix and .agent.md suffix from path column
    const rawPath = row.path ?? "";
    const id = rawPath.replace(/^\.\/agents\//, "").replace(/\.agent\.md$/, "");

    return {
      id: id || row.agent_id || String(i),
      name: row.name ?? row.displayName ?? id,
      icon: row.icon ?? "",
      status: "idle",
      gender: row.gender ?? "female",
      desk: {
        col: (i % 3) + 1,
        row: Math.floor(i / 3) + 1,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Low-level write helper
// ─────────────────────────────────────────────────────────────

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────
// Read current state
// ─────────────────────────────────────────────────────────────

/**
 * Read the live state.json from the squad root.
 * Returns null if the file does not exist.
 */
export async function readState(squadDir) {
  const p = join(squadDir, "state.json");
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Init — write state.json before pipeline starts
// ─────────────────────────────────────────────────────────────

/**
 * Create the initial state.json (status: idle, all agents idle, step 0).
 *
 * @param {string} squadDir   Absolute path to squads/{name}/
 * @param {string} squadCode  Squad code from squad.yaml
 * @param {number} totalSteps Total pipeline steps
 */
export async function initState(squadDir, squadCode, totalSteps) {
  const agents = await buildAgentsFromParty(squadDir);

  const state = {
    squad: squadCode,
    status: "idle",
    step: { current: 0, total: totalSteps, label: "" },
    agents,
    handoff: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(join(squadDir, "state.json"), state);
  return state;
}

// ─────────────────────────────────────────────────────────────
// Step update — write before executing each step
// ─────────────────────────────────────────────────────────────

/**
 * Update state.json for the start of a pipeline step.
 * Sets the active agent to "working", all prior to "done", rest "idle".
 *
 * @param {string} squadDir     Absolute path to squads/{name}/
 * @param {string} squadCode    Squad code
 * @param {number} stepCurrent  1-based step index
 * @param {string} stepLabel    Human-readable step label
 * @param {string} activeAgentId  Agent id that is now working
 */
export async function updateStep(
  squadDir,
  squadCode,
  stepCurrent,
  stepLabel,
  activeAgentId,
) {
  const prev = await readState(squadDir);
  const agents = prev?.agents ?? (await buildAgentsFromParty(squadDir));
  const total = prev?.step?.total ?? 0;
  const startedAt =
    prev?.startedAt ?? (stepCurrent === 1 ? new Date().toISOString() : null);

  const updatedAgents = agents.map((a) => ({
    ...a,
    status:
      a.id === activeAgentId
        ? "working"
        : a.status === "working"
          ? "done"
          : a.status,
  }));

  const state = {
    squad: squadCode,
    status: "running",
    step: { current: stepCurrent, total, label: stepLabel },
    agents: updatedAgents,
    handoff: prev?.handoff ?? null,
    startedAt,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(join(squadDir, "state.json"), state);
  return state;
}

// ─────────────────────────────────────────────────────────────
// Handoff — transition between steps (delivering → working)
// ─────────────────────────────────────────────────────────────

/**
 * Write the two-phase handoff state between steps.
 * Phase 1: current agent "delivering", next agent still "idle"
 * Phase 2 (written immediately after): current agent "done", next agent "working"
 *
 * @param {string} squadDir
 * @param {string} squadCode
 * @param {string} fromAgentId  Agent that just completed
 * @param {string} toAgentId    Agent that will work next
 * @param {string} message      One-sentence summary of what was produced
 */
export async function writeHandoff(
  squadDir,
  squadCode,
  fromAgentId,
  toAgentId,
  message,
) {
  const prev = await readState(squadDir);
  if (!prev) throw new Error(`No state.json found in ${squadDir}`);

  const handoff = {
    from: fromAgentId,
    to: toAgentId,
    message,
    completedAt: new Date().toISOString(),
  };

  // Phase 1: delivering
  const deliveringAgents = prev.agents.map((a) => ({
    ...a,
    status: a.id === fromAgentId ? "delivering" : a.status,
  }));

  await writeJson(join(squadDir, "state.json"), {
    ...prev,
    agents: deliveringAgents,
    handoff,
    updatedAt: new Date().toISOString(),
  });

  // Phase 2: done → working (written immediately)
  const workingAgents = prev.agents.map((a) => ({
    ...a,
    status:
      a.id === fromAgentId ? "done" : a.id === toAgentId ? "working" : a.status,
  }));

  const next = {
    ...prev,
    agents: workingAgents,
    handoff,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(join(squadDir, "state.json"), next);
  return next;
}

// ─────────────────────────────────────────────────────────────
// Complete — finalize and archive
// ─────────────────────────────────────────────────────────────

/**
 * Write the "completed" state, copy to the run output folder, then delete the
 * live copy from the squad root (matches runner.pipeline.md Post-Completion Cleanup).
 *
 * @param {string} squadDir  Absolute path to squads/{name}/
 * @param {string} squadCode Squad code
 * @param {string} runId     Run ID (YYYY-MM-DD-HHmmss)
 * @param {number} delayMs   How long to keep the completed state visible (default 10 s)
 */
export async function markCompleted(
  squadDir,
  squadCode,
  runId,
  delayMs = 10_000,
) {
  const prev = await readState(squadDir);
  const completedAt = new Date().toISOString();

  const completed = {
    squad: squadCode,
    status: "completed",
    step: prev?.step ?? { current: 0, total: 0, label: "" },
    agents: (prev?.agents ?? []).map((a) => ({ ...a, status: "done" })),
    handoff: prev?.handoff ?? null,
    startedAt: prev?.startedAt ?? null,
    completedAt,
    updatedAt: completedAt,
  };

  const livePath = join(squadDir, "state.json");
  await writeJson(livePath, completed);

  // Archive to run output folder
  const archivePath = join(squadDir, "output", runId, "state.json");
  await mkdir(dirname(archivePath), { recursive: true });
  await copyFile(livePath, archivePath);

  // Keep visible for delayMs, then remove live copy
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
  await unlink(livePath).catch(() => {}); // ignore if already gone

  return completed;
}

// ─────────────────────────────────────────────────────────────
// markFailed — pipeline aborted
// ─────────────────────────────────────────────────────────────

/**
 * Write a "failed" terminal state and archive it.
 */
export async function markFailed(squadDir, squadCode, runId, reason = "") {
  const prev = await readState(squadDir);
  const failedAt = new Date().toISOString();

  const failed = {
    squad: squadCode,
    status: "failed",
    step: prev?.step ?? { current: 0, total: 0, label: "" },
    agents: (prev?.agents ?? []).map((a) => ({ ...a, status: "idle" })),
    handoff: prev?.handoff ?? null,
    startedAt: prev?.startedAt ?? null,
    failedAt,
    reason,
    updatedAt: failedAt,
  };

  const livePath = join(squadDir, "state.json");
  await writeJson(livePath, failed);

  const archivePath = join(squadDir, "output", runId, "state.json");
  await mkdir(dirname(archivePath), { recursive: true });
  await copyFile(livePath, archivePath).catch(() => {});
  await unlink(livePath).catch(() => {});

  return failed;
}

// ─────────────────────────────────────────────────────────────
// Checkpoint — pause waiting for user
// ─────────────────────────────────────────────────────────────

/**
 * Write a checkpoint state where execution is paused for user approval.
 */
export async function writeCheckpoint(
  squadDir,
  squadCode,
  stepCurrent,
  stepLabel,
  activeAgentId,
) {
  const prev = await readState(squadDir);

  const agents = (prev?.agents ?? []).map((a) => ({
    ...a,
    status: a.id === activeAgentId ? "checkpoint" : a.status,
  }));

  const state = {
    squad: squadCode,
    status: "checkpoint",
    step: {
      current: stepCurrent,
      total: prev?.step?.total ?? 0,
      label: stepLabel,
    },
    agents,
    handoff: prev?.handoff ?? null,
    startedAt: prev?.startedAt ?? null,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(join(squadDir, "state.json"), state);
  return state;
}

// ─────────────────────────────────────────────────────────────
// Helpers for CLI / tests
// ─────────────────────────────────────────────────────────────

/**
 * Resolve squad directory from project root and squad name.
 *
 * @param {string} squadName
 * @param {string} [projectRoot]  Defaults to cwd
 */
export function resolveSquadDir(squadName, projectRoot = process.cwd()) {
  return join(projectRoot, "squads", squadName);
}

/**
 * Read squad code and total steps from squad.yaml.
 */
export async function readSquadMeta(squadDir) {
  const raw = await readFile(join(squadDir, "squad.yaml"), "utf-8");
  const parsed = parseYaml(raw);
  const squad = parsed?.squad ?? {};
  const steps = parsed?.pipeline?.steps ?? [];
  return {
    code: squad.code ?? "",
    name: squad.name ?? "",
    totalSteps: Array.isArray(steps) ? steps.length : 0,
  };
}
