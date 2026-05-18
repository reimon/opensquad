# Interactive Dashboard & Autonomous Pipeline Mode

**Document Type:** Technical Design & Implementation Plan
**Owner:** Opensquad Platform Team
**Status:** Implemented
**Last Updated:** 2026-05-17
**Related Components:** `dashboard/`, `_opensquad/core/runner.pipeline.md`

---

## 1. Executive Summary

This initiative migrates the Opensquad checkpoint approval workflow from a terminal-driven interaction model to a fully interactive, browser-based dashboard. The change introduces two complementary operating modes:

1. **Supervised Mode** — Operators review and approve generated content directly in the dashboard, with inline previews of markdown, JSON, and image artifacts.
2. **Autonomous Mode** — Pre-configured squads execute end-to-end without human-in-the-loop intervention, targeting a designated publishing destination.

The result is a unified control plane for both interactive review and unattended execution, reducing operator context-switching and unlocking scheduled / automated content pipelines.

---

## 2. Business Objectives

| # | Objective | Success Metric |
|---|-----------|----------------|
| 1 | Eliminate terminal round-trips during checkpoint approval | 100% of approvals submittable from the dashboard |
| 2 | Enable unattended squad execution | Squads with `autonomousMode: true` complete without operator input |
| 3 | Provide pre-approval content visibility | Markdown and image artifacts rendered inline in the checkpoint panel |
| 4 | Maintain backward compatibility | Existing squads continue to function with no configuration changes |

---

## 3. Scope

### 3.1 In Scope
- Squad-level configuration persistence (`squads/{name}/settings.json`)
- Dashboard UI for autonomous mode and publishing-target configuration
- Secure, sandboxed file delivery API for content previews
- Pipeline Runner logic for checkpoint bypass and auto-response generation
- Inline rendering of markdown and image artifacts during checkpoint review

### 3.2 Out of Scope
- Replacement of the terminal "done" handshake for *supervised* runs (acknowledged limitation — see §8)
- Direct programmatic publishing to external platforms (delegated to the Publisher agent)
- Multi-user / RBAC concerns

---

## 4. Architecture Overview

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   Dashboard (React)     │  HTTP   │   Vite Dev Server +     │
│  ───────────────────    │ ◄─────► │   squadWatcher Plugin   │
│  • SquadSettings        │   WS    │  ───────────────────    │
│  • CheckpointPanel      │ ◄─────► │  • REST API             │
└─────────────────────────┘         │  • WebSocket Broadcast  │
                                    │  • Chokidar File Watch  │
                                    └────────────┬────────────┘
                                                 │ FS I/O
                                                 ▼
                                    ┌─────────────────────────┐
                                    │ squads/{name}/          │
                                    │  • settings.json        │
                                    │  • state.json           │
                                    │  • checkpoint_response  │
                                    │  • output/...           │
                                    └────────────┬────────────┘
                                                 │ Read/Write
                                                 ▼
                                    ┌─────────────────────────┐
                                    │   Pipeline Runner       │
                                    │   (Claude Agent)        │
                                    └─────────────────────────┘
```

**Communication model:** The dashboard and runner do not communicate directly. The filesystem acts as the contract surface: the runner publishes state and the dashboard reads it; the dashboard writes responses and the runner consumes them. Chokidar + WebSocket provide low-latency notifications to connected clients.

---

## 5. Implementation Phases

### Phase 1 — Autonomous Configuration Layer

**Goal:** Allow operators to configure per-squad behavior that bypasses manual checkpoints.

| Layer | Component | Change |
|-------|-----------|--------|
| Backend | `dashboard/src/plugin/squadWatcher.ts` | `GET`/`POST /api/squad-settings/:squad` — read/write `settings.json` |
| Frontend | `dashboard/src/components/SquadSettings.tsx` | Autonomous Mode toggle + Publishing Profile selector (Draft / Instagram / LinkedIn / Twitter) |
| Runtime | `_opensquad/core/runner.pipeline.md` | "Autonomous Mode Check" gate inside the checkpoint flow |

**Runner behavior when `autonomousMode: true`:**
1. Skip the dashboard checkpoint UI write.
2. Generate a synthetic approval response: `Approved autonomously. Ready for publishing to: {publishProfile}`.
3. Apply Output Path Transformation (Step 1 only — `run_id` injection) to `outputFile` and persist the response.
4. Continue execution without writing `status: checkpoint`.

### Phase 2 — Content Preview Service

**Goal:** Surface generated artifacts inside the dashboard so reviewers can approve without leaving the browser.

| Layer | Component | Change |
|-------|-----------|--------|
| Backend | `squadWatcher.ts` | `GET /api/squad-file/:squad?path=...` |
| Frontend | `CheckpointPanel.tsx` | On `checkpointData.reviewFile`, fetch and render — `<img>` for raster assets, monospace block for markdown / JSON / text |

**Security controls:**
- Path resolution is sandboxed to `squads/{name}/`. Any resolved path escaping that prefix returns `403 Forbidden`.
- Content-Type is derived from extension allowlist (`.md`, `.json`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.html`). Unknown types fall back to `text/plain`.
- No directory listing endpoint is exposed — clients must know the artifact path (provided by the runner via `state.json`).

