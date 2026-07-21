// @ts-nocheck
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie
} from "recharts";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

// Tidepool categorical + status palette (from CDS skill)
const LEVEL_CONFIG = {
  SEVERE: { color: "#d03b3b", bg: "rgba(208,59,59,0.10)", badge: "#d03b3b", label: "SEVERE" },
  ERROR:  { color: "#d03b3b", bg: "rgba(208,59,59,0.10)", badge: "#d03b3b", label: "ERROR" },
  FATAL:  { color: "#eb6834", bg: "rgba(235,104,52,0.10)", badge: "#eb6834", label: "FATAL" },
  WARNING:{ color: "#fab219", bg: "rgba(250,178,25,0.10)", badge: "#fab219", label: "WARNING" },
  INFO:   { color: "#1baf7a", bg: "rgba(27,175,122,0.10)", badge: "#1baf7a", label: "INFO" },
};

const CHART_COLORS = {
  INFO:    "#1baf7a",
  WARNING: "#fab219",
  ERROR:   "#d03b3b",
  SEVERE:  "#d03b3b",
  FATAL:   "#eb6834",
};



// ─────────────────────────────────────────────────────────────
// MOCK DATA GENERATION
// ─────────────────────────────────────────────────────────────

//ONLY FOR DEMO PURPOSES, generate a set of mock log events with realistic timestamps, levels, and messages. This is used when no log file is uploaded to the app.
function generateMockEvents() {
  const now = Date.now();
  const loggers = [
    "hudson.model.Run", "hudson.plugins.git.GitSCM",
    "jenkins.model.Jenkins", "org.jenkinsci.plugins.workflow.job.WorkflowRun",
    "hudson.tasks.Maven", "hudson.slaves.NodeProvisioner",
    "hudson.remoting.Channel", "hudson.model.Executor",
    "org.springframework.context.support.AbstractApplicationContext",
    "com.cloudbees.workflow.rest.external.RunExt",
  ];
  const templates = [
    { id: 1, t: "Failed to run job <*>: <*>", msgs: ["Failed to run job pipeline-build: exit code 1","Failed to run job deploy-staging: timeout","Failed to run job compile-service: compilation error"] },
    { id: 2, t: "Could not fetch <*> from <*>", msgs: ["Could not fetch origin/main from https://github.com/org/repo","Could not fetch origin/release from git@github.com:org/api"] },
    { id: 3, t: "OutOfMemoryError: Java heap space in <*>", msgs: ["OutOfMemoryError: Java heap space in hudson.model.Run.run","OutOfMemoryError: Java heap space in com.example.BuildStep.execute"] },
    { id: 4, t: "Build step <*> marked build as failure", msgs: ["Build step 'Execute shell' marked build as failure","Build step 'Maven' marked build as failure","Build step 'Docker Build' marked build as failure"] },
    { id: 5, t: "NullPointerException at <*>", msgs: ["NullPointerException at org.jenkinsci.plugins.workflow.support.steps.ExecutorStepExecution.run","NullPointerException at hudson.model.Executor.run"] },
    { id: 6, t: "Plugin <*> failed to load", msgs: ["Plugin docker-plugin failed to load","Plugin kubernetes failed to load","Plugin pipeline-model-definition failed to load"] },
    { id: 7, t: "Connection to <*> refused", msgs: ["Connection to sonarqube:9000 refused","Connection to artifactory.internal:8081 refused","Connection to nexus:8443 refused"] },
    { id: 8, t: "Agent <*> disconnected unexpectedly", msgs: ["Agent worker-01 disconnected unexpectedly","Agent worker-02 disconnected unexpectedly","Agent build-agent-3 disconnected unexpectedly"] },
    { id: 9, t: "Test failure in <*>: expected <*> but was <*>", msgs: ["Test failure in UserServiceTest: expected 200 but was 404","Test failure in IntegrationTest: expected true but was false"] },
    { id: 10, t: "Workspace <*> is not accessible", msgs: ["Workspace /var/jenkins_home/workspace/pipeline-build is not accessible","Workspace /var/jenkins_home/workspace/deploy is not accessible"] },
  ];
  const levelDist = ["INFO","INFO","INFO","INFO","INFO","WARNING","WARNING","ERROR","SEVERE","FATAL"];

  const events = [];
  for (let i = 0; i < 150; i++) {
    // More recent events are more likely (sqrt distribution over 48h)
    const age = Math.pow(Math.random(), 0.4) * 48 * 3600 * 1000;
    const ts = new Date(now - age);
    const level = levelDist[Math.floor(Math.random() * levelDist.length)];
    const logger = loggers[Math.floor(Math.random() * loggers.length)];
    const tmpl = templates[Math.floor(Math.random() * templates.length)];
    const msg = tmpl.msgs[Math.floor(Math.random() * tmpl.msgs.length)];
    const threadNum = Math.floor(Math.random() * 18) + 1;
    const lineStart = (i + 1) * 7 + Math.floor(Math.random() * 5);
    const isFatal = ["SEVERE","ERROR","FATAL"].includes(level);

    events.push({
      id: `evt-${i}`,
      line_start: lineStart,
      timestamp_raw: ts.toISOString().replace("T"," ").replace("Z","+0000").substring(0,28),
      timestamp: ts.toISOString(),
      timestampMs: ts.getTime(),
      thread_id: `Thread-${threadNum}`,
      level,
      logger,
      method: "execute",
      message: msg,
      stack_trace: isFatal
        ? `java.lang.${msg.includes("OutOfMemory") ? "OutOfMemoryError: Java heap space" : msg.includes("Null") ? "NullPointerException" : "RuntimeException: " + msg.substring(0,60)}\n\tat ${logger}.execute(${logger.split(".").pop()}.java:${Math.floor(Math.random()*500)+50})\n\tat hudson.model.Executor.run(Executor.java:${Math.floor(Math.random()*300)+100})\n\tat java.lang.Thread.run(Thread.java:748)`
        : null,
      raw: `${ts.toISOString().substring(0,23)} [${level}] [${logger}] ${msg}`,
      template_id: tmpl.id,
      template: tmpl.t,
      tags: [],
      ignored: false,
    });
  }
  return events.sort((a, b) => a.timestampMs - b.timestampMs);
}

// ─────────────────────────────────────────────────────────────
// ANTHROPIC API
// ─────────────────────────────────────────────────────────────

