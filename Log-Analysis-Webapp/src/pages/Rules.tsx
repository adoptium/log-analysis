import { useMemo, useState } from "react";
import { colors, font, typeMeta } from "../theme";
import { useAnalysis } from "../state/analysis";


const uppercaseLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: colors.textFaint,
  textTransform: "uppercase",
};

export default function Rules() {
  const { rules, setRuleOn, empty, rulesDirty } = useAnalysis();
  const [testInput, setTestInput] = useState(
    ''
  );

  // Live regex match — first enabled, non-time-window rule that matches.
  const match = useMemo(() => {
    for (const r of rules) {
      if (!r.on || r.type === "time_window") continue;
      try {
        if (new RegExp(r.regex).test(testInput)) return r;
      } catch {
        /* invalid regex — skip */
      }
    }
    return null;
  }, [rules, testInput]);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 24px 0 24px" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>Rules</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            Automated triage rules applied to incoming events
          </div>
        </div>
        <button
          onClick={() => alert("Add rule — creating rules is not wired to the backend yet.")}
          style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.accent, color: "#fff", border: "none", cursor: "pointer" }}
        >
          + Add rule
        </button>
      </div>

      {/* Hint: rules changed after a log was loaded */}
      {!empty && rulesDirty && (
        <div style={{ margin: "12px 24px 0 24px", padding: "8px 12px", fontSize: 12, color: "#9a6b1f", background: "#f3e8d8", border: "1px solid #e8d7bf", borderRadius: 6 }}>
          Rules changed — reload the log (Load log) to re-apply them to the analysis.
        </div>
      )}

      {/* Body */}
      <div className="ll-rules-body" style={{ marginTop: 20 }}>
        {/* Rules table */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${colors.border}`, background: colors.panel }}>
          <div style={{ display: "flex", gap: 12, padding: "10px 24px", ...uppercaseLabel, borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ width: 56 }}>On</div>
            <div style={{ width: 90 }}>Type</div>
            <div style={{ width: 100 }}>Applies to</div>
            <div style={{ flex: 1 }}>Match</div>
            <div style={{ width: 150 }}>Action</div>
            <div style={{ width: 80 }}>Controls</div>
          </div>

          {rules.length === 0 && (
            <div style={{ padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.textSecondary, marginBottom: 6 }}>No rules configured</div>
              <div style={{ fontSize: 13, color: colors.textMuted, maxWidth: 380, margin: "0 auto" }}>
                Triage rules will appear here. Creating rules isn't wired to a backend yet.
              </div>
            </div>
          )}

          {rules.map((rule) => {
            const m = typeMeta[rule.type];
            const isOn = rule.on;
            return (
              <div
                key={rule.id}
                style={{ display: "flex", gap: 12, padding: "14px 24px", fontSize: 12.5, alignItems: "center", borderBottom: `1px solid ${colors.rowBorder}`, opacity: isOn ? 1 : 0.5 }}
              >
                {/* Toggle */}
                <div style={{ width: 56 }}>
                  <div
                    onClick={() => setRuleOn(rule.id, !isOn)}
                    style={{ width: 36, height: 20, borderRadius: 10, background: isOn ? colors.accent : colors.borderStrong, position: "relative", cursor: "pointer", transition: "background 0.15s" }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: isOn ? 18 : 2, transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
                {/* Type badge */}
                <div style={{ width: 90 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: m.bg, color: m.color }}>
                    {m.label}
                  </span>
                </div>
                <div style={{ width: 100, color: colors.textSecondary }}>{rule.target}</div>
                <div style={{ flex: 1, fontFamily: font.mono, color: "#292524", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {rule.regex}
                </div>
                <div style={{ width: 150, color: colors.text }}>{rule.actionDetail}</div>
                <div style={{ width: 80, display: "flex", gap: 8 }}>
                  <span
                    onClick={() => alert(`Edit "${rule.id}" — not wired to the backend yet.`)}
                    style={{ fontSize: 11, fontWeight: 600, color: colors.accent, cursor: "pointer" }}
                  >
                    Edit
                  </span>
                  <span
                    onClick={() => alert(`Delete "${rule.id}" — not wired to the backend yet.`)}
                    style={{ fontSize: 11, fontWeight: 600, color: colors.textFaint, cursor: "pointer" }}
                  >
                    Delete
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Test a rule panel */}
        <div style={{ padding: 20, background: colors.panel, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={uppercaseLabel}>Test a rule</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Paste a raw log line to see which rule would match it.
          </div>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            style={{
              width: "100%",
              height: 96,
              fontFamily: font.mono,
              fontSize: 12.5,
              color: colors.text,
              background: colors.surfaceMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 10,
              resize: "vertical",
            }}
          />

          <div style={{ ...uppercaseLabel, marginTop: 6 }}>Result</div>
          {match ? (
            <div style={{ border: `1px solid ${colors.border}`, borderLeft: `3px solid ${typeMeta[match.type].color}`, borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: typeMeta[match.type].bg, color: typeMeta[match.type].color }}>
                  {typeMeta[match.type].label}
                </span>
                <span style={{ fontSize: 11, color: colors.textFaint, fontFamily: font.mono }}>{match.id}</span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.text }}>Action: {match.actionDetail}</div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, fontSize: 12.5, color: colors.textFaint }}>
              No rule matches this line.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
