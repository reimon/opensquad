import { useState, useEffect } from "react";
import { useSquadStore } from "@/store/useSquadStore";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function toRelativePath(reviewFile: string, squadName: string): string {
  const squadMarker = `squads/${squadName}/`;
  const markerIdx = reviewFile.indexOf(squadMarker);
  if (markerIdx !== -1) {
    return reviewFile.slice(markerIdx + squadMarker.length);
  }
  // Path doesn't reference the selected squad — pass through unchanged.
  // Backend sandbox check will reject anything outside squads/{squadName}/.
  return reviewFile.replace(/^\/+/, "");
}

function isImagePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function CheckpointPanel() {
  const selectedSquad = useSquadStore((s) => s.selectedSquad);
  const state = useSquadStore((s) =>
    s.selectedSquad ? s.activeStates.get(s.selectedSquad) : undefined,
  );

  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  // File Preview States
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isImage, setIsImage] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState(false);

  useEffect(() => {
    // Reset submission state when the checkpoint changes or selected squad changes
    setSubmitted(false);
    setResponse("");
    setFileContent(null);
    setIsImage(false);
    setFileError(false);
  }, [selectedSquad, state?.updatedAt]);

  const reviewFile = state?.checkpointData?.reviewFile;

  useEffect(() => {
    if (!selectedSquad || !reviewFile) return;

    const relativePath = toRelativePath(reviewFile, selectedSquad);
    const isImg = isImagePath(relativePath);

    if (isImg) {
      // Images are rendered via <img src> — no fetch needed
      setIsImage(true);
      return;
    }

    setLoadingFile(true);
    setFileError(false);
    setIsImage(false);
    fetch(`/api/squad-file/${selectedSquad}?path=${encodeURIComponent(relativePath)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load file");
        return res.text();
      })
      .then((text) => setFileContent(text))
      .catch((err) => {
        console.error(err);
        setFileError(true);
      })
      .finally(() => setLoadingFile(false));
  }, [selectedSquad, reviewFile]);

  if (!state || state.status !== "checkpoint" || !state.checkpointData) {
    return null;
  }

  const { message } = state.checkpointData;

  const handleSubmitResponse = async (finalResponse: string) => {
    if (!finalResponse.trim() || !selectedSquad) return;
    setSubmitting(true);
    try {
      await fetch(`/api/checkpoint/${selectedSquad}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: finalResponse }),
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Failed to submit checkpoint", err);
    } finally {
      setSubmitting(false);
    }
  };

  const imageApiUrl = reviewFile && selectedSquad && isImage
    ? `/api/squad-file/${selectedSquad}?path=${encodeURIComponent(toRelativePath(reviewFile, selectedSquad))}`
    : "";

  return (
    <div 
      className="checkpoint-panel" 
      style={{ 
        padding: "24px", 
        borderTop: "1px solid var(--border)", 
        background: "linear-gradient(180deg, var(--surface) 0%, var(--surface-sunken) 100%)",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "24px" }}>🚦</span>
        <div>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: "16px", fontWeight: "bold" }}>Action Required: Checkpoint Approval</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
            Review the generated content below and choose the next action.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: reviewFile ? "1fr 1fr" : "1fr", gap: "20px", alignItems: "stretch" }}>
        
        {/* Left Side: Guidelines / Context */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "14px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "6px" }}>
            <strong style={{ display: "block", color: "var(--text)", fontSize: "13px", marginBottom: "6px" }}>Instructions:</strong>
            <p style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.4" }}>{message}</p>
          </div>

          {submitted ? (
            <div 
              style={{ 
                padding: "16px", 
                background: "rgba(16, 185, 129, 0.1)", 
                border: "1px solid var(--success)", 
                borderRadius: "6px",
                color: "var(--success)",
                fontWeight: "bold",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>✅</span> Response saved! Please return to your terminal and type "done" to resume the pipeline.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <strong style={{ color: "var(--text)", fontSize: "13px" }}>Action Feedback & Revision:</strong>
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Request edits, adjustments or provide additional guidelines here..."
                style={{ 
                  minHeight: "100px", 
                  padding: "10px", 
                  borderRadius: "6px", 
                  border: "1px solid var(--border)", 
                  background: "var(--surface-raised)", 
                  color: "var(--text)",
                  fontSize: "13px",
                  lineHeight: "1.4"
                }}
              />
              
              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
                <button
                  onClick={() => handleSubmitResponse(response.trim())}
                  disabled={submitting || !response.trim()}
                  style={{ 
                    padding: "8px 16px", 
                    background: "transparent", 
                    color: "#ef4444", 
                    border: "1px solid #ef4444", 
                    borderRadius: "6px", 
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "bold",
                    transition: "all 0.2s"
                  }}
                >
                  ❌ Reject & Revise
                </button>

                <button
                  onClick={() => handleSubmitResponse(response.trim() || "Approved")}
                  disabled={submitting}
                  style={{ 
                    padding: "8px 20px", 
                    background: "var(--text)", 
                    color: "var(--surface)", 
                    border: "none", 
                    borderRadius: "6px", 
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "bold"
                  }}
                >
                  {submitting ? "Submitting..." : response.trim() ? "Approve with Changes" : "✓ Approve & Publish"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Content Visualizer (Only visible if reviewFile is present) */}
        {reviewFile && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <strong style={{ color: "var(--text)", fontSize: "13px" }}>📦 Produced Content:</strong>
            
            <div 
              style={{ 
                flex: 1, 
                minHeight: "260px",
                maxHeight: "360px",
                overflowY: "auto",
                border: "1px solid var(--border)", 
                borderRadius: "6px", 
                background: "var(--surface-sunken)",
                padding: "16px",
                position: "relative"
              }}
            >
              {loadingFile && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-sunken)", color: "var(--text-secondary)" }}>
                  🔄 Loading content preview...
                </div>
              )}

              {fileError && (
                <div style={{ color: "#ef4444", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>
                  ⚠️ Error displaying content preview. Raw path: <code style={{ fontSize: "11px" }}>{reviewFile}</code>
                </div>
              )}

              {!loadingFile && !fileError && (
                <>
                  {isImage ? (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
                      <img 
                        src={imageApiUrl} 
                        alt="Produced preview" 
                        style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "4px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", objectFit: "contain" }} 
                      />
                    </div>
                  ) : (
                    <pre 
                      style={{ 
                        margin: 0, 
                        whiteSpace: "pre-wrap", 
                        fontFamily: "var(--font-mono, monospace)", 
                        fontSize: "12px", 
                        color: "var(--text-secondary)",
                        lineHeight: "1.5"
                      }}
                    >
                      {fileContent}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
