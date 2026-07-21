import { useRef, useState, useEffect } from "react";

type FileUploadProps = {
  onUpload: (file: File) => void;
  loading: boolean;
};

export default function FileUpload({ onUpload, loading }: FileUploadProps) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (!loading) {
      setDots("");
      return;
    }
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === " . . .") return "";
        if (prev === " .") return " . .";
        if (prev === " . .") return " . . .";
        return " .";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onUpload(f);
      }}
      style={{
        border: `1.5px dashed ${drag ? "#2a78d6" : "var(--border-strong)"}`,
        borderRadius: 12,
        padding: "48px 32px",
        textAlign: "center",
        cursor: "pointer",
        background: drag ? "rgba(42,120,214,0.04)" : "var(--surface-1)",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={ref}
        type="file"
        accept=".log,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
        }}
      />
      {loading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            color: "var(--text-secondary)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid rgba(42,120,214,0.25)",
              borderTopColor: "#2a78d6",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div style={{ position: "relative", display: "inline-block", paddingRight: 30 }}>
            Analyzing log file<span style={{ position: "absolute", left: "calc(100% - 26px)", width: 26, textAlign: "left" }}>{dots}</span>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6 }}>
            Drop a Jenkins log file here
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>.log or .txt — or click to browse</div>
        </>
      )}
    </div>
  );
}
