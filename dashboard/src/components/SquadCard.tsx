import type { SquadInfo, SquadState } from "@/types/state";
import { StatusBadge } from "./StatusBadge";

interface SquadCardProps {
  squad: SquadInfo;
  state: SquadState | undefined;
  isSelected: boolean;
  onSelect: () => void;
}

export function SquadCard({
  squad,
  state,
  isSelected,
  onSelect,
}: SquadCardProps) {
  const isActive = !!state;
  const status = state?.status ?? "inactive";

  return (
    <button
      onClick={onSelect}
      className={`squad-card ${isSelected ? "squad-card-selected" : ""}`}
    >
      <div className="squad-card-main">
        <StatusBadge status={status} />
        <span className="squad-card-icon">{squad.icon}</span>
        <span className="squad-card-name">{squad.name}</span>
        {state?.step && (
          <span className="squad-card-step">
            {isActive
              ? `${state.step.current}/${state.step.total}`
              : "Inactive"}
          </span>
        )}
      </div>
    </button>
  );
}
