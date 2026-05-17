import { useSquadSocket } from "@/hooks/useSquadSocket";
import { SquadSelector } from "@/components/SquadSelector";
import { PhaserGame } from "@/office/PhaserGame";
import { StatusBar } from "@/components/StatusBar";
import { useSquadStore } from "@/store/useSquadStore";
import { formatElapsed } from "@/lib/formatTime";
import { CheckpointPanel } from "@/components/CheckpointPanel";
import { SquadSettings } from "@/components/SquadSettings";

import { useEffect, useState } from "react";
export function App() {
  useSquadSocket();

  const [now, setNow] = useState(() => Date.now());
  const squads = useSquadStore((state) => state.squads);
  const activeStates = useSquadStore((state) => state.activeStates);
  const selectedSquad = useSquadStore((state) => state.selectedSquad);
  const isConnected = useSquadStore((state) => state.isConnected);

  const activeCount = activeStates.size;
  const runningCount = Array.from(activeStates.values()).filter(
    (state) => state.status === "running",
  ).length;
  const checkpointCount = Array.from(activeStates.values()).filter(
    (state) => state.status === "checkpoint",
  ).length;
  const selectedState = selectedSquad
    ? activeStates.get(selectedSquad)
    : undefined;

  const hasRunningTimer = !!selectedState?.startedAt;

  useEffect(() => {
    if (!hasRunningTimer) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasRunningTimer]);

  const elapsed = selectedState?.startedAt ? now - new Date(selectedState.startedAt).getTime() : 0;

  const selectedLabel = selectedState
    ? `${selectedState.step.current}/${selectedState.step.total}${selectedState.step.label ? ` • ${selectedState.step.label}` : ""}`
    : "No squad selected";

  return (
    <div className="dashboard-shell">
      <div className="dashboard-surface">
        <header className="dashboard-header">
          <div className="dashboard-brand">
            <div className="dashboard-mark">◫</div>
            <div className="dashboard-title">
              <h1>opensquad Dashboard</h1>
              <p>
                Live orchestration room for squads, checkpoints, and handoffs.
              </p>
            </div>
          </div>

          <div className="dashboard-header-meta">
            <div className="status-chip">
              <span
                className={`status-chip-dot ${isConnected ? "connected" : "disconnected"}`}
              />
              <strong>{isConnected ? "Connected" : "Offline"}</strong>
            </div>
            <div className="status-chip">
              <strong>{activeCount}</strong>
              <span>active squads</span>
            </div>
          </div>
        </header>

        <section className="dashboard-metrics">
          <article className="metric-card">
            <div className="metric-label">Live squads</div>
            <div className="metric-value">
              <strong>{activeCount}</strong>
              <span>of {squads.size} registered</span>
            </div>
            <div className="metric-note">
              Track every run in one place, with the most active squads surfaced
              first.
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-label">Current flow</div>
            <div className="metric-value">
              <strong>{runningCount}</strong>
              <span>running / {checkpointCount} waiting for review</span>
            </div>
            <div className="metric-note">
              The office scene mirrors the selected squad state in real time.
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-label">Selected squad</div>
            <div className="metric-value">
              <strong>{selectedSquad ?? "None"}</strong>
              <span>{selectedLabel}</span>
            </div>
            <div className="metric-note">
              {selectedState?.startedAt
                ? `Running for ${formatElapsed(elapsed)}`
                : "Pick a squad from the sidebar to inspect it."}
            </div>
          </article>
        </section>

        <main className="dashboard-main">
          <SquadSelector />

          <section className="stage-panel">
            <div className="stage-toolbar">
              <div className="stage-toolbar-title">
                <strong>Operations floor</strong>
                <span>
                  Room view tuned for the selected squad and live agent
                  positions.
                </span>
              </div>

              <div className="stage-toolbar-badges">
                <div className="soft-badge">
                  <strong>{activeCount}</strong>
                  squads in motion
                </div>
                <div className="soft-badge">
                  <strong>{checkpointCount}</strong>
                  checkpoints
                </div>
                <div style={{ position: "relative", marginLeft: "12px" }}>
                  <SquadSettings />
                </div>
              </div>
            </div>

            <div className="stage-canvas">
              <PhaserGame />
            </div>
          </section>
        </main>

        <CheckpointPanel />
        <StatusBar />
      </div>
    </div>
  );
}
