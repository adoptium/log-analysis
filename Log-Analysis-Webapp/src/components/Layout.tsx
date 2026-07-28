import { useState, type ReactNode } from "react";
import { colors, font } from "../theme";
import { useAnalysis } from "../state/analysis";
import LoadLogButton from "./LoadLogButton";
<<<<<<< Updated upstream
import SavedAnalyses from "./SavedAnalyses";
=======
import AiAssistantOverlay from "./AiAssistantOverlay";
>>>>>>> Stashed changes

const NAV = [
  { route: "dashboard", label: "Log overview" },
  { route: "investigate", label: "Investigate" },
  { route: "rules", label: "Rules" },
  { route: "query", label: "Query" },
] as const;

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
  const { result, fileName, timeRange, error, empty } = useAnalysis();
  const [aiOverlayOpen, setAiOverlayOpen] = useState(false);

  const displayFile = empty ? "No file loaded" : fileName ?? "—";
  const displayRange = empty ? "—" : timeRange ?? "—";

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
          <span style={{ color: empty ? colors.textMuted : colors.text, fontWeight: 600 }}>{displayFile}</span>
          {!empty && (
            <>
              <span style={{ color: colors.textFaint }}>·</span>
              <span style={{ color: colors.textMuted }}>{`${(result?.total ?? 0).toLocaleString()} events`}</span>
            </>
          )}
        </ContextPill>
        <ContextPill label="range">
          <span style={{ color: colors.textFaint }}>FILE RANGE</span>
          <span style={{ color: empty ? colors.textMuted : colors.text, fontWeight: 600 }}>{displayRange}</span>
        </ContextPill>
        {error && (
          <span style={{ fontSize: 12, color: "#d03b3b", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={error}>
            {error}
          </span>
        )}
        <div style={{ flex: 1 }} />
<<<<<<< Updated upstream
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SavedAnalyses />
          <LoadLogButton variant="header" />
        </div>
=======
        <button
          onClick={() => setAiOverlayOpen((prev) => !prev)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 8,
            border: `1px solid ${colors.accent}`,
            background: aiOverlayOpen ? colors.accent : colors.accentBg,
            color: aiOverlayOpen ? "#ffffff" : colors.accent,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <span>✨</span>
          <span>AI Assistant</span>
        </button>
        <LoadLogButton variant="header" />
>>>>>>> Stashed changes
      </div>

      {/* Page content */}
      <div style={{ maxWidth: 1680, margin: "0 auto" }}>{children}</div>

      {/* Right Collapsible AI Overlay Drawer (~25% width) */}
      <AiAssistantOverlay isOpen={aiOverlayOpen} onClose={() => setAiOverlayOpen(false)} />
    </div>
  );
}

