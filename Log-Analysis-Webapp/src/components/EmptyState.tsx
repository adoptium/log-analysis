import type { ReactNode } from "react";
import { colors } from "../theme";

// Empty state component for pages with no content. Used for the pages when no file is loaded

export default function EmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: "72px 24px", display: "flex", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: colors.panel,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: "40px 32px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Document / upload glyph */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: colors.accentBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 4,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M12 18v-6" />
            <path d="M9.5 14.5 12 12l2.5 2.5" />
          </svg>
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>{title}</div>
        <div style={{ fontSize: 13.5, color: colors.textMuted, lineHeight: 1.5 }}>{subtitle}</div>
        {action && <div style={{ marginTop: 12 }}>{action}</div>}
      </div>
    </div>
  );
}
