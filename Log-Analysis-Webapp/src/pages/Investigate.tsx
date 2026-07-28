import { useMemo, useState } from "react";
import { colors, font, levelColor, typeMeta } from "../theme";
import { useAnalysis } from "../state/analysis";
import EmptyState from "../components/EmptyState";
import LoadLogButton from "../components/LoadLogButton";
import type { LogEvent } from "../types";

const CHART_BUCKETS = 40;

// Level colors for the chart bars. 
const LEVEL_COLOR: Record<string, string> = { ...levelColor, FATAL: "#eb6834" };
const LEVELS = ["SEVERE", "ERROR", "WARNING", "INFO", "FATAL"] as const;
const lvlColor = (lvl: string | null) => (lvl ? LEVEL_COLOR[lvl] : undefined) ?? colors.textMuted;

const uppercaseLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.04em",
  color: colors.textFaint,
  textTransform: "uppercase",
};

function tsMs(e: LogEvent): number {
  if (!e.timestamp) return 0;
  const t = Date.parse(e.timestamp);
  return Number.isNaN(t) ? 0 : t;
}

// Chart/range labels are formatted in UTC so they read as the same
// wall-clock the rest of the app shows (shortTime / the feed's Time
// column display the raw timestamp, and the analyzer emits UTC).
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });

type Bar = { index: number; h: number; c: string; count: number; opacity: number; outline: string; rangeLabel: string };

