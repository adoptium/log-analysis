import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AnalysisResult } from "../types";
import { analyzeLog } from "../api";
import type { AnalyzeRule } from "../api";

// ─────────────────────────────────────────────────────────────
// Shared analysis state. Holds the current backend analysis result
// (or null → sample mode), the triage rule set, and the load flow.
// One provider wraps the whole app so the Load-log button, the
// Dashboard, and the Rules page all read the same state.
// ─────────────────────────────────────────────────────────────

// UI-side rule shape (matches the Rules design). Mapped to the
// backend Rule shape (analyzer.Rule) at analyze time.
export type UIRule = {
  id: string;
  type: "ignore" | "tag" | "set_level" | "time_window";
  target: string; // message | stack trace | logger | timestamp
  regex: string;
  actionDetail: string;
  on: boolean;
};

// Sample rule set from the design — the starting point until the
// backend grows real rule persistence (there is no rules endpoint yet).
const DEFAULT_RULES: UIRule[] = [
  { id: "suppress-known-agent-noise", type: "ignore", target: "message", regex: "Cannot run program .* error=2", actionDetail: "suppress", on: true },
  { id: "flag-flaky-agent", type: "tag", target: "stack trace", regex: "ClosedChannelException", actionDetail: "tag: flaky-agent", on: true },
  { id: "escalate-oom", type: "set_level", target: "stack trace", regex: "OutOfMemoryError", actionDetail: "set level: SEVERE", on: true },
  { id: "capacity-watch", type: "tag", target: "message", regex: "stuck in queue for \\d+s", actionDetail: "tag: capacity", on: true },
  { id: "downstream-noise", type: "ignore", target: "message", regex: "Skipped \\d+ downstream jobs", actionDetail: "suppress", on: false },
  { id: "escalate-build-fail", type: "set_level", target: "message", regex: "Maven build step failed with exit code \\d+", actionDetail: "set level: ERROR", on: true },
  { id: "noisy-checkout-logger", type: "ignore", target: "logger", regex: "h\\.p\\.g\\.GitSCM", actionDetail: "suppress", on: true },
  { id: "maintenance-window-outage", type: "time_window", target: "timestamp", regex: "13:50:00 – 14:05:00", actionDetail: "suppress", on: true },
];

// Map enabled UI rules onto the backend Rule shape (AnalyzeRule — note it
// has no client-side `id`). Types the backend can't express (time_window /
// a timestamp target) are dropped.
export function toBackendRules(rules: UIRule[]): AnalyzeRule[] {
  const out: AnalyzeRule[] = [];
  for (const r of rules) {
    if (!r.on || r.type === "time_window" || r.target === "timestamp") continue;
    const rule: AnalyzeRule = { name: r.id, action: r.type };
    if (r.target === "stack trace") rule.stack_regex = r.regex;
    else if (r.target === "logger") rule.logger_regex = r.regex;
    else rule.message_regex = r.regex;
    if (r.type === "tag") rule.tag = r.actionDetail.replace(/^tag:\s*/i, "").trim();
    if (r.type === "set_level") rule.set_level = r.actionDetail.replace(/^set level:\s*/i, "").trim();
    out.push(rule);
  }
  return out;
}

// Extract "HH:MM:SS.mmm" from a raw Jenkins timestamp or ISO string.
export function shortTime(raw: string | null, iso: string | null): string {
  const src = raw ?? iso ?? "";
  const m = src.match(/(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/);
  return m ? m[1] : "—";
}

type AnalysisContextValue = {
  result: AnalysisResult | null;
  fileName: string | null;
  loading: boolean;
  error: string | null;
  rules: UIRule[];
  sampleMode: boolean;
  timeRange: string | null;
  rulesDirty: boolean; // rules changed since last load
  loadFile: (file: File) => Promise<void>;
  setRuleOn: (id: string, on: boolean) => void;
};

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<UIRule[]>(DEFAULT_RULES);
  const [rulesDirty, setRulesDirty] = useState(false);

  // Keep a ref so loadFile always reads the latest rules without being
  // re-created on every rule toggle.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeLog(file, toBackendRules(rulesRef.current));
      setResult(res);
      setFileName(file.name);
      setRulesDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const setRuleOn = useCallback((id: string, on: boolean) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, on } : r)));
    setRulesDirty(true);
  }, []);

  const timeRange = useMemo(() => {
    const events = result?.events;
    if (!events || events.length === 0) return null;
    let lo = events[0];
    let hi = events[0];
    for (const e of events) {
      const t = e.timestamp ?? e.timestamp_raw ?? "";
      if ((t) < (lo.timestamp ?? lo.timestamp_raw ?? "")) lo = e;
      if ((t) > (hi.timestamp ?? hi.timestamp_raw ?? "")) hi = e;
    }
    return `${shortTime(lo.timestamp_raw, lo.timestamp)} → ${shortTime(hi.timestamp_raw, hi.timestamp)}`;
  }, [result]);

  const value = useMemo<AnalysisContextValue>(
    () => ({
      result,
      fileName,
      loading,
      error,
      rules,
      sampleMode: result === null,
      timeRange,
      rulesDirty,
      loadFile,
      setRuleOn,
    }),
    [result, fileName, loading, error, rules, timeRange, rulesDirty, loadFile, setRuleOn],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within <AnalysisProvider>");
  return ctx;
}
