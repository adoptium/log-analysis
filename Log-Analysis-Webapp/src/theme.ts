// ─────────────────────────────────────────────────────────────
// LogLens design tokens
// Ported directly from the Claude Design source (Dashboard.dc.html /
// Rules.dc.html). Keep these in sync with the values in index.css.
// ─────────────────────────────────────────────────────────────

export const colors = {
  // Surfaces
  canvas: "#e7e5e0",
  appBg: "#f7f7f6",
  panel: "#ffffff",
  surfaceMuted: "#f5f5f4",

  // Borders
  border: "#e7e5e4",
  borderStrong: "#d6d3ce",
  rowBorder: "#f0efec",

  // Text (warm stone scale)
  text: "#1c1917",
  textSecondary: "#57534e",
  textMuted: "#78716c",
  textFaint: "#a8a29e",

  // Accent (indigo)
  accent: "#4f46e5",
  accentHover: "#4338ca",
  accentBg: "#eef2ff",
} as const;

export const font = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', monospace",
} as const;

// Log level → colour. Used both for styling and for chart math.
export const levelColor: Record<string, string> = {
  SEVERE: "#d03b3b",
  ERROR: "#d03b3b",
  WARNING: "#fab219",
  INFO: "#1baf7a",
};

// Rule type → badge styling.
export const typeMeta: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  ignore: { label: "IGNORE", bg: "#f5f5f4", color: "#78716c" },
  tag: { label: "TAG", bg: "#eef2ff", color: "#4f46e5" },
  set_level: { label: "SET_LEVEL", bg: "#fef2f2", color: "#d03b3b" },
  time_window: { label: "TIME WINDOW", bg: "#f3e8d8", color: "#9a6b1f" },
};
