import { useState } from "react";
import { useSquadStore } from "@/store/useSquadStore";

export function CheckpointPanel() {
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const state = useSquadStore((s) =>
    s.selectedSquad ? s.activeStates.get(s.selectedSquad) : undefined,
  );

  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!state || state.status !== "checkpoint" || !state.checkpointData) {
    return null;
  }

  const { message, reviewFile } = state.checkpointData;

  const handleSubmit = async () => {
    if (!response.trim() || !selectedSquad) return;
    setSubmitting(true);
    try {
      await fetch(`/api/checkpoint/${selectedSquad}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Failed to submit checkpoint", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkpoint-panel" style={{ padding: "16px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <h3>🚦 Action Required: Checkpoint</h3>
      <p style={{ whiteSpace: "pre-wrap", marginBottom: "12px", color: "var(--text)" }}>{message}</p>
      
      {reviewFile && (
        <div style={{ marginBottom: "16px", padding: "8px", background: "var(--surface-sunken)", borderRadius: "4px" }}>
          <strong>File to review:</strong> {reviewFile}
        </div>
      )}

      {submitted ? (
        <div style={{ color: "var(--success)" }}>
          Response saved! Please return to your chat and type "done" to continue the pipeline.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Type your response here..."
            style={{ minHeight: "80px", padding: "8px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text)" }}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !response.trim()}
            style={{ alignSelf: "flex-end", padding: "6px 16px", background: "var(--text)", color: "var(--surface)", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            {submitting ? "Submitting..." : "Submit Response"}
          </button>
        </div>
      )}
    </div>
  );
}
