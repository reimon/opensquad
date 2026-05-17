import { useEffect, useState } from "react";
import { useSquadStore } from "@/store/useSquadStore";

export function SquadSettings() {
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const [settings, setSettings] = useState<{ auto_publish_instagram?: boolean } | null>(null);
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

  const toggleAutoPublish = async () => {
    if (!settings) return;
    const newSettings = { ...settings, auto_publish_instagram: !settings.auto_publish_instagram };
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
            width: "280px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 100,
          }}
        >
          <h4 style={{ margin: "0 0 12px 0", color: "var(--text)", fontSize: "14px" }}>Squad Configuration</h4>
          
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px" }}>
            <input 
              type="checkbox" 
              checked={!!settings.auto_publish_instagram}
              onChange={toggleAutoPublish}
              disabled={saving}
            />
            Auto-Publish to Instagram
          </label>
          <p style={{ margin: "4px 0 0 24px", fontSize: "11px", color: "var(--text-muted)" }}>
            Automatically approves and publishes content to Instagram, skipping the manual checkpoint.
          </p>
        </div>
      )}
    </div>
  );
}
