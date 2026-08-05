import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AnalysisResult, LogEvent } from "../types";
import {
  analyzeLog,
  deleteSavedAnalysis,
  listSavedAnalyses,
  loadSavedAnalysis,
  saveAnalysis,
} from "../api";
import type { AnalyzeRule, SavedAnalysis } from "../api";

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

// Triage rules live client-side (localStorage) for now — there's no per-user
// rules endpoint on the backend yet. They're still applied server-side: the
// enabled set is sent inline to /analyze on every (re)load.
const RULES_STORAGE_KEY = "loglens.rules.v1";

function loadStoredRules(): UIRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-guard each entry so a malformed value can't crash the app.
    return parsed.filter(
      (r): r is UIRule =>
        r && typeof r.id === "string" && typeof r.type === "string" && typeof r.regex === "string",
    );
  } catch {
    return [];
  }
}

// Extract "HH:MM:SS.mmm" from a raw Jenkins timestamp or ISO string.
export function shortTime(raw: string | null, iso: string | null): string {
  const src = raw ?? iso ?? "";
  const m = src.match(/(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/);
  return m ? m[1] : "—";
}

// The saved-analyses load endpoint returns a reduced event projection
// (no line_end / timestamp_raw / thread_id / method / template / raw, and
// ignored may be absent). Fill every LogEvent field with a safe default so
// downstream code that assumes the full shape can't hit an undefined.
function normalizeLoadedEvent(e: Partial<LogEvent>): LogEvent {
  return {
    line_start: e.line_start ?? 0,
    line_end: e.line_end ?? e.line_start ?? 0,
    timestamp: e.timestamp ?? null,
    timestamp_raw: e.timestamp_raw ?? null,
    thread_id: e.thread_id ?? null,
    level: e.level ?? null,
    logger: e.logger ?? null,
    method: e.method ?? null,
    message: e.message ?? "",
    stack_trace: e.stack_trace ?? null,
    raw: e.raw ?? "",
    template_id: e.template_id ?? null,
    template: e.template ?? null,
    tags: e.tags ?? [],
    ignored: e.ignored ?? false,
  };
}

// Rebuild the summary shape /analyze returns from a bare list of events.
// Used when loading a saved analysis, which returns only events. Level
// counts are over active (non-ignored) events, matching the backend.
function resultFromEvents(rawEvents: LogEvent[]): AnalysisResult {
  const events = rawEvents.map(normalizeLoadedEvent);
  const activeEvents = events.filter((e) => !e.ignored);
  const level_counts: Record<string, number> = {};
  for (const e of activeEvents) {
    const lvl = e.level ?? "UNKNOWN";
    level_counts[lvl] = (level_counts[lvl] ?? 0) + 1;
  }
  return {
    events,
    level_counts,
    total: events.length,
    active: activeEvents.length,
    ignored: events.length - activeEvents.length,
  };
}

type AnalysisContextValue = {
  result: AnalysisResult | null;
  fileName: string | null;
  loading: boolean;
  error: string | null;
  rules: UIRule[];
  empty: boolean; // no log analysed yet
  timeRange: string | null;
  rulesDirty: boolean; // rules changed since last load
  saving: boolean; // a save is in flight (distinct from analysis `loading`)
  saved: SavedAnalysis[]; // persisted analyses from the backend
  reapplyAvailable: boolean; // a file is retained, so rules can be re-applied
  loadFile: (file: File) => Promise<void>;
  setRuleOn: (id: string, on: boolean) => void;
  upsertRule: (rule: UIRule) => void; // add or replace a rule (matched by id)
  deleteRule: (id: string) => void;
  reapplyRules: () => Promise<void>; // re-run /analyze on the retained file
  refreshSaved: () => Promise<void>;
  saveCurrent: (name: string) => Promise<void>;
  loadSaved: (sourceFile: string) => Promise<void>;
  deleteSaved: (sourceFile: string) => Promise<void>;
};

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Triage rules are authored in the UI and persisted to localStorage (see
  // loadStoredRules). They're applied server-side by sending the enabled set
  // inline to /analyze on each (re)load.
  const [rules, setRules] = useState<UIRule[]>(loadStoredRules);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [reapplyAvailable, setReapplyAvailable] = useState(false);

  // Keep a ref so loadFile always reads the latest rules without being
  // re-created on every rule toggle.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // Ref so saveCurrent reads the latest result without depending on it.
  const resultRef = useRef(result);
  resultRef.current = result;

  // The last file analysed, retained so rules can be re-applied in place
  // (re-run /analyze) without the user re-picking it from disk. Loading a
  // saved analysis clears it — there's no file to re-run in that case.
  const lastFileRef = useRef<File | null>(null);

  // Persist rules whenever they change so authored rules survive a reload.
  useEffect(() => {
    try {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [rules]);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    lastFileRef.current = file;
    setReapplyAvailable(true);
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

  // Re-run analysis on the retained file with the current rule set.
  const reapplyRules = useCallback(async () => {
    const file = lastFileRef.current;
    if (file) await loadFile(file);
  }, [loadFile]);

  const setRuleOn = useCallback((id: string, on: boolean) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, on } : r)));
    setRulesDirty(true);
  }, []);

  // Add a new rule or replace an existing one (matched by id).
  const upsertRule = useCallback((rule: UIRule) => {
    setRules((rs) => {
      const i = rs.findIndex((r) => r.id === rule.id);
      if (i === -1) return [...rs, rule];
      const next = rs.slice();
      next[i] = rule;
      return next;
    });
    setRulesDirty(true);
  }, []);

  const deleteRule = useCallback((id: string) => {
    setRules((rs) => rs.filter((r) => r.id !== id));
    setRulesDirty(true);
  }, []);

  // Pull the current list of saved analyses. Fails quietly (leaves the list
  // empty) so a missing/offline backend doesn't surface a blocking error.
  const refreshSaved = useCallback(async () => {
    try {
      setSaved(await listSavedAnalyses());
    } catch {
      setSaved([]);
    }
  }, []);

  const saveCurrent = useCallback(
    async (name: string) => {
      const events = resultRef.current?.events;
      if (!events || events.length === 0) {
        setError("Nothing to save — load a log first.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await saveAnalysis(name, events);
        setFileName(name);
        await refreshSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [refreshSaved],
  );

  const loadSaved = useCallback(async (sourceFile: string) => {
    setLoading(true);
    setError(null);
    // A saved analysis is a pre-computed snapshot with no source File, so
    // rules can't be re-applied to it via /analyze.
    lastFileRef.current = null;
    setReapplyAvailable(false);
    try {
      const { events } = await loadSavedAnalysis(sourceFile);
      setResult(resultFromEvents(events));
      setFileName(sourceFile.split("/").pop() || sourceFile);
      setRulesDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSaved = useCallback(
    async (sourceFile: string) => {
      try {
        await deleteSavedAnalysis(sourceFile);
        await refreshSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [refreshSaved],
  );

  // Load the saved-analyses list once on mount.
  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

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
      empty: result === null,
      timeRange,
      rulesDirty,
      saving,
      saved,
      reapplyAvailable,
      loadFile,
      setRuleOn,
      upsertRule,
      deleteRule,
      reapplyRules,
      refreshSaved,
      saveCurrent,
      loadSaved,
      deleteSaved,
    }),
    [
      result,
      fileName,
      loading,
      error,
      rules,
      timeRange,
      rulesDirty,
      saving,
      saved,
      reapplyAvailable,
      loadFile,
      setRuleOn,
      upsertRule,
      deleteRule,
      reapplyRules,
      refreshSaved,
      saveCurrent,
      loadSaved,
      deleteSaved,
    ],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within <AnalysisProvider>");
  return ctx;
}
