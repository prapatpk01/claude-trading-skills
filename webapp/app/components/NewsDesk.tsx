"use client";
import { useState } from "react";
import { cls } from "./format";

/**
 * News desk — the narrative read, and what the three reads say together.
 *
 * Ordered by what a decision needs, not by what was easiest to compute: the
 * divergence between narrative and price first, then the pace it implies, then
 * the themes that are moving, then the calendar, and the raw headlines last.
 */

const PULSE_STYLE: Record<string, { color: string; bg: string }> = {
  Deteriorating: { color: "var(--red)", bg: "rgba(255,93,108,.16)" },
  Cautious: { color: "var(--amber)", bg: "rgba(245,185,59,.14)" },
  Balanced: { color: "var(--muted)", bg: "rgba(120,150,220,.12)" },
  Improving: { color: "var(--cyan)", bg: "rgba(55,230,216,.12)" },
  Expansive: { color: "var(--green)", bg: "rgba(47,214,137,.16)" },
};

const DIVERGENCE_STYLE: Record<string, string> = {
  "late-cycle": "var(--red)",
  "crowded-confirm": "var(--amber)",
  "early-recovery": "var(--green)",
  "priced-in": "var(--cyan)",
  aligned: "var(--muted)",
  insufficient: "var(--muted)",
};

const POSTURE_STYLE: Record<string, string> = {
  proceed: "var(--green)",
  stage: "var(--amber)",
  hold: "var(--red)",
  normal: "var(--muted)",
  accelerate: "var(--amber)",
};

/** A −100…+100 bar, centred on zero. */
function LeanBar({ value }: { value: number }) {
  const half = Math.min(50, Math.abs(value) / 2);
  const neg = value < 0;
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 999, background: "rgba(120,150,220,.14)", minWidth: 90 }}>
      <div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 10, background: "var(--border-strong)" }} />
      <div
        style={{
          position: "absolute", top: 0, height: 6, borderRadius: 999,
          left: neg ? `${50 - half}%` : "50%",
          width: `${half}%`,
          background: neg ? "var(--red)" : "var(--green)",
        }}
      />
    </div>
  );
}