export default function Investigate() {
  const { result, rules, setRuleOn, empty } = useAnalysis();

  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [levelOn, setLevelOn] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LEVELS.map((l) => [l, true])),
  );
  const [loggerFilter, setLoggerFilter] = useState("");
  const [templateIdFilter, setTemplateIdFilter] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const activeEvents = useMemo(
    () => (result?.events ?? []).filter((e) => !e.ignored),
    [result],
  );

  // Bucketing window: [minTs, maxTs] split into CHART_BUCKETS.
  const { minTs, bucketDuration, hasTime } = useMemo(() => {
    const times = activeEvents.map(tsMs).filter((t) => t > 0);
    if (!times.length) return { minTs: 0, bucketDuration: 1000, hasTime: false };
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    return { minTs: lo, bucketDuration: (hi - lo) / CHART_BUCKETS || 1000, hasTime: true };
  }, [activeEvents]);

  const overallRange = useMemo(() => {
    const times = activeEvents.map(tsMs).filter((t) => t > 0);
    if (!times.length) return "—";
    return `${fmtTime(Math.min(...times))} – ${fmtTime(Math.max(...times))}`;
  }, [activeEvents]);

  const chartBars = useMemo<Bar[]>(() => {
    if (!hasTime) return [];
    const buckets = Array.from({ length: CHART_BUCKETS }, (_, index) => ({
      index,
      count: 0,
      critical: 0,
      warning: 0,
      start: minTs + index * bucketDuration,
      end: minTs + (index + 1) * bucketDuration,
    }));

    for (const e of activeEvents) {
      const t = tsMs(e);
      if (t === 0) continue;
      const idx = Math.min(Math.floor((t - minTs) / bucketDuration), CHART_BUCKETS - 1);
      if (idx < 0) continue;
      buckets[idx].count++;
      const lvl = e.level ?? "INFO";
      if (lvl === "SEVERE" || lvl === "ERROR" || lvl === "FATAL") buckets[idx].critical++;
      else if (lvl === "WARNING") buckets[idx].warning++;
    }

    const maxCount = Math.max(...buckets.map((b) => b.count), 1);
    return buckets.map((b) => {
      const c = b.critical > 0 ? levelColor.SEVERE : b.warning > 0 ? levelColor.WARNING : levelColor.INFO;
      const isSelected = selectedBucket === b.index;
      return {
        index: b.index,
        h: 4 + (b.count / maxCount) * 80,
        c,
        count: b.count,
        opacity: selectedBucket === null || isSelected ? 1 : 0.35,
        outline: isSelected ? `2px solid ${colors.text}` : "none",
        rangeLabel: `${fmtTime(b.start)} – ${fmtTime(b.end)}`,
      };
    });
  }, [activeEvents, hasTime, minTs, bucketDuration, selectedBucket]);

  const selectedBucketLabel =
    selectedBucket !== null && chartBars[selectedBucket] ? chartBars[selectedBucket].rangeLabel : "";

  const filteredEvents = useMemo(() => {
    return activeEvents.filter((e) => {
      const lvl = e.level ?? "INFO";
      if (levelOn[lvl] === false) return false;

      if (loggerFilter) {
        try {
          if (!new RegExp(loggerFilter, "i").test(e.logger ?? "")) return false;
        } catch {
          if (!(e.logger ?? "").toLowerCase().includes(loggerFilter.toLowerCase())) return false;
        }
      }

      if (templateIdFilter) {
        if (String(e.template_id) !== templateIdFilter) return false;
      }

      if (selectedBucket !== null) {
        const t = tsMs(e);
        const bucketStart = minTs + selectedBucket * bucketDuration;
        if (t < bucketStart || t > bucketStart + bucketDuration) return false;
      }

      return true;
    });
  }, [activeEvents, levelOn, loggerFilter, templateIdFilter, selectedBucket, minTs, bucketDuration]);

  // Recurring templates over active events, tagged with the first
  // enabled rule whose regex matches the template text.
  const topTemplates = useMemo(() => {
    const map = new Map<number, { id: number; text: string; count: number; level: string | null; rule: string }>();
    for (const e of activeEvents) {
      if (e.template_id == null) continue;
      const existing = map.get(e.template_id);
      if (existing) existing.count++;
      else map.set(e.template_id, { id: e.template_id, text: e.template ?? e.message, count: 1, level: e.level, rule: "none" });
    }
    const list = [...map.values()];
    for (const t of list) {
      const match = rules.find((r) => {
        if (!r.on || r.type === "time_window" || !r.regex) return false;
        try {
          return new RegExp(r.regex).test(t.text);
        } catch {
          return false;
        }
      });
      if (match) t.rule = match.id;
    }
    return list.sort((a, b) => b.count - a.count);
  }, [activeEvents, rules]);

  const activeThreads = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of activeEvents) {
      if (!e.thread_id) continue;
      map.set(e.thread_id, (map.get(e.thread_id) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [activeEvents]);

  if (empty) {
    return (
      <div>
        <div style={{ padding: "24px 24px 0 24px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>Investigate</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            Filter, chart, and drill into individual log events
          </div>
        </div>
        <EmptyState
          title="No log loaded"
          subtitle="Load a log file to explore its events, filter by level or logger, and chart volume over time."
          action={<LoadLogButton variant="cta" />}
        />
      </div>
    );
  }

  function toggleRow(key: string) {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Event volume chart */}
      <div style={{ padding: "20px 24px", background: colors.panel, borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary }}>
            Event volume over time
            <span style={{ fontWeight: 500, fontSize: 12, color: colors.accent, marginLeft: 8 }}>
              (Click a bar to filter the feed to that time range)
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 12, color: colors.textMuted }}>
            <LegendDot color={levelColor.INFO} label="INFO" />
            <LegendDot color={levelColor.WARNING} label="WARNING" />
            <LegendDot color={levelColor.SEVERE} label="SEVERE/ERROR" />
          </div>
        </div>
        {hasTime ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
            {chartBars.map((bar) => (
              <div
                key={bar.index}
                className="ll-bar ll-clickable"
                onClick={() => setSelectedBucket(selectedBucket === bar.index ? null : bar.index)}
                title={`${bar.count} events (${bar.rangeLabel})`}
                style={{ width: "100%", height: bar.h, background: bar.c, borderRadius: "2px 2px 0 0", opacity: bar.opacity, outline: bar.outline }}
              />
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: colors.textMuted, padding: "24px 0" }}>
            No timestamped events to chart.
          </div>
        )}
        {selectedBucket !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: colors.accent, background: colors.accentBg, padding: "3px 8px", borderRadius: 5 }}>
              Filtered to {selectedBucketLabel}
            </span>
            <span onClick={() => setSelectedBucket(null)} className="ll-clickable" style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}>
              Clear
            </span>
          </div>
        )}
      </div>

      {/* Filter rail · event feed · side panel */}
      <div className="ll-investigate-body">
        {/* Left: filters */}
        <div style={{ padding: 20, borderRight: `1px solid ${colors.border}`, background: colors.panel, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={uppercaseLabel}>Filters</div>
            <div
              onClick={() => { setLoggerFilter(""); setTemplateIdFilter(""); setSelectedBucket(null); setLevelOn(Object.fromEntries(LEVELS.map((l) => [l, true]))); }}
              className="ll-clickable"
              style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, padding: "3px 8px", borderRadius: 5, background: colors.surfaceMuted }}
            >
              Reset
            </div>
          </div>

          <Field label="Time range">
            <div style={{ fontSize: 13, fontFamily: font.mono, background: colors.surfaceMuted, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "7px 8px" }}>
              {selectedBucket !== null ? selectedBucketLabel : overallRange}
            </div>
          </Field>

          <Field label="Log level">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {LEVELS.map((lvl) => (
                <label key={lvl} className="ll-clickable" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: colors.textSecondary }}>
                  <input type="checkbox" checked={levelOn[lvl] ?? true} onChange={() => setLevelOn((p) => ({ ...p, [lvl]: !(p[lvl] ?? true) }))} />
                  <span style={{ color: lvlColor(lvl), fontWeight: 600 }}>{lvl}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Logger">
            <input
              value={loggerFilter}
              onChange={(e) => setLoggerFilter(e.target.value)}
              placeholder="Filter by logger regex…"
              style={{ width: "100%", fontSize: 13, fontFamily: font.mono, background: colors.surfaceMuted, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "7px 8px", color: colors.textSecondary, outline: "none" }}
            />
          </Field>

          <Field label="Template ID">
            <select
              value={templateIdFilter}
              onChange={(e) => setTemplateIdFilter(e.target.value)}
              style={{ width: "100%", fontSize: 13, fontFamily: font.mono, background: colors.surfaceMuted, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "7px 8px", color: colors.textSecondary, outline: "none" }}
            >
              <option value="">any</option>
              {topTemplates.slice(0, 10).map((t) => (
                <option key={t.id} value={String(t.id)}>Template #{t.id} (×{t.count})</option>
              ))}
            </select>
          </Field>

          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted }}>ACTIVE TRIAGE RULES</div>
              <span
                title="Triage rules currently tagging or hiding events in this feed. Toggle them here or edit them on the Rules page."
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: colors.border, color: colors.textMuted, fontSize: 10, fontWeight: 700, cursor: "help" }}
              >
                i
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
              {rules.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>No active rules.</div>
              )}
              {rules.map((rule) => {
                const meta = typeMeta[rule.type];
                return (
                  <div key={rule.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: "8px 10px", background: rule.on ? colors.panel : colors.surfaceMuted, opacity: rule.on ? 1 : 0.6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                      <label className="ll-clickable" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: colors.textMuted }}>
                        <input type="checkbox" checked={rule.on} onChange={() => setRuleOn(rule.id, !rule.on)} style={{ transform: "scale(0.85)", margin: 0 }} />
                        On
                      </label>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rule.id}>
                      {rule.id}
                    </div>
                    <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2, fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Matches: ${rule.regex}`}>
                      re: {rule.regex}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Middle: event feed */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${colors.border}`, background: colors.appBg }}>
          <div style={{ display: "flex", gap: 12, padding: "10px 20px", background: colors.panel, borderBottom: `1px solid ${colors.border}`, ...uppercaseLabel }}>
            <div style={{ width: 60 }}>Line</div>
            <div style={{ width: 90 }}>Time</div>
            <div style={{ width: 60 }}>Level</div>
            <div style={{ width: 170 }}>Logger#method</div>
            <div style={{ flex: 1, textTransform: "none", fontWeight: 500, color: colors.textMuted }}>
              Message <span style={{ marginLeft: 8 }}>(Click a row to expand details)</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {filteredEvents.slice(0, 100).map((ev) => {
              const key = String(ev.line_start);
              const expanded = !!expandedRows[key];
              return (
                <div key={key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <div onClick={() => toggleRow(key)} className="ll-row ll-clickable" style={{ display: "flex", gap: 12, padding: "10px 20px", fontSize: 12.5, fontFamily: font.mono, alignItems: "center" }}>
                    <div style={{ width: 60, color: colors.textFaint }}>{ev.line_start}</div>
                    <div style={{ width: 90, color: colors.textMuted }}>
                      {ev.timestamp_raw ? (ev.timestamp_raw.split(" ").pop() ?? "").substring(0, 12) : "—"}
                    </div>
                    <div style={{ width: 60, fontWeight: 700, color: lvlColor(ev.level) }}>{ev.level}</div>
                    <div style={{ width: 170, color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ev.logger ?? ""}>
                      {ev.logger}
                    </div>
                    <div style={{ flex: 1, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ev.message}>
                      {ev.message}
                    </div>
                    <span style={{ fontSize: 11, color: colors.textFaint, userSelect: "none" }}>{expanded ? "▲" : "▼"}</span>
                  </div>

                  {expanded && (
                    <div style={{ padding: "16px 20px 20px 92px", background: colors.panel, fontFamily: font.mono, fontSize: 12.5, color: colors.textSecondary, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div><span style={{ color: colors.textFaint }}>thread_id&nbsp;</span>{ev.thread_id ?? "—"}</div>
                      <div><span style={{ color: colors.textFaint }}>logger#method&nbsp;</span>{ev.logger}{ev.method ? `#${ev.method}` : ""}</div>
                      <div><span style={{ color: colors.textFaint }}>full message&nbsp;</span>{ev.message}</div>
                      {ev.stack_trace && (
                        <div style={{ whiteSpace: "pre-wrap", background: colors.surfaceMuted, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 10, fontSize: 12 }}>
                          {ev.stack_trace}
                        </div>
                      )}
                      {ev.tags.length > 0 && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                          {ev.tags.map((tag) => (
                            <span key={tag} style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 5, background: colors.accentBg, color: colors.accent }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredEvents.length === 0 && (
              <div style={{ padding: 48, textAlign: "center", fontSize: 14, color: colors.textFaint }}>
                No events match the active filters.
              </div>
            )}
          </div>
        </div>

        {/* Right: side stats */}
        <div style={{ padding: 20, background: colors.panel, display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 10 }}>Top templates</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topTemplates.slice(0, 5).map((tpl) => (
                <div key={tpl.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: lvlColor(tpl.level) }}>{tpl.level}</span>
                    <span style={{ fontSize: 11, color: colors.textFaint, fontFamily: font.mono }}>×{tpl.count}</span>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: font.mono, color: "#292524", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tpl.text}>
                    {tpl.text}
                  </div>
                  <div style={{ fontSize: 11, color: colors.accent }}>↳ rule: {tpl.rule}</div>
                </div>
              ))}
              {topTemplates.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>No templates found.</div>
              )}
            </div>
          </div>

          <div>
            <div style={{ ...uppercaseLabel, marginBottom: 10 }}>Active threads</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeThreads.slice(0, 5).map((th) => (
                <div key={th.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontFamily: font.mono, padding: "6px 8px", borderRadius: 6, background: colors.surfaceMuted }}>
                  <span style={{ color: "#292524", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{th.name}</span>
                  <span style={{ color: colors.textFaint, flexShrink: 0, marginLeft: 8 }}>{th.count}</span>
                </div>
              ))}
              {activeThreads.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>No thread data.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span>
      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 5 }} />
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, marginBottom: 6 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}
