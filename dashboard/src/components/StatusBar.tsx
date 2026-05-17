import { useEffect, useState } from "react";
import { useSquadStore } from "@/store/useSquadStore";
import { formatElapsed } from "@/lib/formatTime";

export function StatusBar() {
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const state = useSquadStore((s) =>
    s.selectedSquad ? s.activeStates.get(s.selectedSquad) : undefined,
  );
  const isConnected = useSquadStore((s) => s.isConnected);

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!state?.startedAt) {
      setElapsed(0);
      return;
    }

    const startTime = new Date(state.startedAt).getTime();
    const tick = () => setElapsed(Date.now() - startTime);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state?.startedAt]);

  if (!selectedSquad || !state) {
    return (
      <footer className="status-bar">
        <span className="status-bar-empty">
          Select an active squad to monitor
        </span>
        <ConnectionDot connected={isConnected} />
      </footer>
    );
  }

  return (
    <footer className="status-bar">
      <div className="status-bar-main">
        <span>
          Step {state.step.current}/{state.step.total}
          {state.step.label ? ` — ${state.step.label}` : ""}
        </span>
        {state.startedAt && (
          <span style={{ color: "var(--text-secondary)" }}>
            {formatElapsed(elapsed)}
          </span>
        )}
        {state.handoff && (
          <span
            className="status-bar-handoff"
            title={`${state.handoff.from} → ${state.handoff.to}: ${state.handoff.message}`}
          >
            {state.handoff.from} → {state.handoff.to}: {state.handoff.message}
          </span>
        )}
      </div>
      <ConnectionDot connected={isConnected} />
    </footer>
  );
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      title={connected ? "Connected" : "Disconnected"}
      className={`connection-dot ${connected ? "connected" : "disconnected"}`}
    />
  );
}