// Placeholder until the AI backend is wired up. Callers already try/catch.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function callClaude(messages, system) {
  throw new Error("AI analysis is not available yet (backend not connected).");
}

function buildSystemContext(events) {
  const total = events.length;
  const levels = {};
  events.forEach(e => { levels[e.level] = (levels[e.level] || 0) + 1; });
  const errors = events.filter(e => ["SEVERE","ERROR","FATAL"].includes(e.level));
  const recentErrors = errors.slice(-8).map(e =>
    `[${e.level}] ${e.timestamp_raw?.substring(0,19) ?? "?"} | ${e.logger?.split(".").pop()} | ${e.message}`
  ).join("\n");
  const templateMap = {};
  events.forEach(e => {
    if (!e.template_id) return;
    templateMap[e.template_id] = templateMap[e.template_id] || { t: e.template, count: 0 };
    templateMap[e.template_id].count++;
  });
  const topTemplates = Object.values(templateMap)
    .sort((a,b) => b.count - a.count).slice(0,5)
    .map(x => `  • "${x.t}" (×${x.count})`).join("\n");
  const timeRange = total > 0
    ? `${events[0].timestamp_raw?.substring(0,19) ?? "?"} → ${events[total-1].timestamp_raw?.substring(0,19) ?? "?"}`
    : "unknown";

  return `You are a Jenkins CI/CD log analyst helping a DevOps/SRE engineer.

Log file summary:
• Total events: ${total}
• Level breakdown: ${Object.entries(levels).map(([l,c])=>`${l}=${c}`).join(", ")}
• Time range: ${timeRange}
• Error rate: ${((errors.length/Math.max(total,1))*100).toFixed(1)}%

Top recurring templates:
${topTemplates}

Recent errors and fatals:
${recentErrors}

Answer concisely in plain English. Focus on actionable insights. Max 200 words.`;
}

// ─────────────────────────────────────────────────────────────
// HEALTH SCORE
// ─────────────────────────────────────────────────────────────

