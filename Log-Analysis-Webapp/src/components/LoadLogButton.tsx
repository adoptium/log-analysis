import { useRef } from "react";
import { colors } from "../theme";
import { useAnalysis } from "../state/analysis";

// ─────────────────────────────────────────────────────────────
// Shared "Load log" control: a hidden file input + a styled button
// that posts the chosen file to /analyze (via the analysis context).
// Used by the header strip and the Dashboard empty-state CTA.
// ─────────────────────────────────────────────────────────────

export default function LoadLogButton({ variant }: { variant: "header" | "cta" }) {
  const { loading, loadFile } = useAnalysis();
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = ""; // allow re-selecting the same file
  }

  const base: React.CSSProperties = {
    fontWeight: 600,
    background: colors.accent,
    color: "#fff",
    border: "none",
    cursor: loading ? "wait" : "pointer",
    opacity: loading ? 0.7 : 1,
  };
  const sizing: React.CSSProperties =
    variant === "cta"
      ? { padding: "11px 22px", borderRadius: 10, fontSize: 14 }
      : { padding: "8px 16px", borderRadius: 8, fontSize: 13 };

  const label = loading ? "Analyzing…" : variant === "cta" ? "Load a log file" : "Load log";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".log,.txt,.crash,.log.*"
        style={{ display: "none" }}
        onChange={onPick}
      />
      <button onClick={() => inputRef.current?.click()} disabled={loading} style={{ ...base, ...sizing }}>
        {label}
      </button>
    </>
  );
}
