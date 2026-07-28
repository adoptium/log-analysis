import { useState, useEffect } from "react";
import { colors, font } from "../theme";
import { useAnalysis } from "../state/analysis";
import { fetchAiSummary } from "../api";

interface AiAssistantOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_PROMPTS = [
  {
    label: "⚡ Summarize Logs",
    prompt: "Provide a 3-paragraph executive summary of the top log event patterns, noise vs critical issues, and overall system state.",
  },
  {
    label: "🚨 Analyze Errors",
    prompt: "Identify and analyze all SEVERE, FATAL, and ERROR events. Explain the root causes and stack traces if present.",
  },
  {
    label: "💡 Action Items",
    prompt: "Generate a list of 3-5 concrete action items for developers and SREs to remediate the log issues detected.",
  },
];

export default function AiAssistantOverlay({ isOpen, onClose }: AiAssistantOverlayProps) {
  const { result } = useAnalysis();
  const [provider, setProvider] = useState<"copilot" | "bob" | "mock">("copilot");
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("loglens_copilot_key") || "";
    setApiKey(savedKey);
  }, []);

  const handleSaveKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("loglens_copilot_key", key);
  };

  const handleQuery = async (queryText?: string) => {
    const activeQuery = queryText !== undefined ? queryText : customPrompt;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAiSummary({
        events: result?.events ?? [],
        user_query: activeQuery,
        provider,
        api_key: apiKey || undefined,
      });
      setSummary(res.summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate AI summary";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.25)",
            zIndex: 998,
            transition: "opacity 0.2s ease-in-out",
          }}
        />
      )}

      {/* Drawer panel taking up ~25% of screen width */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "25vw",
          minWidth: 340,
          maxWidth: 460,
          backgroundColor: colors.panel,
          borderLeft: `1px solid ${colors.borderStrong}`,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          fontFamily: font.sans,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: colors.surfaceMuted,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>AI Log Assistant</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Powered by {provider === "copilot" ? "GitHub Copilot" : "Bob CLI"}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowSettings((p) => !p)}
              style={{
                background: showSettings ? colors.accentBg : "none",
                border: `1px solid ${showSettings ? colors.accent : colors.border}`,
                cursor: "pointer",
                fontSize: 14,
                color: showSettings ? colors.accent : colors.textMuted,
                padding: "4px 8px",
                borderRadius: 4,
              }}
              title="API Credentials & Settings"
            >
              ⚙️
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 18,
                color: colors.textMuted,
                padding: "4px 8px",
                borderRadius: 4,
              }}
              title="Close Assistant"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Provider selector */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>AI PROVIDER</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setProvider("copilot")}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${provider === "copilot" ? colors.accent : colors.border}`,
                  background: provider === "copilot" ? colors.accentBg : colors.panel,
                  color: provider === "copilot" ? colors.accent : colors.textSecondary,
                  cursor: "pointer",
                }}
              >
                Copilot
              </button>
              <button
                onClick={() => setProvider("bob")}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${provider === "bob" ? colors.accent : colors.border}`,
                  background: provider === "bob" ? colors.accentBg : colors.panel,
                  color: provider === "bob" ? colors.accent : colors.textSecondary,
                  cursor: "pointer",
                }}
              >
                Bob CLI
              </button>
              <button
                onClick={() => setProvider("mock")}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${provider === "mock" ? colors.accent : colors.border}`,
                  background: provider === "mock" ? colors.accentBg : colors.panel,
                  color: provider === "mock" ? colors.accent : colors.textSecondary,
                  cursor: "pointer",
                }}
              >
                Demo
              </button>
            </div>
          </div>

          {/* Credentials / API Key Settings toggle */}
          {(showSettings || (provider === "copilot" && !apiKey)) && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: colors.accentBg,
                border: `1px solid ${colors.accent}`,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.accent }}>🔑 GITHUB / COPILOT TOKEN</div>
              <div style={{ fontSize: 11, color: colors.textSecondary }}>
                Enter your GitHub Personal Access Token or Copilot API key below (saved locally in your browser):
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => handleSaveKey(e.target.value)}
                placeholder="ghp_... or gho_... (or leave blank if using 'gh auth')"
                style={{
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  fontSize: 12,
                  fontFamily: font.mono,
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Quick Presets */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>QUICK ANALYSIS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PRESET_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  disabled={loading}
                  onClick={() => {
                    setCustomPrompt(item.prompt);
                    handleQuery(item.prompt);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceMuted,
                    color: colors.text,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: loading ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Query Field */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>CUSTOM QUESTION</div>
            <textarea
              rows={3}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Ask a question about the loaded logs..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                fontFamily: font.sans,
                fontSize: 13,
                resize: "vertical",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <button
              disabled={loading}
              onClick={() => handleQuery()}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "10px",
                borderRadius: 6,
                border: "none",
                background: loading ? colors.textMuted : colors.accent,
                color: "#ffffff",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {loading ? "Analyzing logs..." : "Ask AI"}
            </button>
          </div>

          {/* Output Display Area */}
          {error && (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 12,
                fontFamily: font.sans,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div><strong>Authentication Required:</strong></div>
              <div style={{ fontFamily: font.mono, fontSize: 11, background: "#fee2e2", padding: 8, borderRadius: 4 }}>
                {error}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#7f1d1d" }}>
                <strong>How to fix:</strong>
                <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  <li>Click ⚙️ above and paste your <strong>GitHub Personal Access Token</strong> or <strong>Copilot API key</strong>.</li>
                  <li>Or run <code>gh auth login</code> / <code>export GITHUB_TOKEN=...</code> in your terminal before running the backend.</li>
                  <li>Or switch provider to <strong>Bob CLI</strong> if you use Bob.</li>
                </ol>
              </div>
            </div>
          )}

          {summary && (
            <div
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: colors.surfaceMuted,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.accent }}>AI INSIGHTS</span>
                <button
                  onClick={handleCopy}
                  style={{
                    background: "none",
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                    color: colors.textSecondary,
                  }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: colors.text,
                  whiteSpace: "pre-wrap",
                  fontFamily: font.sans,
                  maxHeight: 400,
                  overflowY: "auto",
                }}
              >
                {summary}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
