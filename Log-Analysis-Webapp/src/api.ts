// ─────────────────────────────────────────────────────────────
// Thin typed wrappers over the FastAPI backend (Analysis-Tool/api.py).
// Requests use relative paths; Vite proxies them to :8000 (see
// vite.config.ts). No analysis logic lives here — the backend owns it.
// ─────────────────────────────────────────────────────────────

import type { AnalysisResult, LogEvent, TopTemplate, WindowResult } from "./types";

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
