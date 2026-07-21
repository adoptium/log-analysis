import { colors } from "../theme";

// ─────────────────────────────────────────────────────────────
// Placeholder for routes owned elsewhere:
//   • Investigate — built by another team member.
//   • Query — deferred, not being implemented yet.
// ─────────────────────────────────────────────────────────────

export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ padding: "24px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>{title}</div>
      <div
        style={{
          marginTop: 20,
          background: colors.panel,
          border: `1px dashed ${colors.borderStrong}`,
          borderRadius: 12,
          padding: "48px 24px",
          textAlign: "center",
          color: colors.textMuted,
          fontSize: 14,
        }}
      >
        {note}
      </div>
    </div>
  );
}
