// ─────────────────────────────────────────────────────────────
// Thin typed wrappers over the FastAPI backend (Analysis-Tool/api.py).
// Requests use relative paths; Vite proxies them to :8000 (see
// vite.config.ts). No analysis logic lives here — the backend owns it.
// ─────────────────────────────────────────────────────────────

import type { AIQueryPayload, AIQueryResponse, AnalysisResult, LogEvent, TopTemplate, WindowResult } from "./types";

// The backend Rule dataclass has no client-side `id`; callers pass this shape.
export type AnalyzeRule = {
  name: string;
  action: "ignore" | "tag" | "set_level";
  level?: string;
  logger_regex?: string;
  message_regex?: string;
  stack_regex?: string;
  tag?: string;
  set_level?: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data as T;
}

/** POST /analyze — parse an uploaded log file, apply rules, return events + summary. */
export async function analyzeLog(file: File, rules: AnalyzeRule[] = []): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("rules", JSON.stringify(rules));
  const res = await fetch("/analyze", { method: "POST", body: form });
  return jsonOrThrow<AnalysisResult>(res);
}

/** POST /top-templates — top N recurring templates for the given events. */
export async function fetchTopTemplates(events: LogEvent[], n = 20): Promise<TopTemplate[]> {
  const res = await fetch("/top-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events, n }),
  });
  return jsonOrThrow<TopTemplate[]>(res);
}

/** POST /in-window — active events within [center - before, center + after]. */
export async function fetchInWindow(
  events: LogEvent[],
  center: string,
  beforeSeconds: number,
  afterSeconds: number,
): Promise<WindowResult> {
  const res = await fetch("/in-window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events, center, before_seconds: beforeSeconds, after_seconds: afterSeconds }),
  });
  return jsonOrThrow<WindowResult>(res);
}

<<<<<<< Updated upstream
// ─────────────────────────────────────────────────────────────
// Saved analyses (persisted in the backend's DuckDB store).
// ─────────────────────────────────────────────────────────────

// One row from GET /saved-analyses (backend EventStore.list_files()).
export type SavedAnalysis = {
  source_file: string; // the key used to load/delete this analysis
  name: string; // basename, for display
  total_events: number;
  ignored_events: number;
  earliest: string | null;
  latest: string | null;
};

/** GET /saved-analyses — list previously saved analyses. */
export async function listSavedAnalyses(): Promise<SavedAnalysis[]> {
  const res = await fetch("/saved-analyses");
  return jsonOrThrow<SavedAnalysis[]>(res);
}

/** POST /saved-analyses — persist the given events under `name`. */
export async function saveAnalysis(
  name: string,
  events: LogEvent[],
): Promise<{ name: string; saved: number }> {
  const res = await fetch("/saved-analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, events }),
  });
  return jsonOrThrow(res);
}

/** GET /saved-analyses/{name} — load a saved analysis' events. */
export async function loadSavedAnalysis(
  name: string,
): Promise<{ name: string; events: LogEvent[]; count: number }> {
  const res = await fetch(`/saved-analyses/${encodeURIComponent(name)}`);
  return jsonOrThrow(res);
}

/** DELETE /saved-analyses/{name} — remove a saved analysis. */
export async function deleteSavedAnalysis(
  name: string,
): Promise<{ name: string; deleted: boolean }> {
  const res = await fetch(`/saved-analyses/${encodeURIComponent(name)}`, { method: "DELETE" });
  return jsonOrThrow(res);
}
=======
/** POST /ai-query — summarize or query log events using AI provider. */
export async function fetchAiSummary(payload: AIQueryPayload): Promise<AIQueryResponse> {
  const res = await fetch("/ai-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<AIQueryResponse>(res);
}

>>>>>>> Stashed changes
