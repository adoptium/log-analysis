import { useEffect, useRef, useState } from "react";
import { colors, font } from "../theme";
import { useAnalysis } from "../state/analysis";

// ─────────────────────────────────────────────────────────────
// Saved-analyses header control: a "Save" button (persists the
// current analysis via POST /saved-analyses) and a "Saved" dropdown
// that lists persisted analyses with load / delete actions.
// ─────────────────────────────────────────────────────────────

const btn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  background: colors.panel,
  border: `1px solid ${colors.borderStrong}`,
  color: colors.text,
  cursor: "pointer",
};

export default function SavedAnalyses() {
  const { saved, empty, saving, fileName, saveCurrent, loadSaved, deleteSaved } = useAnalysis();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function onSave() {
    const suggested = fileName ?? "";
    const input = window.prompt("Save this analysis as:", suggested);
    if (input === null) return; // cancelled
    const name = input.trim();
    if (!name) return;
    // Saving under an existing name overwrites it (backend replaces the row),
    // so confirm before clobbering a previously saved analysis.
    const exists = saved.some((s) => s.source_file === name);
    if (exists && !window.confirm(`"${name}" already exists — overwrite it?`)) return;
    await saveCurrent(name);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", gap: 8 }}>
      <button
        onClick={onSave}
        disabled={empty || saving}
        style={{
          ...btn,
          color: empty || saving ? colors.textFaint : colors.text,
          cursor: empty || saving ? "not-allowed" : "pointer",
        }}
        title={empty ? "Load a log before saving" : "Save the current analysis"}
      >
        {saving ? "Saving…" : "Save"}
      </button>

      <button onClick={() => setOpen((o) => !o)} style={btn}>
        Saved{saved.length > 0 ? ` (${saved.length})` : ""} ▾
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 340,
            maxHeight: 380,
            overflowY: "auto",
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: `1px solid ${colors.border}`,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: colors.textFaint,
              textTransform: "uppercase",
            }}
          >
            Saved analyses
          </div>

          {saved.length === 0 && (
            <div style={{ padding: "16px 14px", fontSize: 13, color: colors.textMuted }}>
              No saved analyses yet.
            </div>
          )}

          {saved.map((s) => (
            <div
              key={s.source_file}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: `1px solid ${colors.rowBorder}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: colors.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={s.name}
                >
                  {s.name}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font.mono }}>
                  {s.total_events.toLocaleString()} events
                  {s.ignored_events > 0 ? ` · ${s.ignored_events.toLocaleString()} ignored` : ""}
                </div>
              </div>
              <button
                onClick={async () => {
                  await loadSaved(s.source_file);
                  setOpen(false);
                }}
                style={{ fontSize: 12, fontWeight: 600, color: colors.accent, background: "none", border: "none", cursor: "pointer" }}
              >
                Load
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete saved analysis "${s.name}"?`)) deleteSaved(s.source_file);
                }}
                style={{ fontSize: 12, fontWeight: 600, color: colors.textFaint, background: "none", border: "none", cursor: "pointer" }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
