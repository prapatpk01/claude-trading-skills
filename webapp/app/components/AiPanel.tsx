"use client";
import { useState, useEffect } from "react";

// Minimal, safe markdown-ish renderer (bold + bullets + headers). No HTML injection.
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} style={{ height: 6 }} />;
    const bulleted = /^[-*•]\s+/.test(trimmed);
    const content = bulleted ? trimmed.replace(/^[-*•]\s+/, "") : trimmed;
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
    );
    return (
      <div key={i} style={{ paddingLeft: bulleted ? 16 : 0, position: "relative", margin: "3px 0", lineHeight: 1.55, fontSize: 13.5 }}>
        {bulleted && <span style={{ position: "absolute", left: 2, color: "var(--accent-2)" }}>▸</span>}
        {parts}
      </div>
    );
  });
}

export default function AiPanel({
  label,
  buildBody,
}: {
  label: string;
  buildBody: () => Record<string, any>;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; modelLabel: string; provider?: string; tier?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    configured: boolean;
    models: { label: string; tier: string }[];
    freeCount: number;
    detectedKeys?: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/ai").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI request failed");
      setResult({ text: json.text, modelLabel: json.modelLabel });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <button className="btn ai-btn" onClick={run} disabled={loading}>
          {loading ? <><span className="spinner" /> Thinking…</> : <>✨ {label}</>}
        </button>
        {result ? (
          <span className="ai-model">
            answered by {result.modelLabel}
            {result.tier === "free" && <span className="tag" style={{ marginLeft: 6 }}>free</span>}
          </span>
        ) : status?.configured ? (
          <span className="ai-model" title={status.models.map((m) => m.label).join(" → ")}>
            {status.models.length} models ready ({status.freeCount} free) · auto-switch on limit
          </span>
        ) : null}
      </div>
      {/* When no key is configured, show what the server actually sees rather
          than a long instruction blob — the useful question is whether the
          running deployment can read the variable at all. */}
      {status && !status.configured && status.detectedKeys ? (
        <div className="notice" style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>AI is off — no provider key visible to this deployment.</strong>
          </div>
          <div style={{ display: "grid", gap: 3, fontFamily: "ui-monospace, monospace", fontSize: 11.5, marginBottom: 10 }}>
            {Object.entries(status.detectedKeys).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>{k}</span>
                <span className={v ? "pos" : "muted"}>{v ? "✓ detected" : "— not set"}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            Free keys: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Gemini</a>{" · "}
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq</a>.<br />
            In Vercel: <strong>Settings → Environment Variables</strong> → add the name exactly as shown above,
            tick <strong>Production</strong>, Save → then <strong>Deployments → ⋯ → Redeploy</strong>.
            Environment changes only reach a <em>new</em> deployment.
          </div>
        </div>
      ) : (
        error && <div className="err" style={{ marginTop: 10 }}>⚠ {error}</div>
      )}
      {result && (
        <div className="ai-body">
          {renderMarkdown(result.text)}
        </div>
      )}
    </div>
  );
}