export default function NewsDesk({ news, outlook }: { news: any; outlook: any }) {
  const [showHeadlines, setShowHeadlines] = useState(false);
  const [showSources, setShowSources] = useState(false);

  if (!news) {
    return (
      <div className="notice" style={{ marginTop: 14 }}>
        The economic news feeds could not be reached from this host, so there is no narrative read this run. The regime and
        sentiment readings above are unaffected — they come from price data on a different set of hosts.
      </div>
    );
  }

  const s = PULSE_STYLE[news.band] ?? PULSE_STYLE.Balanced;
  const d = outlook?.divergence;
  const gate = outlook?.gate;

  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="sub" style={{ marginTop: 0 }}>📰 News flow — the narrative read</h3>

      <div className="grid cols-2" style={{ marginBottom: 14, alignItems: "start" }}>
        <div className="metric">
          <div className="label">News pulse</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              {news.score == null ? "—" : `${news.score >= 0 ? "+" : ""}${news.score}`}
            </span>
            <span style={{
              padding: "3px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              color: s.color, background: s.bg, boxShadow: `inset 0 0 0 1px ${s.color}44`,
            }}>{news.band}</span>
          </div>
          <div className="sub" style={{ marginTop: 8 }}>
            {news.classified} of {news.total} headlines classified ({news.coveragePct}%) · {news.sourcesOk}/{news.sourcesTotal} sources
          </div>
        </div>
        {d && (
          <div className="metric">
            <div className="label">Narrative vs price</div>
            <div className="value" style={{ fontSize: 15, lineHeight: 1.35, color: DIVERGENCE_STYLE[d.kind] ?? "var(--text)" }}>
              {d.headline}
            </div>
            <div className="sub">Confidence: {d.confidence}</div>
          </div>
        )}
      </div>

      {d && (
        <div style={{ padding: "13px 15px", borderRadius: 13, background: "rgba(8,14,28,.5)", border: "1px solid var(--border-strong)", marginBottom: 14 }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.65, margin: 0 }} className="muted">{d.reading}</p>
        </div>
      )}

      {gate && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span className="tag" style={{ color: POSTURE_STYLE[gate.addPosture], borderColor: `${POSTURE_STYLE[gate.addPosture]}55` }}>
              adds: {gate.addPosture}
            </span>
            <span className="tag" style={{ color: POSTURE_STYLE[gate.trimPosture], borderColor: `${POSTURE_STYLE[gate.trimPosture]}55` }}>
              trims: {gate.trimPosture}
            </span>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>{gate.reason}</p>
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: "6px 0 0", fontStyle: "italic" }}>{gate.limit}</p>
        </div>
      )}

      {news.escalations?.length > 0 && (
        <>
          <h3 className="sub">Moving now — the two-day read against the week</h3>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18, display: "grid", gap: 7 }}>
            {news.escalations.map((e: any, i: number) => (
              <li key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: e.direction === "deteriorating" ? "var(--red)" : "var(--green)" }}>
                <strong>{e.theme} {e.shiftPts >= 0 ? "+" : ""}{e.shiftPts} pts</strong>{" "}
                <span className="muted">{e.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {news.themes?.length > 0 && (
        <>
          <h3 className="sub">By theme</h3>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th>Theme</th><th className="num">Read</th><th style={{ minWidth: 100 }}>Lean</th>
                <th className="num">48h</th><th className="num">Shift</th><th className="num">Stories</th>
              </tr></thead>
              <tbody>
                {news.themes.map((t: any) => (
                  <tr key={t.theme}>
                    <td>
                      <strong>{t.theme}</strong><br />
                      <span className="muted" style={{ fontSize: 11 }}>{t.meaning}</span>
                    </td>
                    <td className={cls("num", t.score == null ? "muted" : t.score > 0 ? "pos" : t.score < 0 ? "neg" : "muted")}>
                      {t.score == null ? "—" : `${t.score >= 0 ? "+" : ""}${t.score}`}
                    </td>
                    <td>{t.score == null ? <span className="muted">—</span> : <LeanBar value={t.score} />}</td>
                    <td className={cls("num", t.recentScore == null ? "muted" : t.recentScore > 0 ? "pos" : t.recentScore < 0 ? "neg" : "muted")}>
                      {t.recentScore == null ? "—" : `${t.recentScore >= 0 ? "+" : ""}${t.recentScore}`}
                    </td>
                    <td className={cls("num", t.shiftPts == null ? "muted" : Math.abs(t.shiftPts) < 25 ? "muted" : t.shiftPts > 0 ? "pos" : "neg")}>
                      {t.shiftPts == null ? "—" : `${t.shiftPts >= 0 ? "+" : ""}${t.shiftPts}`}
                    </td>
                    <td className="num muted">{t.headlines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            <strong>Read</strong> is the whole window; <strong>48h</strong> is the last two days only. The <strong>shift</strong> between
            them is what price has least likely absorbed — a shift of 25 points or more is flagged above.
          </p>
        </>
      )}

      {outlook?.calendar?.length > 0 && (
        <>
          <h3 className="sub">What is coming — and what it means before it lands</h3>
          {/* Blocks rather than a table: the pre-committed responses are the
              point of this section, and in a table they end up in a column wide
              enough to push itself off the page. */}
          <div style={{ display: "grid", gap: 10 }}>
            {outlook.calendar.map((e: any, i: number) => {
              const near = e.daysAway != null && e.daysAway <= 5;
              return (
                <div key={i} style={{
                  padding: "11px 13px", borderRadius: 12,
                  background: near ? "rgba(255,93,108,.06)" : "rgba(8,14,28,.42)",
                  border: `1px solid ${near ? "rgba(255,93,108,.35)" : "var(--border)"}`,
                }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13.5 }}>{e.label}</strong>
                    <span className="tag" style={near ? { color: "var(--red)", borderColor: "rgba(255,93,108,.45)" } : undefined}>
                      {e.window}
                    </span>
                    {e.daysAway != null && (
                      <span className={cls("muted", near && "neg")} style={{ fontSize: 11.5, fontWeight: near ? 700 : 400 }}>
                        {e.daysAway === 0 ? "today" : `in ${e.daysAway} day${e.daysAway === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: 11, lineHeight: 1.5, margin: "5px 0 0" }}>
                    {e.rule} <em>{e.source}</em>
                  </p>
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: "8px 0 0" }}>
                    <span style={{ color: "var(--red)", fontWeight: 700 }}>Against the book: </span>{e.ifHostile}
                  </p>
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: "5px 0 0" }}>
                    <span style={{ color: "var(--green)", fontWeight: 700 }}>In its favour: </span>{e.ifSupportive}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Dates marked [E] are projected from each agency&apos;s published release convention, not from a live schedule feed.
            FOMC is given at month resolution because the committee sets the date — it is not guessed, and no day count is
            shown for it. Confirm any date a decision depends on at the source.
          </p>
        </>
      )}

      {outlook && (
        <div className="grid cols-2" style={{ marginTop: 16, alignItems: "start" }}>
          <div>
            <h3 className="sub" style={{ marginTop: 0 }}>What confirms this stance</h3>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {outlook.confirms.map((c: string, i: number) => (
                <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--green)" }}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="sub" style={{ marginTop: 0 }}>What breaks it</h3>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {outlook.invalidates.map((c: string, i: number) => (
                <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--amber)" }}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {outlook?.actions?.length > 0 && (
        <>
          <h3 className="sub">Pace of execution</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {outlook.actions.map((a: string, i: number) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>{a}</li>
            ))}
          </ul>
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => setShowHeadlines((o) => !o)}>
          {showHeadlines ? "Hide" : "Show"} the headlines behind this read
        </button>
        <button className="btn ghost sm" onClick={() => setShowSources((o) => !o)}>
          {showSources ? "Hide" : "Show"} source coverage
        </button>
      </div>

      {showHeadlines && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr>
              <th>Headline</th><th className="num">Lean</th><th>Why it was read that way</th><th className="num">Age</th><th className="num">Weight</th>
            </tr></thead>
            <tbody>
              {news.themes.flatMap((t: any) => t.top).slice(0, 24).map((h: any, i: number) => (
                <tr key={i}>
                  <td style={{ minWidth: 240 }}>
                    {h.link ? (
                      <a href={h.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)" }}>{h.title}</a>
                    ) : h.title}
                    <br /><span className="muted" style={{ fontSize: 10.5 }}>{h.source}</span>
                  </td>
                  <td className={cls("num", h.lean == null ? "muted" : h.lean > 0 ? "pos" : h.lean < 0 ? "neg" : "muted")}>
                    {h.lean == null ? "—" : `${h.lean > 0 ? "+" : ""}${h.lean.toFixed(2)}`}
                  </td>
                  <td className="muted" style={{ fontSize: 11, minWidth: 180 }}>{h.matched.join(" · ")}</td>
                  <td className="num muted">{h.ageHours == null ? "—" : `${h.ageHours}h`}</td>
                  <td className="num muted">×{h.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSources && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>Source</th><th>Tier</th><th>Covers</th><th className="num">Items</th><th>Status</th></tr></thead>
            <tbody>
              {news.sources.map((src: any, i: number) => (
                <tr key={i}>
                  <td><strong>{src.label}</strong></td>
                  <td><span className="tag">{src.tier}</span></td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{src.covers}</td>
                  <td className="num">{src.items}</td>
                  <td className={src.error ? "neg" : "pos"} style={{ fontSize: 12 }}>{src.error ?? "ok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 5 }}>
        {news.notes.map((n: string, i: number) => (
          <li key={i} className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