function HealthScore({ events }) {
  const total = events.length;
  if (!total) return null;
  const errors = events.filter(e => ["SEVERE","ERROR","FATAL"].includes(e.level)).length;
  const rate = errors / total;
  const score = Math.round(Math.max(0, Math.min(100, (1 - rate * 4) * 100)));
  const color = score > 75 ? "#0ca30c" : score > 45 ? "#fab219" : "#d03b3b";
  const label = score > 75 ? "Healthy" : score > 45 ? "Degraded" : "Critical";
  const r = 22, cx = 28, cy = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-label={`Log health score: ${score} — ${label}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
        <text x={cx} y={cy+5} textAnchor="middle" fontSize="13" fontWeight="500"
          fontFamily="var(--font-mono)" fill={color}>{score}</text>
      </svg>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{errors} errors of {total}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// STAT CARD (clickable)
// ─────────────────────────────────────────────────────────────

function StatCard({ label, value, subtext, accentColor, onClick, active }) {
  return (
    <button onClick={onClick}
      style={{
        background: "var(--surface-1)",
        border: active ? `1.5px solid ${accentColor}` : "0.5px solid var(--border)",
        borderRadius: 12, padding: "14px 16px", textAlign: "left",
        cursor: "pointer", width: "100%", transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: active ? `0 0 0 3px ${accentColor}22` : "none",
        position: "relative", overflow: "hidden",
      }}>
      {active && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: accentColor }} />
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 500, fontFamily: "var(--font-mono)", color: accentColor, lineHeight: 1 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {subtext && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{subtext}</div>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// EVENT VOLUME CHART
// ─────────────────────────────────────────────────────────────

function EventVolumeChart({ events }) {
  const chartData = useMemo(() => {
    if (!events.length) return [];
    const firstMs = events[0].timestampMs || new Date(events[0].timestamp).getTime();
    const lastMs = events[events.length - 1].timestampMs || new Date(events[events.length - 1].timestamp).getTime();
    const effectiveSecs = (lastMs - firstMs) / 1000 + 3600;
    const buckets = 24;
    const bucketMs = (effectiveSecs * 1000) / buckets;
    const startMs = firstMs;

    const data = Array.from({ length: buckets }, (_, i) => {
      const t = new Date(startMs + i * bucketMs);
      const lbl = effectiveSecs <= 86400
        ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : t.toLocaleDateString([], { month: "short", day: "numeric" });
      return { label: lbl, INFO: 0, WARNING: 0, ERROR: 0, SEVERE: 0, FATAL: 0 };
    });

    const len = events.length;
    for (let i = 0; i < len; i++) {
      const e = events[i];
      const eMs = e.timestampMs || new Date(e.timestamp).getTime();
      const idx = Math.min(Math.floor((eMs - startMs) / bucketMs), buckets - 1);
      if (idx >= 0 && idx < buckets) {
        data[idx][e.level] = (data[idx][e.level] || 0) + 1;
      }
    }
    return data;
  }, [events]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-strong)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
        <div style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: 6 }}>{label}</div>
        {payload.map(p => p.value > 0 && (
          <div key={p.name} style={{ color: CHART_COLORS[p.name] ?? "var(--text-secondary)", display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>{p.name}</span><span style={{ fontFamily: "var(--font-mono)" }}>{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <defs>
          {Object.entries(CHART_COLORS).map(([k, v]) => (
            <linearGradient key={k} id={`vg-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={v} stopOpacity={0.25} />
              <stop offset="100%" stopColor={v} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <Tooltip content={<CustomTooltip />} />
        {["INFO","WARNING","ERROR","SEVERE","FATAL"].map(l => (
          <Area key={l} type="monotone" dataKey={l} stackId="1"
            stroke={CHART_COLORS[l]} fill={`url(#vg-${l})`} strokeWidth={1.5} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────
// TOP TEMPLATES PANEL
// ─────────────────────────────────────────────────────────────

function TemplateRow({ t, index, maxCount }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--surface-0)", borderRadius: 8, border: `0.5px solid ${expanded ? "#2a78d644" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.2s" }}>
      <div
        onClick={() => setExpanded(x => !x)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: 16, flexShrink: 0 }}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: expanded ? "normal" : "nowrap", wordBreak: "break-all",
          }}>
            {t.template || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No pattern — {t.sample?.substring(0, 80)}</span>}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
            {Object.entries(t.levels).map(([lvl, cnt]) => (
              <span key={lvl} style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 10,
                background: LEVEL_CONFIG[lvl]?.bg, color: LEVEL_CONFIG[lvl]?.color,
                border: `0.5px solid ${LEVEL_CONFIG[lvl]?.color}44`,
              }}>{lvl} ×{cnt}</span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 40, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{t.count}</div>
            <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginTop: 4, width: 48 }}>
              <div style={{ height: 3, background: "#d03b3b", borderRadius: 2, width: `${Math.round((t.count / maxCount) * 100)}%`, transition: "width 0.4s ease" }} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)", width: 12 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", background: "rgba(0,0,0,0.15)", padding: "12px 14px", borderTop: "0.5px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Full Template Pattern</div>
            {t.template
              ? <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", color: "var(--text-primary)", background: "var(--surface-0)", padding: 8, borderRadius: 6, border: "0.5px solid var(--border)", wordBreak: "break-all", lineHeight: 1.5 }}>{t.template}</div>
              : <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>⚠ Template pattern not stored — showing example message as fallback.</div>
            }
          </div>
          {t.sample && (
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Example Log Message</div>
              <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", background: "var(--surface-0)", padding: 8, borderRadius: 6, border: "0.5px solid var(--border)", wordBreak: "break-all", lineHeight: 1.5 }}>{t.sample}</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Template ID: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{t.id}</span>
            <span style={{ margin: "0 8px" }}>·</span>
            Total occurrences: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{t.count}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TopTemplatesPanel({ events, limit = 7 }) {
  const data = useMemo(() => {
    const map = {};
    events.forEach(e => {
      if (!e.template_id) return;
      if (!map[e.template_id]) map[e.template_id] = { id: e.template_id, template: e.template, count: 0, levels: {}, sample: e.message };
      if (["SEVERE","ERROR","FATAL","WARNING"].includes(e.level)) {
        map[e.template_id].count++;
        map[e.template_id].levels[e.level] = (map[e.template_id].levels[e.level] || 0) + 1;
      }
    });
    return Object.values(map).filter(x => x.count > 0).sort((a,b) => b.count - a.count).slice(0, limit);
  }, [events, limit]);

  const maxCount = data[0]?.count ?? 1;
  if (!data.length) return <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0", textAlign: "center" }}>No recurring error patterns in this window.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((t, i) => (
        <TemplateRow key={t.id} t={t} index={i} maxCount={maxCount} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// THREAD ACTIVITY
// ─────────────────────────────────────────────────────────────

function ThreadActivityPanel({ events }) {
  const [selectedThread, setSelectedThread] = useState(null);

  const threads = useMemo(() => {
    const map = {};
    events.forEach(e => {
      if (!e.thread_id) return;
      if (!map[e.thread_id]) map[e.thread_id] = { id: e.thread_id, total: 0, errors: 0, warnings: 0, info: 0, levels: {} };
      map[e.thread_id].total++;
      map[e.thread_id].levels[e.level] = (map[e.thread_id].levels[e.level] || 0) + 1;
      if (["SEVERE","ERROR","FATAL"].includes(e.level)) map[e.thread_id].errors++;
      else if (e.level === "WARNING") map[e.thread_id].warnings++;
      else if (e.level === "INFO") map[e.thread_id].info++;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }, [events]);

  const top15 = threads.slice(0, 15);
  const totalThreads = threads.length;
  const threadsWithErrors = threads.filter(t => t.errors > 0).length;
  const cleanThreads = totalThreads - threadsWithErrors;
  const totalErrors = threads.reduce((s, t) => s + t.errors, 0);
  const busiestThread = threads[0];

  // Data for stacked horizontal bar chart
  const barData = top15.map(t => ({
    id: t.id.length > 20 ? t.id.substring(0, 18) + "…" : t.id,
    fullId: t.id,
    errors: t.errors,
    warnings: t.warnings,
    info: t.info,
    total: t.total,
    errorRate: t.total > 0 ? Math.round((t.errors / t.total) * 100) : 0,
  }));

  // Pie chart: top threads by error count
  const errorPieData = top15
    .filter(t => t.errors > 0)
    .slice(0, 8)
    .map((t, i) => ({
      name: t.id.length > 16 ? t.id.substring(0, 14) + "…" : t.id,
      value: t.errors,
      fill: ["#d03b3b","#eb6834","#fab219","#2a78d6","#1baf7a","#9b59b6","#e74c3c","#3498db"][i % 8],
    }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 12 }}>
        <div style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", marginBottom: 6, fontWeight: 600 }}>{d?.fullId ?? label}</div>
        {payload.map(p => (
          <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill ?? p.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text-secondary)", textTransform: "capitalize" }}>{p.name}:</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", fontWeight: 600 }}>{p.value}</span>
          </div>
        ))}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "0.5px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Total: {d?.total} · Error rate: {d?.errorRate}%
        </div>
      </div>
    );
  };

  if (!threads.length) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No thread data available.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── KPI Summary Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {[
          { label: "Total threads", value: totalThreads, color: "var(--text-primary)", icon: "◫" },
          { label: "Threads with errors", value: threadsWithErrors, color: "#d03b3b", icon: "⚠" },
          { label: "Clean threads", value: cleanThreads, color: "#1baf7a", icon: "✓" },
          { label: "Total error events", value: totalErrors, color: "#eb6834", icon: "✕" },
          busiestThread && { label: "Busiest thread", value: busiestThread.total + " events", color: "#2a78d6", icon: "◷", sub: busiestThread.id.substring(0, 18) },
        ].filter(Boolean).map(card => (
          <div key={card.label} style={{ background: "var(--surface-0)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{card.icon} {card.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: card.color, fontFamily: "var(--font-mono)" }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.sub}…</div>}
          </div>
        ))}
      </div>

      {/* ── Stacked Bar Chart: event composition per thread ── */}
      <div style={{ background: "var(--surface-0)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Event breakdown by thread (top {top15.length})</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>Stacked by severity — hover a bar for details</div>
        <ResponsiveContainer width="100%" height={Math.max(220, top15.length * 28)}>
          <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 40, left: 80, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <YAxis type="category" dataKey="id" tick={{ fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-mono)" }} width={78} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="errors" name="Errors" stackId="a" fill="#d03b3b" radius={[0,0,0,0]} isAnimationActive={false} />
            <Bar dataKey="warnings" name="Warnings" stackId="a" fill="#fab219" radius={[0,0,0,0]} isAnimationActive={false} />
            <Bar dataKey="info" name="Info" stackId="a" fill="#2a78d6" radius={[0,4,4,0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 16, marginTop: 10, justifyContent: "center" }}>
          {[["#d03b3b","Errors"],["#fab219","Warnings"],["#2a78d6","Info"]].map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* ── Two column: Pie + Error rate table ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Pie: error share */}
        <div style={{ background: "var(--surface-0)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Error share by thread</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>Top threads by error count</div>
          {errorPieData.length === 0
            ? <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 24 }}>No errors in this time window.</p>
            : <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={errorPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} paddingAngle={2} label={({ name, percent }) => `${name} ${Math.round(percent*100)}%`} labelLine={false} isAnimationActive={false}>
                      {errorPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                  {errorPieData.map(d => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: d.fill, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      <span style={{ color: "#d03b3b", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>

        {/* Table: error rate per thread */}
        <div style={{ background: "var(--surface-0)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Error rate per thread</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>% of events that are errors/fatals</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {top15.map(t => {
              const rate = t.total > 0 ? (t.errors / t.total) * 100 : 0;
              const color = rate > 50 ? "#d03b3b" : rate > 20 ? "#fab219" : "#1baf7a";
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.id}</span>
                  <div style={{ flex: 1, height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${rate}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color, width: 34, textAlign: "right", flexShrink: 0 }}>{Math.round(rate)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Expandable thread detail cards ── */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>All threads — click to expand</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {threads.map(t => {
            const isOpen = selectedThread === t.id;
            const rate = t.total > 0 ? Math.round((t.errors / t.total) * 100) : 0;
            const health = rate > 50 ? { label: "Critical", color: "#d03b3b" } : rate > 20 ? { label: "Degraded", color: "#fab219" } : rate > 0 ? { label: "Minor issues", color: "#eb6834" } : { label: "Healthy", color: "#1baf7a" };
            return (
              <div key={t.id} style={{ background: "var(--surface-0)", borderRadius: 10, border: `0.5px solid ${isOpen ? "#2a78d644" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.2s" }}>
                <div
                  onClick={() => setSelectedThread(isOpen ? null : t.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer", userSelect: "none" }}
                >
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.id}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: health.color + "22", color: health.color, border: `0.5px solid ${health.color}44`, fontWeight: 600, flexShrink: 0 }}>{health.label}</span>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", flexShrink: 0 }}>{t.total} events</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div style={{ background: "rgba(0,0,0,0.12)", padding: "14px 16px", borderTop: "0.5px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Total events</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{t.total}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Error rate</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: health.color }}>{rate}%</div>
                    </div>
                    {Object.entries(t.levels).sort((a,b) => b[1]-a[1]).map(([lvl, cnt]) => (
                      <div key={lvl}>
                        <div style={{ fontSize: 10, color: LEVEL_CONFIG[lvl]?.color ?? "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{lvl}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: LEVEL_CONFIG[lvl]?.color ?? "var(--text-secondary)" }}>{cnt}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{Math.round((cnt/t.total)*100)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// EVENT ROW (with inline AI analysis)
// ─────────────────────────────────────────────────────────────

function EventRow({ event, allEvents }) {
  const [expanded, setExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const cfg = LEVEL_CONFIG[event.level] ?? { color: "var(--text-secondary)", bg: "var(--surface-0)", badge: "var(--text-muted)" };
  const isCritical = ["SEVERE","ERROR","FATAL"].includes(event.level);

  async function explain() {
    setAiOpen(o => { if (!o) return true; return o; });
    if (aiText || aiLoading) return;
    setAiLoading(true);
    try {
      const system = buildSystemContext(allEvents);
      const prompt = `Analyze this specific log event. Respond with exactly 3 short sections:\n1. What happened (1 sentence)\n2. Likely cause (1-2 sentences)\n3. Fix (1-2 action steps)\n\nEvent:\nLevel: ${event.level}\nLogger: ${event.logger}\nMessage: ${event.message}${event.stack_trace ? `\nStack:\n${event.stack_trace}` : ""}\nThread: ${event.thread_id}\nTimestamp: ${event.timestamp_raw}`;
      const reply = await callClaude([{ role: "user", content: prompt }], system);
      setAiText(reply);
    } catch(e) {
      setAiText(`Analysis failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div style={{
      background: "var(--surface-1)", borderRadius: 8,
      border: `0.5px solid ${expanded ? "#2a78d622" : "var(--border)"}`,
      overflow: "hidden", transition: "border-color 0.2s",
    }}>
      {/* ── Summary row (always visible) ── */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", cursor: "pointer" }}
      >
        <span style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 500, flexShrink: 0, marginTop: 2,
          background: cfg.bg, color: cfg.color, border: `0.5px solid ${cfg.color}44`,
          fontFamily: "var(--font-mono)",
        }}>{event.level}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.message}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, fontFamily: "var(--font-mono)" }}>
            L{event.line_start} · {event.timestamp_raw?.substring(0,23) ?? "—"} · {event.logger?.split(".").pop()} · {event.thread_id}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          {isCritical && (
            <button
              onClick={e => { e.stopPropagation(); explain(); }}
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                background: aiOpen ? "rgba(42,120,214,0.15)" : "var(--surface-0)",
                color: "#2a78d6", border: `0.5px solid ${aiOpen ? "#2a78d6" : "#2a78d644"}`,
                fontWeight: 500, transition: "all 0.15s",
              }}
            >✦ Explain</button>
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)", userSelect: "none" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--surface-0)", padding: "14px 16px", borderTop: "0.5px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Full Message */}
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Full Message</div>
            <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "0.5px solid var(--border)", color: "var(--text-primary)", lineHeight: 1.5 }}>
              {event.message}
            </div>
          </div>

          {/* Metadata Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {[
              ["Timestamp", event.timestamp_raw ?? "—"],
              ["Line", `L${event.line_start}${event.line_end ? ` – L${event.line_end}` : ""}`],
              ["Logger", event.logger ?? "—"],
              event.method && ["Method", event.method],
              ["Thread", event.thread_id ?? "—"],
              event.template_id != null && ["Template ID", String(event.template_id)],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label}>
                <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{label}: </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{value}</span>
              </div>
            ))}
            {event.tags?.length > 0 && (
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, color: "var(--text-muted)", marginRight: 4 }}>Tags:</span>
                {event.tags.map(t => (
                  <span key={t} style={{ fontSize: 10, background: "rgba(42,120,214,0.15)", color: "#8ec5ff", padding: "2px 8px", borderRadius: 4, border: "0.5px solid rgba(42,120,214,0.3)" }}>{t}</span>
                ))}
              </div>
            )}
          </div>

          {/* Template Pattern */}
          {event.template && (
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Template Pattern</div>
              <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "0.5px solid var(--border)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {event.template}
              </div>
            </div>
          )}

          {/* Stack Trace */}
          {event.stack_trace && (
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Stack Trace</div>
              <pre style={{ fontSize: 11, background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "0.5px solid var(--border)", overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", margin: 0, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                {event.stack_trace}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── AI Analysis panel ── */}
      {aiOpen && (
        <div style={{ borderTop: "0.5px solid #2a78d622", background: "rgba(42,120,214,0.04)", padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#2a78d6" }}>✦ AI Analysis</span>
            <button onClick={() => setAiOpen(false)} style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>✕</button>
          </div>
          {aiLoading
            ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Analyzing event<span style={{ animation: "dots 1.2s steps(3) infinite" }}>...</span></div>
            : <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiText}</div>
          }
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI CHAT PANEL
// ─────────────────────────────────────────────────────────────

function AIChatPanel({ events, onClose }) {
  const [msgs, setMsgs] = useState([
    { role: "assistant", content: "I have your log file in context. Ask me about error patterns, root causes, or what needs attention first." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const QUICK = [
    "What are the most critical issues?",
    "Which builds are failing most often?",
    "What's causing the OOM errors?",
    "Summarize the top 3 problems",
  ];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send(text) {
    const userText = text || input;
    if (!userText.trim() || loading) return;
    setInput("");
    const updated = [...msgs, { role: "user", content: userText }];
    setMsgs(updated);
    setLoading(true);
    try {
      const apiMsgs = updated
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map(m => ({ role: m.role, content: m.content }));
      const reply = await callClaude(apiMsgs, buildSystemContext(events));
      setMsgs([...updated, { role: "assistant", content: reply }]);
    } catch(e) {
      setMsgs([...updated, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, height: "100%", width: 380,
      background: "var(--surface-panel)", borderLeft: "0.5px solid var(--border-strong)",
      display: "flex", flexDirection: "column", zIndex: 50,
      boxShadow: "var(--shadow-lg)",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: "0.5px solid var(--border)", background: "var(--surface-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2a78d6", boxShadow: "0 0 0 3px #2a78d622" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Log Analyst</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{events.length} events in context</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-muted)", lineHeight: 1, padding: "4px 6px" }}>✕</button>
        </div>
      </div>

      {/* Quick prompts (first screen only) */}
      {msgs.length <= 1 && (
        <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {QUICK.map(q => (
            <button key={q} onClick={() => send(q)}
              style={{
                fontSize: 11, textAlign: "left", padding: "9px 10px", borderRadius: 8,
                background: "var(--surface-1)", border: "0.5px solid var(--border)",
                cursor: "pointer", color: "var(--text-secondary)", lineHeight: 1.4,
                transition: "border-color 0.15s, color 0.15s",
              }}>{q}</button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "88%", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.6,
              background: m.role === "user" ? "#2a78d6" : "var(--surface-2)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              border: m.role === "user" ? "none" : "0.5px solid var(--border)",
              borderBottomRightRadius: m.role === "user" ? 4 : 12,
              borderBottomLeftRadius: m.role === "assistant" ? 4 : 12,
            }}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "10px 14px", borderRadius: 12, borderBottomLeftRadius: 4, background: "var(--surface-2)", border: "0.5px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#2a78d6",
                    animation: `bounce 1s ${i*0.2}s ease-in-out infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 14px", borderTop: "0.5px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ask about your logs…"
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--surface-1)", border: "0.5px solid var(--border-strong)",
              color: "var(--text-primary)", outline: "none",
            }} />
          <button onClick={() => send()} disabled={loading || !input.trim()}
            style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: "#2a78d6", color: "#fff", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              opacity: loading || !input.trim() ? 0.5 : 1, transition: "opacity 0.15s",
            }}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LEVEL DISTRIBUTION MINI BAR
// ─────────────────────────────────────────────────────────────

function LevelDistBar({ events }) {
  const total = events.length;
  if (!total) return null;
  const counts = {};
  events.forEach(e => { counts[e.level] = (counts[e.level] || 0) + 1; });
  const ordered = ["FATAL","SEVERE","ERROR","WARNING","INFO"].filter(l => counts[l]);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {ordered.map(l => (
        <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: LEVEL_CONFIG[l]?.color, flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)" }}>{l}</span>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{counts[l]}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>({Math.round((counts[l]/total)*100)}%)</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FILE UPLOAD ZONE
// ─────────────────────────────────────────────────────────────

function FileUploadZone({ onFile, loading }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      style={{
        border: `2px dashed ${drag ? "#60a5fa" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 20,
        padding: "54px 36px",
        textAlign: "center",
        cursor: "pointer",
        background: drag ? "rgba(96,165,250,0.06)" : "rgba(17,25,46,0.45)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        transform: drag ? "scale(1.02)" : "scale(1)",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "#60a5fa";
        e.currentTarget.style.background = "rgba(17,25,46,0.6)";
        e.currentTarget.style.transform = "scale(1.01)";
      }}
      onMouseLeave={e => {
        if (!drag) {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
          e.currentTarget.style.background = "rgba(17,25,46,0.45)";
          e.currentTarget.style.transform = "scale(1)";
        }
      }}
    >
      <input ref={ref} type="file" accept=".log,.txt" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(96,165,250,0.2)", borderTopColor: "#60a5fa", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500 }}>Analyzing log file…</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 40, marginBottom: 14, filter: "drop-shadow(0 4px 12px rgba(96,165,250,0.2))" }}>📂</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6, letterSpacing: "-0.01em" }}>Drop a Jenkins log file here</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>.log or .txt — or click to browse</div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [allEvents, setAllEvents] = useState([]);
  const [hasData, setHasData] = useState(false);
  const [levelFilter, setLevelFilter] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [aiOpen, setAiOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "success" | "error"
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [loadingAnalysisName, setLoadingAnalysisName] = useState(null);

  function loadDemo() {
    setAllEvents(generateMockEvents());
    setHasData(true);
  }

  // Fetch list of saved analyses from backend
  useEffect(() => {
    fetch("/saved-analyses")
      .then(r => r.ok ? r.json() : [])
      .then(data => setSavedAnalyses(Array.isArray(data) ? data : []))
      .catch(() => setSavedAnalyses([]));
  }, [hasData]);

  async function handleFile(file) {
    setLoading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("rules", "[]");
    try {
      const res = await fetch("/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Analysis failed");
      // Assign ids and precompute timestamp milliseconds for fast filtering
      const events = (data.events ?? []).map((e, i) => {
        const t = e.timestampMs || new Date(e.timestamp).getTime();
        return {
          ...e,
          id: e.id ?? `evt-${i}`,
          timestampMs: isNaN(t) ? 0 : t
        };
      });
      setAllEvents(events);
      setHasData(true);
    } catch(e) {
      // Fall back to demo if backend not reachable
      setUploadError(`Backend unavailable — showing demo data. (${e.message})`);
      loadDemo();
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrentAnalysis() {
    if (!allEvents.length) return;
    setSaveStatus("saving");
    try {
      const name = saveName.trim() || `analysis-${new Date().toISOString().substring(0,10)}`;
      const res = await fetch("/saved-analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, events: allEvents }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus("success");
      setSavedAnalyses(prev => [...prev.filter(s => s.source_file !== name), { source_file: name, total_events: allEvents.length }]);
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  }

  async function loadSavedAnalysis(name) {
    setLoadingAnalysisName(name);
    try {
      const res = await fetch(`/saved-analyses/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Load failed");
      const events = (data.events ?? []).map((e, i) => {
        const t = e.timestampMs || new Date(e.timestamp).getTime();
        return {
          ...e,
          id: e.id ?? `evt-${i}`,
          timestampMs: isNaN(t) ? 0 : t
        };
      });
      setAllEvents(events);
      setHasData(true);
      setActiveView("dashboard");
    } catch(e) {
      setUploadError(`Failed to load "${name}": ${e.message}`);
    } finally {
      setLoadingAnalysisName(null);
    }
  }

  async function deleteSavedAnalysis(name) {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      const res = await fetch(`/saved-analyses/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setSavedAnalyses(prev => prev.filter(s => s.source_file !== name));
    } catch(e) {
      setUploadError(`Failed to delete "${name}": ${e.message}`);
    }
  }

  // Time-filtering has been removed: events are now shown in full
  const timeFiltered = allEvents;

  // Level-filtered events (for events view)
  const displayedEvents = useMemo(() => {
    if (!levelFilter) return timeFiltered;
    if (levelFilter === "critical") return timeFiltered.filter(e => ["SEVERE","ERROR","FATAL"].includes(e.level));
    if (levelFilter === "warning")  return timeFiltered.filter(e => e.level === "WARNING");
    if (levelFilter === "info")     return timeFiltered.filter(e => e.level === "INFO");
    return timeFiltered;
  }, [timeFiltered, levelFilter]);

  // Single-pass loop to calculate stats incredibly fast
  const stats = useMemo(() => {
    let critical = 0;
    let warnings = 0;
    let info = 0;
    const threads = new Set();
    const len = timeFiltered.length;
    for (let i = 0; i < len; i++) {
      const e = timeFiltered[i];
      const lvl = e.level;
      if (lvl === "SEVERE" || lvl === "ERROR" || lvl === "FATAL") {
        critical++;
      } else if (lvl === "WARNING") {
        warnings++;
      } else if (lvl === "INFO") {
        info++;
      }
      if (e.thread_id) {
        threads.add(e.thread_id);
      }
    }
    return { total: len, critical, warnings, info, threads: threads.size };
  }, [timeFiltered]);

  // Incremental events loading
  const PAGE_SIZE = 50;
  const [visibleEventCount, setVisibleEventCount] = useState(PAGE_SIZE);

  // Reset visible count whenever filters change
  useEffect(() => {
    setVisibleEventCount(PAGE_SIZE);
  }, [levelFilter, allEvents.length]);

  const reversedEvents = useMemo(() => displayedEvents.slice().reverse(), [displayedEvents]);
  const visibleEventList = useMemo(() => reversedEvents.slice(0, visibleEventCount), [reversedEvents, visibleEventCount]);
  const hasMoreEvents = visibleEventCount < reversedEvents.length;

  // IntersectionObserver sentinel ref for infinite scroll using callback ref
  const observerRef = useRef(null);
  const sentinelRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node) {
      const obs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          setVisibleEventCount(c => Math.min(c + PAGE_SIZE, reversedEvents.length));
        }
      }, { threshold: 0.1 });
      obs.observe(node);
      observerRef.current = obs;
    }
  }, [reversedEvents.length]);

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: "▣" },
    { id: "events",    label: `Events (${displayedEvents.length})`, icon: "◷" },
    { id: "templates", label: "Templates", icon: "◎" },
    { id: "threads",   label: "Threads", icon: "◫" },
    { id: "history",   label: "History", icon: "📁" },
  ];

  const LEVEL_FILTERS = [
    { id: null,       label: "All levels" },
    { id: "critical", label: "Fatal / Error" },
    { id: "warning",  label: "Warning" },
    { id: "info",     label: "Info" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-0)", paddingRight: aiOpen ? 380 : 0, transition: "padding-right 0.25s" }}>
      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes dots { 0%{content:"."} 33%{content:".."} 66%{content:"..."} }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
        .nav-tab { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; border: none; cursor: pointer; transition: all 0.25s cubic-bezier(0.4,0,0.2,1); background: transparent; width: 100%; text-align: left; }
        .nav-tab:hover { transform: translateY(-1.5px) scale(1.02); background: rgba(255,255,255,0.08) !important; color: var(--text-primary) !important; }
        .nav-tab:active { transform: scale(0.97); }
        .nav-tab.active { background: linear-gradient(135deg, rgba(42,120,214,0.2) 0%, rgba(42,120,214,0.08) 100%) !important; color: var(--text-primary) !important; border: 1px solid rgba(42,120,214,0.3) !important; box-shadow: 0 4px 12px rgba(42,120,214,0.1) !important; }
        .btn-header-back { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); border-radius: 10px !important; }
        .btn-header-back:hover { transform: translateY(-1px) scale(1.02); background: rgba(255,255,255,0.08) !important; }
        .btn-header-back:active { transform: scale(0.97); }
        .btn-back-danger { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); border-radius: 10px !important; }
        .btn-back-danger:hover { background: rgba(239,68,68,0.10) !important; color: #f87171 !important; transform: translateX(-2px); }
        .btn-back-danger:active { transform: scale(0.97); }
        .history-item { transition: all 0.18s; border-radius: 12px !important; }
        .history-item:hover { background: rgba(42,120,214,0.08) !important; transform: translateX(2px); border-color: rgba(42,120,214,0.25) !important; }
        .history-item:active { transform: scale(0.98); }
      `}</style>
      <h2 className="sr-only">Jenkins Log Analysis Dashboard</h2>

      {/* ── Header ── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 30,
        background: "var(--surface-2)", borderBottom: "0.5px solid var(--border-strong)",
        backdropFilter: "blur(8px)",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "10px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>Jenkins Log Analysis</div>
            {hasData && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{allEvents.length.toLocaleString()} events parsed</div>}
          </div>
          {hasData && (
            <>
              <HealthScore events={timeFiltered} />
              {/* Save button with status feedback */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="Analysis name…"
                  style={{ fontSize: 12, padding: "6px 10px", borderRadius: 7, border: "0.5px solid var(--border-strong)", background: "var(--surface-1)", color: "var(--text-primary)", width: 140, outline: "none" }}
                />
                <button
                  onClick={saveCurrentAnalysis}
                  disabled={saveStatus === "saving"}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                    borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: saveStatus === "saving" ? "wait" : "pointer",
                    background: saveStatus === "success" ? "rgba(27,175,122,0.15)" : saveStatus === "error" ? "rgba(208,59,59,0.15)" : "var(--surface-1)",
                    color: saveStatus === "success" ? "#1baf7a" : saveStatus === "error" ? "#d03b3b" : "var(--text-accent)",
                    border: `0.5px solid ${saveStatus === "success" ? "#1baf7a44" : saveStatus === "error" ? "#d03b3b44" : "var(--border-accent)"}`,
                    transition: "all 0.2s",
                  }}>
                  {saveStatus === "saving" && <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(42,120,214,0.25)", borderTopColor: "#2a78d6", animation: "spin 0.8s linear infinite", display: "inline-block" }} />}
                  {saveStatus === "success" ? "✓ Saved!" : saveStatus === "error" ? "✗ Error" : "💾 Save"}
                </button>
              </div>
              <button onClick={() => setAiOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "7px 14px",
                  borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  background: aiOpen ? "#2a78d6" : "var(--surface-1)",
                  color: aiOpen ? "#fff" : "#2a78d6",
                  border: `0.5px solid ${aiOpen ? "#2a78d6" : "#2a78d644"}`,
                  transition: "all 0.15s",
                }}>
                <span>✦</span> Log Analyst
              </button>
              <button
                className="btn-header-back"
                onClick={() => { setHasData(false); setAllEvents([]); setLoading(false); }}
                style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer", background: "var(--surface-1)", border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                ↩ Upload new
              </button>
            </>
          )}
          {!hasData && (
            <button onClick={loadDemo}
              style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "var(--surface-1)", border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}>
              Load demo data
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
        {/* ── Upload Screen ── */}
        {!hasData && (
          <div style={{ maxWidth: 600, margin: "48px auto", display: "flex", flexDirection: "column", gap: 24 }}>
            <FileUploadZone onFile={handleFile} loading={loading} />
            {uploadError && (
              <div style={{ fontSize: 12, color: "var(--text-warning)", background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 8, padding: "10px 14px" }}>
                {uploadError}
              </div>
            )}
            {savedAnalyses.length > 0 && (
              <div style={{ background: "var(--surface-1)", borderRadius: 14, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Or open a saved analysis</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                  {savedAnalyses.map(item => {
                    const isThisLoading = loadingAnalysisName === item.source_file;
                    return (
                      <div
                        key={item.source_file}
                        className="history-item"
                        style={{
                          display: "flex", alignItems: "center", gap: 2, borderRadius: 10,
                          border: "0.5px solid var(--border)",
                          background: isThisLoading ? "rgba(42,120,214,0.08)" : "var(--surface-2)",
                          overflow: "hidden",
                          transition: "all 0.15s", opacity: loadingAnalysisName && !isThisLoading ? 0.5 : 1,
                        }}
                      >
                        <button
                          disabled={loadingAnalysisName !== null}
                          onClick={() => loadSavedAnalysis(item.source_file)}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                            background: "transparent", border: "none", color: "var(--text-secondary)",
                            cursor: loadingAnalysisName ? "wait" : "pointer", textAlign: "left", minWidth: 0
                          }}
                        >
                          {isThisLoading
                            ? <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(42,120,214,0.25)", borderTopColor: "#2a78d6", animation: "spin 0.8s linear infinite", display: "inline-block", flexShrink: 0 }} />
                            : <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>}
                          <div style={{ overflow: "hidden", flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{item.source_file}</div>
                            {item.total_events && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.total_events.toLocaleString()} events</div>}
                          </div>
                        </button>
                        <button
                          disabled={loadingAnalysisName !== null}
                          onClick={() => deleteSavedAnalysis(item.source_file)}
                          style={{
                            padding: "10px 12px", background: "transparent", border: "none",
                            color: "var(--text-muted)", cursor: "pointer", transition: "color 0.15s",
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                          title="Delete analysis"
                        >
                          🗑️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Main Dashboard ── */}
        {hasData && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, background: "var(--surface-1)", padding: 3, borderRadius: 10, width: "fit-content", border: "0.5px solid var(--border)" }}>
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveView(t.id)}
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                    border: "none", transition: "all 0.18s cubic-bezier(0.4,0,0.2,1)",
                    background: activeView === t.id ? "var(--surface-2)" : "transparent",
                    color: activeView === t.id ? "var(--text-primary)" : "var(--text-muted)",
                    boxShadow: activeView === t.id ? "var(--shadow-sm)" : "none",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                  onMouseEnter={e => { if (activeView !== t.id) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                  onMouseLeave={e => { if (activeView !== t.id) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                >
                  <span>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            {/* ── DASHBOARD VIEW ── */}
            {activeView === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* KPI Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <StatCard label="Total events" value={stats.total}
                    subtext="from active log file"
                    accentColor="var(--text-primary)"
                    onClick={() => { setLevelFilter(null); setActiveView("events"); }}
                    active={false} />
                  <StatCard label="Fatal / Error" value={stats.critical}
                    subtext={`${Math.round((stats.critical/Math.max(stats.total,1))*100)}% of total`}
                    accentColor="#d03b3b"
                    onClick={() => { setLevelFilter("critical"); setActiveView("events"); }}
                    active={levelFilter === "critical"} />
                  <StatCard label="Warnings" value={stats.warnings}
                    subtext={`${Math.round((stats.warnings/Math.max(stats.total,1))*100)}% of total`}
                    accentColor="#fab219"
                    onClick={() => { setLevelFilter("warning"); setActiveView("events"); }}
                    active={levelFilter === "warning"} />
                  <StatCard label="Active threads" value={stats.threads}
                    subtext="unique thread IDs"
                    accentColor="#2a78d6"
                    onClick={() => setActiveView("threads")}
                    active={false} />
                </div>

                {/* Level distribution + Volume chart */}
                <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Event volume</div>
                    <LevelDistBar events={timeFiltered} />
                  </div>
                  <EventVolumeChart events={timeFiltered} />
                </div>

                {/* Bottom grid */}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
                  {/* Top error templates */}
                  <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Recurring error patterns</div>
                      <button onClick={() => setActiveView("templates")}
                        style={{ fontSize: 11, color: "#2a78d6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>View all →</button>
                    </div>
                    <TopTemplatesPanel events={timeFiltered} limit={5} />
                  </div>

                  {/* Recent fatal/error feed */}
                  <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "18px 20px", border: "0.5px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Recent fatal & errors</div>
                      <button onClick={() => { setLevelFilter("critical"); setActiveView("events"); }}
                        style={{ fontSize: 11, color: "#2a78d6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>View all →</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 340, overflowY: "auto" }}>
                      {timeFiltered.filter(e => ["SEVERE","ERROR","FATAL"].includes(e.level)).slice(-6).reverse().map((ev, i) => (
                        <EventRow key={ev.id ?? i} event={ev} allEvents={timeFiltered} />
                      ))}
                      {stats.critical === 0 && <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>No errors in this time window.</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── EVENTS VIEW ── */}
            {activeView === "events" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Level filter pills */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Filter:</span>
                  {LEVEL_FILTERS.map(f => (
                    <button key={String(f.id)} onClick={() => setLevelFilter(f.id)}
                      style={{
                        padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer",
                        border: `0.5px solid ${levelFilter === f.id ? "var(--border-accent)" : "var(--border)"}`,
                        background: levelFilter === f.id ? "var(--bg-accent)" : "var(--surface-1)",
                        color: levelFilter === f.id ? "var(--text-accent)" : "var(--text-secondary)",
                        transition: "all 0.15s",
                      }}>{f.label}</button>
                  ))}
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>{displayedEvents.length} events</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {visibleEventList.map((ev, i) => (
                    <EventRow key={ev.id ?? i} event={ev} allEvents={timeFiltered} />
                  ))}
                  {/* Invisible sentinel — IntersectionObserver triggers more loads */}
                  {hasMoreEvents && (
                    <div ref={sentinelRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0", gap: 10 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(42,120,214,0.2)", borderTopColor: "#2a78d6", animation: "spin 0.8s linear infinite" }} />
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading more events… ({visibleEventCount} / {reversedEvents.length})</span>
                    </div>
                  )}
                  {!hasMoreEvents && reversedEvents.length > PAGE_SIZE && (
                    <div style={{ textAlign: "center", padding: "16px 0", fontSize: 12, color: "var(--text-muted)" }}>
                      All {reversedEvents.length.toLocaleString()} events loaded
                    </div>
                  )}
                  {displayedEvents.length === 0 && (
                    <p style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", padding: 48 }}>No events match the current filters.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── TEMPLATES VIEW ── */}
            {activeView === "templates" && (
              <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "20px", border: "0.5px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 16 }}>All recurring error and warning patterns</div>
                <TopTemplatesPanel events={timeFiltered} limit={20} />
              </div>
            )}

            {/* ── THREADS VIEW ── */}
            {activeView === "threads" && (
              <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "20px", border: "0.5px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 20 }}>Thread Analysis</div>
                <ThreadActivityPanel events={timeFiltered} />
              </div>
            )}


            {/* ── HISTORY VIEW ── */}
            {activeView === "history" && (
              <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "20px", border: "0.5px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>Saved Analyses History</div>
                {savedAnalyses.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>No saved analyses yet. Use the Save button in the header to save the current analysis.</p>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                  {savedAnalyses.map(item => {
                    const isThisLoading = loadingAnalysisName === item.source_file;
                    return (
                      <div
                        key={item.source_file}
                        className="history-item"
                        style={{
                          display: "flex", alignItems: "center", gap: 2, borderRadius: 10,
                          border: "0.5px solid var(--border)",
                          background: isThisLoading ? "rgba(42,120,214,0.08)" : "var(--surface-2)",
                          overflow: "hidden",
                          transition: "all 0.15s", opacity: loadingAnalysisName && !isThisLoading ? 0.5 : 1,
                        }}
                      >
                        <button
                          disabled={loadingAnalysisName !== null}
                          onClick={() => loadSavedAnalysis(item.source_file)}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                            background: "transparent", border: "none", color: "var(--text-secondary)",
                            cursor: loadingAnalysisName ? "wait" : "pointer", textAlign: "left", minWidth: 0
                          }}
                        >
                          {isThisLoading
                            ? <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid rgba(42,120,214,0.25)", borderTopColor: "#2a78d6", animation: "spin 0.8s linear infinite", display: "inline-block", flexShrink: 0 }} />
                            : <span style={{ fontSize: 22, flexShrink: 0 }}>📁</span>}
                          <div style={{ overflow: "hidden", flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{item.source_file}</div>
                            {item.total_events && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.total_events.toLocaleString()} events</div>}
                          </div>
                        </button>
                        <button
                          disabled={loadingAnalysisName !== null}
                          onClick={() => deleteSavedAnalysis(item.source_file)}
                          style={{
                            padding: "12px 14px", background: "transparent", border: "none",
                            color: "var(--text-muted)", cursor: "pointer", transition: "color 0.15s",
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                          title="Delete analysis"
                        >
                          🗑️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* AI Chat Panel */}
      {aiOpen && <AIChatPanel events={timeFiltered} onClose={() => setAiOpen(false)} />}
    </div>
  );
}