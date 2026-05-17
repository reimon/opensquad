import { useSquadStore } from "@/store/useSquadStore";
import { SquadCard } from "./SquadCard";

export function SquadSelector() {
  const squads = useSquadStore((s) => s.squads);
  const activeStates = useSquadStore((s) => s.activeStates);
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const selectSquad = useSquadStore((s) => s.selectSquad);

  // Sort: active squads first, then alphabetical
  const squadList = Array.from(squads.values()).sort((a, b) => {
    const aActive = activeStates.has(a.code) ? 0 : 1;
    const bActive = activeStates.has(b.code) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name);
  });

  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-header">
        <h2>Squads</h2>
        <p>
          Active runs are surfaced first. Select one to sync the office view and
          status bar.
        </p>
      </div>
      <div className="sidebar-body">
        {squadList.length === 0 && (
          <div className="sidebar-empty">No squads found</div>
        )}
        {squadList.map((squad) => (
          <SquadCard
            key={squad.code}
            squad={squad}
            state={activeStates.get(squad.code)}
            isSelected={selectedSquad === squad.code}
            onSelect={() => selectSquad(squad.code)}
          />
        ))}
      </div>
    </aside>
  );
}
