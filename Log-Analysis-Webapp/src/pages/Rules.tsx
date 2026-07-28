import { useMemo, useState } from "react";
import { colors, font, typeMeta } from "../theme";
import { useAnalysis } from "../state/analysis";
import type { UIRule } from "../state/analysis";


const uppercaseLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: colors.textFaint,
  textTransform: "uppercase",
};

// Only the rule types/targets the backend can actually apply (see
// toBackendRules). time_window / timestamp are intentionally omitted.
const RULE_TYPES = ["ignore", "tag", "set_level"] as const;
const TARGETS = ["message", "stack trace", "logger"] as const;
const LEVELS = ["SEVERE", "ERROR", "WARNING", "INFO"] as const;

// Derive a unique id (used as the backend rule `name`) from a base string.
function makeId(base: string, existing: string[]): string {
  const seed = base.trim() || "rule";
  const set = new Set(existing);
  if (!set.has(seed)) return seed;
  let i = 2;
  while (set.has(`${seed}-${i}`)) i++;
  return `${seed}-${i}`;
}

export default function Rules() {
  const { rules, setRuleOn, upsertRule, deleteRule, reapplyRules, reapplyAvailable, empty, rulesDirty, loading } =
    useAnalysis();
  const [testInput, setTestInput] = useState("");
  // null = closed; "new" = create; a UIRule = edit that rule.
  const [editing, setEditing] = useState<UIRule | "new" | null>(null);

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
          onClick={() => setEditing("new")}
          style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.accent, color: "#fff", border: "none", cursor: "pointer" }}
        >
          + Add rule
        </button>
      </div>

      {/* Rules changed after a log was loaded — offer to re-apply. */}
      {!empty && rulesDirty && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 24px 0 24px", padding: "8px 12px", fontSize: 12, color: "#9a6b1f", background: "#f3e8d8", border: "1px solid #e8d7bf", borderRadius: 6 }}>
          {reapplyAvailable ? (
            <>
              <span style={{ flex: 1 }}>Rules changed — re-apply them to the current log to update the analysis.</span>
              <button
                onClick={() => reapplyRules()}
                disabled={loading}
                style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "#9a6b1f", color: "#fff", border: "none", cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
              >
                {loading ? "Applying…" : "Apply rules now"}
              </button>
            </>
          ) : (
            <span>Rules changed — reload the log (Load log) to re-apply them to the analysis.</span>
          )}
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
                Add a triage rule to ignore noise, tag events, or reclassify severity. Rules are saved in this browser
                and applied when you load or re-analyse a log.
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
                <div style={{ flex: 1, fontFamily: font.mono, color: "#292524", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rule.regex}>
                  {rule.regex}
                </div>
                <div style={{ width: 150, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rule.actionDetail}>
                  {rule.actionDetail}
                </div>
                <div style={{ width: 80, display: "flex", gap: 8 }}>
                  <span
                    onClick={() => setEditing(rule)}
                    style={{ fontSize: 11, fontWeight: 600, color: colors.accent, cursor: "pointer" }}
                  >
                    Edit
                  </span>
                  <span
                    onClick={() => { if (window.confirm(`Delete rule "${rule.id}"?`)) deleteRule(rule.id); }}
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

      {editing !== null && (
        <RuleEditorModal
          initial={editing === "new" ? undefined : editing}
          existingIds={rules.map((r) => r.id)}
          onSave={(r) => { upsertRule(r); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add/edit a triage rule. Produces a UIRule; persistence + re-apply
// are handled by the analysis context.
// ─────────────────────────────────────────────────────────────

function RuleEditorModal({
  initial,
  existingIds,
  onSave,
  onClose,
}: {
  initial?: UIRule;
  existingIds: string[];
  onSave: (rule: UIRule) => void;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.id ?? "");
  const [type, setType] = useState<UIRule["type"]>(initial?.type ?? "ignore");
  const [target, setTarget] = useState(initial?.target ?? "message");
  const [regex, setRegex] = useState(initial?.regex ?? "");
  const [tagValue, setTagValue] = useState(
    initial?.type === "tag" ? initial.actionDetail.replace(/^tag:\s*/i, "").trim() : "",
  );
  const [levelValue, setLevelValue] = useState(
    initial?.type === "set_level" ? initial.actionDetail.replace(/^set level:\s*/i, "").trim() : "SEVERE",
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!isEdit && !name.trim()) return setError("Name is required.");
    if (!regex.trim()) return setError("Match pattern is required.");
    try {
      new RegExp(regex);
    } catch {
      return setError("Match pattern is not a valid regular expression.");
    }
    if (type === "tag" && !tagValue.trim()) return setError("Tag value is required.");
    if (type === "set_level" && !levelValue.trim()) return setError("Level is required.");

    const id = initial?.id ?? makeId(name, existingIds);
    let actionDetail = "Ignore matching events";
    if (type === "tag") actionDetail = `tag: ${tagValue.trim()}`;
    else if (type === "set_level") actionDetail = `set level: ${levelValue.trim()}`;

    onSave({ id, type, target, regex: regex.trim(), actionDetail, on: initial?.on ?? true });
  }

  const field: React.CSSProperties = {
    width: "100%",
    fontSize: 13,
    fontFamily: font.mono,
    background: colors.surfaceMuted,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    color: colors.textSecondary,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = { ...uppercaseLabel, marginBottom: 6, display: "block" };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, background: colors.panel, borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{isEdit ? "Edit rule" : "Add rule"}</div>
          <div onClick={onClose} style={{ fontSize: 14, color: colors.textMuted, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>✕</div>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="e.g. ignore-anon-perms"
              style={{ ...field, opacity: isEdit ? 0.6 : 1, cursor: isEdit ? "not-allowed" : "text" }}
            />
            {isEdit && <div style={{ fontSize: 11, color: colors.textFaint, marginTop: 4 }}>Name is the rule's identity and can't be changed.</div>}
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as UIRule["type"])} style={field}>
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>{typeMeta[t].label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Applies to</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={field}>
                {TARGETS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Match (regex)</label>
            <input value={regex} onChange={(e) => setRegex(e.target.value)} placeholder="e.g. anonymous is missing the" style={field} />
          </div>

          {type === "tag" && (
            <div>
              <label style={labelStyle}>Tag</label>
              <input value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="e.g. security" style={field} />
            </div>
          )}

          {type === "set_level" && (
            <div>
              <label style={labelStyle}>Set level to</label>
              <select value={levelValue} onChange={(e) => setLevelValue(e.target.value)} style={field}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: "#d03b3b" }}>{error}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: `1px solid ${colors.border}`, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.panel, border: `1px solid ${colors.borderStrong}`, color: colors.text, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: colors.accent, color: "#fff", border: "none", cursor: "pointer" }}
          >
            {isEdit ? "Save changes" : "Add rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