### Phase 3 — Interactive Approval Flow

**Goal:** Replace ad-hoc terminal input with structured approval actions.

| Component | Change |
|-----------|--------|
| `CheckpointPanel.tsx` | Two-action UI: **Approve & Publish** (default empty → `"Approved"`) and **Reject & Revise** (requires feedback text). Submits to `POST /api/checkpoint/:squad`. |
| `squadWatcher.ts` | Persists payload to `squads/{name}/checkpoint_response.json`. |
| Runner | After the operator types `done` in the chat (handshake limitation, §8), reads the JSON file and consumes the response as the checkpoint output. |

---

## 6. API Contract

### `GET /api/squad-settings/:squad`
Returns the squad's `settings.json` or `{}` if absent. Always `200 OK`.

### `POST /api/squad-settings/:squad`
Body: arbitrary JSON. Persists to `settings.json`. Returns `{ "success": true }`.

### `GET /api/squad-file/:squad?path=<relative>`
Returns the requested file with inferred Content-Type. `403` on traversal, `404` on missing, `400` if path resolves to a non-file.

### `POST /api/checkpoint/:squad`
Body: `{ "response": "<string>" }`. Persists to `checkpoint_response.json`. Returns `{ "success": true }`.

---

## 7. Data Model

### `squads/{name}/settings.json`
```json
{
  "autonomousMode": false,
  "publishProfile": "draft",
  "auto_publish_instagram": false
}
```

### `squads/{name}/state.json` (checkpoint state)
```json
{
  "status": "checkpoint",
  "checkpointData": {
    "message": "Review the carousel and approve, or provide feedback.",
    "reviewFile": "squads/{name}/output/{run_id}/slides/v1/draft.md"
  }
}
```

### `squads/{name}/checkpoint_response.json`
```json
{ "response": "Approved" }
```

---

## 8. Known Limitations & Trade-offs

1. **Terminal handshake on supervised runs.** The runner is a long-running LLM session; it has no event subscription mechanism. After submitting a response in the dashboard, operators must still type `done` in the chat to unblock the runner. *Mitigation:* Autonomous Mode eliminates this entirely for routine workflows.
2. **Single-tenant filesystem contract.** The current design assumes one operator per squad directory. Concurrent approvals are not coordinated.
3. **No transport encryption on the local Vite dev server.** Acceptable for the current `localhost`-only deployment model.

---

## 9. Acceptance Criteria

- [x] Operator can toggle `autonomousMode` from the dashboard and the value persists across restarts.
- [x] A squad with `autonomousMode: true` completes a full pipeline without writing `status: checkpoint`.
- [x] During a supervised checkpoint, markdown artifacts render in the panel and images display inline.
- [x] Path traversal attempts on `/api/squad-file/` return `403`.
- [x] Approve and Reject actions both produce a valid `checkpoint_response.json` consumed by the runner.
- [x] TypeScript compilation passes without errors (`tsc --noEmit`).

---

## 10. Rollout & Observability

- **Rollout:** Ship as part of the dashboard codebase; no migration required — squads without `settings.json` default to supervised behavior.
- **Observability:** State transitions are visible in real time via the existing WebSocket snapshot stream. Filesystem artifacts (`state.json`, `checkpoint_response.json`, `settings.json`) provide a durable audit trail per run.

---

## 11. Future Work

- Replace the terminal `done` handshake with an out-of-band signal (named pipe, local IPC socket, or `chokidar` watch on `checkpoint_response.json` from inside the runner).
- Add per-profile credential validation before allowing `autonomousMode: true` to target a publishing destination.
- Introduce role-based approval (multi-reviewer workflows) for high-stakes content.
