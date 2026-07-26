import { useEffect, useMemo, useState } from "react";
import { colors, font, levelColor } from "../theme";
import { useAnalysis, shortTime } from "../state/analysis";
import { fetchTopTemplates } from "../api";
import type { AnalysisResult, TopTemplate } from "../types";


// The four levels the design charts, in display order.
const DISPLAY_LEVELS = ["SEVERE", "ERROR", "WARNING", "INFO"] as const;
const FATAL_LEVELS = new Set(["SEVERE", "FATAL", "ERROR"]);

type Card = { label: string; count: number; color: string };
type FeedRow = { key: string; line: number; time: string; level: string; logger: string; message: string };

// ── Sample fallback data (matches the design) ──
const SAMPLE_CARDS: Card[] = [
  { label: "SEVERE", count: 156, color: levelColor.SEVERE },
  { label: "ERROR", count: 353, color: levelColor.ERROR },
  { label: "WARNING", count: 412, color: levelColor.WARNING },
  { label: "INFO", count: 1840, color: levelColor.INFO },
];
const SAMPLE_FEED: FeedRow[] = [
  { key: "1", line: 18422, time: "14:11:03.221", level: "ERROR", logger: "h.r.Launcher#launch", message: "Process apparently never started (see java.io.IOException...)" },
  { key: "2", line: 18452, time: "14:11:09.117", level: "SEVERE", logger: "o.j.p.w.WorkflowRun#run", message: "Terminating agent connection: channel already closed" },
  { key: "3", line: 18502, time: "14:13:58.410", level: "ERROR", logger: "h.t.Maven#perform", message: "Maven build step failed with exit code 1" },
];
const SAMPLE_TEMPLATES: TopTemplate[] = [
  { rank: 1, template_id: 1, count: 214, template: "java.io.IOException: Cannot run program <PATH>", example: "" },
  { rank: 2, template_id: 2, count: 156, template: "ClosedChannelException at Channel.terminate", example: "" },
  { rank: 3, template_id: 3, count: 98, template: "OutOfMemoryError: Java heap space", example: "" },
  { rank: 4, template_id: 4, count: 87, template: "Item stuck in queue for <N>s", example: "" },
];
const SAMPLE_FILE_NAME = "build-4471-console.log";

const RANGE_DEFS = [
  { key: "1h", label: "Last hour" },
  { key: "12h", label: "Last 12h" },
  { key: "24h", label: "Last 24h" },
  { key: "custom", label: "Custom range" },
];

const uppercaseLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: colors.textFaint,
  textTransform: "uppercase",
};

// Derive severity cards from a backend result's level_counts.
function cardsFromResult(result: AnalysisResult): Card[] {
  return DISPLAY_LEVELS.map((label) => ({
    label,
    count: result.level_counts[label] ?? 0,
    color: levelColor[label],
  }));
}

// Derive the fatal/error feed from a backend result's events.
function feedFromResult(result: AnalysisResult): FeedRow[] {
  return result.events
    .filter((e) => !e.ignored && e.level && FATAL_LEVELS.has(e.level))
    .map((e) => ({
      key: `${e.line_start}-${e.timestamp_raw ?? ""}`,
      line: e.line_start,
      time: shortTime(e.timestamp_raw, e.timestamp),
      level: e.level ?? "",
      logger: e.method ? `${e.logger}#${e.method}` : e.logger ?? "",
      message: e.message,
    }));
}

