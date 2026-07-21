import { useRef } from "react";
import type { ReactNode } from "react";
import { colors, font } from "../theme";
import { useAnalysis } from "../state/analysis";

const NAV = [
  { route: "dashboard", label: "Log overview" },
  { route: "investigate", label: "Investigate" },
  { route: "rules", label: "Rules" },
  { route: "query", label: "Query" },
] as const;

// Sample context shown before any real log is loaded (matches the design).
const SAMPLE_FILE = { name: "build-4471-console.log", detail: "212,904 lines" };
const SAMPLE_RANGE = "14:02:11 → 14:19:47";

function NavTab({ route, label, active }: { route: string; label: string; active: boolean }) {
  return (
    <a
      href={`#/${route}`}
      className={active ? undefined : "ll-tab"}
      style={{
        textDecoration: "none",
        padding: "8px 16px",
        borderRadius: 8,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        color: active ? colors.accent : colors.textMuted,
        background: active ? colors.accentBg : "transparent",
      }}
    >
      {label}
    </a>
  );
}

function ContextPill({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: font.mono,
        fontSize: 13,
        background: colors.surfaceMuted,
        border: `1px solid ${colors.border}`,
        padding: "6px 10px",
        borderRadius: 6,
      }}
    >
      {children}
      <span style={{ display: "none" }}>{label}</span>
    </div>
  );
}

export default function Layout({ route, children }: { route: string; children: ReactNode }) {
  const { result, fileName, timeRange, loading, error, sampleMode, loadFile } = useAnalysis();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayFile = sampleMode ? SAMPLE_FILE.name : fileName ?? "—";
  const displayDetail = sampleMode
    ? SAMPLE_FILE.detail
    : `${(result?.total ?? 0).toLocaleString()} events`;
  const displayRange = sampleMode ? SAMPLE_RANGE : timeRange ?? "—";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = ""; // allow re-selecting the same file
  }

  return (
    <div style={{ minHeight: "100vh", background: colors.appBg, fontFamily: font.sans, color: colors.text }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 24px",
          height: 56,
          background: colors.panel,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: colors.text, marginRight: 24 }}>LogLens</div>
        {NAV.map((n) => (
          <NavTab key={n.route} route={n.route} label={n.label} active={route === n.route} />
        ))}
      </div>

      {/* Context strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "12px 24px",
          background: colors.panel,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <ContextPill label="file">
          <span style={{ color: colors.textFaint }}>FILE</span>
          <span style={{ color: colors.text, fontWeight: 600 }}>{displayFile}</span>
          <span style={{ color: colors.textFaint }}>·</span>
          <span style={{ color: colors.textMuted }}>{displayDetail}</span>
        </ContextPill>
        <ContextPill label="range">
          <span style={{ color: colors.textFaint }}>RANGE</span>
          <span style={{ color: colors.text, fontWeight: 600 }}>{displayRange}</span>
        </ContextPill>
        {sampleMode && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "#9a6b1f",
              background: "#f3e8d8",
              border: "1px solid #e8d7bf",
              padding: "4px 8px",
              borderRadius: 5,
            }}
          >
            SAMPLE DATA
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "#d03b3b", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={error}>
            {error}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <input ref={fileInputRef} type="file" accept=".log,.txt,.crash,.log.*" style={{ display: "none" }} onChange={onPick} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: colors.accent,
            color: "#fff",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Analyzing…" : "Load log"}
        </button>
      </div>

      {/* Page content */}
      <div style={{ maxWidth: 1680, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
