import { useEffect, useState } from "react";
import { useSquadStore } from "@/store/useSquadStore";

interface SquadConfig {
  autonomousMode?: boolean;
  publishProfile?: string;
}

export function SquadSettings() {
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const [settings, setSettings] = useState<SquadConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedSquad || !isOpen) return;
    fetch(`/api/squad-settings/${selectedSquad}`)
      .then((res) => res.json())
      .then((data) => setSettings(data))
      .catch((err) => console.error("Failed to load settings", err));
  }, [selectedSquad, isOpen]);

  if (!selectedSquad) return null;

  const updateSetting = async (updatedFields: Partial<SquadConfig>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updatedFields };
    setSettings(newSettings);
    setSaving(true);
    try {
      await fetch(`/api/squad-settings/${selectedSquad}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
    } catch (err) {
      console.error("Failed to save settings", err);
      // Revert on error
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  const toggleAutonomous = () => {
    if (!settings) return;
    updateSetting({ autonomousMode: !settings.autonomousMode });
  };

  const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!settings) return;
    updateSetting({ publishProfile: e.target.value });
  };

  return (
    <div className="squad-settings">
      <button 
        className="settings-toggle" 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          padding: "4px 8px",
          borderRadius: "4px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
        }}
      >
        <span>⚙️</span> Settings
      </button>

      {isOpen && settings && (
        <div 
          className="settings-panel"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "8px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "16px",
            width: "300px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 100,
          }}
        >
          <h4 style={{ margin: "0 0 12px 0", color: "var(--text)", fontSize: "14px" }}>Squad Configuration</h4>
          
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px", fontWeight: "bold" }}>
              <input 
                type="checkbox" 
                checked={!!settings.autonomousMode}
                onChange={toggleAutonomous}
                disabled={saving}
              />
              🤖 Autonomous Mode
            </label>
            <p style={{ margin: "4px 0 0 24px", fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.3" }}>
              Agents work autonomously without waiting for manual checkpoint approvals.
            </p>
          </div>

          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "12px", marginBottom: "6px" }}>
              📢 Publish Destination Profile
            </label>
            <select
              value={settings.publishProfile || "draft"}
              onChange={handleProfileChange}
              disabled={saving}
              style={{
                width: "100%",
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--surface-sunken)",
                color: "var(--text)",
                fontSize: "12px"
              }}
            >
              <option value="draft">Draft (Do not Auto-Publish)</option>
              <option value="instagram">Instagram (@mycompany)</option>
              <option value="linkedin">LinkedIn (Company Page)</option>
              <option value="twitter">Twitter/X (@company)</option>
            </select>
            <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.3" }}>
              Choose which social profile the autonomous agent should target for publishing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