export default function Dashboard() {
  const { result, sampleMode, fileName } = useAnalysis();
  const [range, setRange] = useState("24h");
  const [exportOpen, setExportOpen] = useState(false);

  const cards = useMemo(() => (result ? cardsFromResult(result) : SAMPLE_CARDS), [result]);
  const feed = useMemo(() => (result ? feedFromResult(result) : SAMPLE_FEED), [result]);
  const headerFile = sampleMode ? SAMPLE_FILE_NAME : fileName ?? "—";

  const maxCount = Math.max(1, ...cards.map((c) => c.count));
  const maxSqrt = Math.sqrt(maxCount);
  const levelBars = cards.map((c) => ({ ...c, h: c.count > 0 ? 24 + (Math.sqrt(c.count) / maxSqrt) * 130 : 2 }));

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 24px 0 24px" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>Log overview</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: colors.textMuted }}>Summary of</span>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 13,
                fontWeight: 600,
                color: colors.text,
                background: colors.surfaceMuted,
                border: `1px solid ${colors.border}`,
                padding: "3px 8px",
                borderRadius: 5,
              }}
            >
              {headerFile}
            </span>
          </div>
        </div>
        <button
          className="ll-btn-secondary"
          onClick={() => setExportOpen(true)}
          style={{
            padding: "9px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: colors.panel,
            border: `1px solid ${colors.borderStrong}`,
            color: colors.text,
            cursor: "pointer",
          }}
        >
          Export report
        </button>
      </div>

      {/* Time range control (client-side view state — see note in code) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 24px 0 24px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginRight: 4 }}>TIME RANGE</div>
        {RANGE_DEFS.map((r) => {
          const active = r.key === range;
          return (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                background: active ? colors.accentBg : colors.surfaceMuted,
                color: active ? colors.accent : colors.textMuted,
                border: "none",
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {/* Severity cards */}
      <div className="ll-severity-grid" style={{ padding: "20px 24px" }}>
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              background: colors.panel,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${card.color}`,
              borderRadius: 8,
              padding: "16px 18px",
            }}
          >
            <div style={uppercaseLabel}>{card.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.text, marginTop: 6, fontFamily: font.mono }}>
              {card.count.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Body: feed + chart */}
      <div className="ll-dash-body" style={{ borderTop: `1px solid ${colors.border}`, marginTop: 4 }}>
        {/* Fatal & error feed */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${colors.border}`, background: colors.panel }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px 8px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Fatal &amp; error events</div>
            <a href="#/investigate" className="ll-link" style={{ fontSize: 12, fontWeight: 600 }}>
              View all in Investigate →
            </a>
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "8px 24px",
              ...uppercaseLabel,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ width: 60 }}>Line</div>
            <div style={{ width: 90 }}>Time</div>
            <div style={{ width: 60 }}>Level</div>
            <div style={{ width: 160 }}>Logger#method</div>
            <div style={{ flex: 1 }}>Message</div>
          </div>
          {feed.length === 0 && (
            <div style={{ padding: "24px", fontSize: 13, color: colors.textMuted, textAlign: "center" }}>
              No fatal or error events in this log.
            </div>
          )}
          {feed.map((ev) => (
            <a
              key={ev.key}
              href="#/investigate"
              className="ll-row"
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 24px",
                fontSize: 12.5,
                fontFamily: font.mono,
                alignItems: "center",
                borderBottom: `1px solid ${colors.rowBorder}`,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ width: 60, color: colors.textFaint }}>{ev.line}</div>
              <div style={{ width: 90, color: colors.textMuted }}>{ev.time}</div>
              <div style={{ width: 60, fontWeight: 700, color: levelColor[ev.level] ?? colors.text }}>{ev.level}</div>
              <div style={{ width: 160, color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ev.logger}
              </div>
              <div style={{ flex: 1, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ev.message}
              </div>
            </a>
          ))}
        </div>

        {/* Events by level chart */}
        <div style={{ padding: "20px 24px", background: colors.panel }}>
          <div style={{ ...uppercaseLabel, marginBottom: 16 }}>Events by level</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, height: 160, padding: "0 8px" }}>
            {levelBars.map((lb) => (
              <div key={lb.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, height: "100%", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: font.mono, color: lb.color, marginBottom: 6 }}>{lb.count.toLocaleString()}</div>
                <div style={{ width: "100%", maxWidth: 56, height: lb.h, background: lb.color, borderRadius: "4px 4px 0 0" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 24, padding: "0 8px", marginTop: 10 }}>
            {levelBars.map((lb) => (
              <div key={lb.label} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: "uppercase" }}>
                {lb.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {exportOpen && (
        <ExportModal
          onClose={() => setExportOpen(false)}
          fileName={headerFile}
          cards={cards}
          feed={feed}
          result={result}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Export report modal. Top templates come from /top-templates when a
// real log is loaded; the PDF download itself is a backend concern.
// ─────────────────────────────────────────────────────────────

function ExportModal({
  onClose,
  fileName,
  cards,
  feed,
  result,
}: {
  onClose: () => void;
  fileName: string;
  cards: Card[];
  feed: FeedRow[];
  result: AnalysisResult | null;
}) {
  const [templates, setTemplates] = useState<TopTemplate[]>(result ? [] : SAMPLE_TEMPLATES);
  const [loadingTemplates, setLoadingTemplates] = useState(!!result);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setLoadingTemplates(true);
    fetchTopTemplates(result.events, 8)
      .then((t) => { if (!cancelled) setTemplates(t); })
      .catch(() => { if (!cancelled) setTemplates([]); })
      .finally(() => { if (!cancelled) setLoadingTemplates(false); });
    return () => { cancelled = true; };
  }, [result]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 600, maxHeight: "82vh", background: colors.panel, borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>Export report</div>
          <div className="ll-icon-btn" onClick={onClose} style={{ fontSize: 14, color: colors.textMuted, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
            ✕
          </div>
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 12, color: colors.textFaint }}>PDF summary · {fileName}</div>

          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 8 }}>Event counts by level</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cards.map((c) => (
                <div key={c.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 10px", background: colors.surfaceMuted, borderRadius: 6 }}>
                  <span style={{ fontWeight: 600, color: c.color }}>{c.label}</span>
                  <span style={{ fontFamily: font.mono, color: colors.text }}>{c.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 8 }}>Top recurring templates</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loadingTemplates && <div style={{ fontSize: 12, color: colors.textMuted }}>Loading templates…</div>}
              {!loadingTemplates && templates.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>No templates available.</div>
              )}
              {templates.map((t) => (
                <div key={t.rank} style={{ fontSize: 12, fontFamily: font.mono, color: "#292524", display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${colors.rowBorder}` }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12 }}>
                    {t.template ?? t.example ?? "—"}
                  </span>
                  <span style={{ color: colors.textFaint, flexShrink: 0 }}>×{t.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 8 }}>Fatal events</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {feed.length === 0 && <div style={{ fontSize: 12, color: colors.textMuted }}>None.</div>}
              {feed.slice(0, 12).map((fe) => (
                <div key={fe.key} style={{ fontSize: 12, fontFamily: font.mono, color: colors.text, display: "flex", gap: 10 }}>
                  <span style={{ color: colors.textMuted }}>{fe.time}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fe.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: `1px solid ${colors.border}` }}>
          <button
            className="ll-btn-secondary"
            onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.panel, border: `1px solid ${colors.borderStrong}`, color: colors.text, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => alert("Download PDF — report generation not wired to the backend yet.")}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.accent, color: "#fff", border: "none", cursor: "pointer" }}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
