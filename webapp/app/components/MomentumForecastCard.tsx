"use client";

import styles from "./MomentumForecastCard.module.css";

type Context = "holding" | "watchlist" | "cio";

const dollars = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}` : "—";
};
const pct = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "—";
};

function contextNote(context: Context, forecast: any) {
  if (context === "holding") return "Forecast supports ADD / HOLD / TRIM review; thesis, valuation and CIO authority still govern capital decisions.";
  if (context === "watchlist") return forecast?.trigger ? `Trigger: ${forecast.trigger}` : "Forecast is a research trigger, not a BUY order.";
  return "Probability = scenario weight. Confidence = evidence quality. This is not a guaranteed price target or an automatic order.";
}

export default function MomentumForecastCard({ forecast, compact = false, context = "cio" }: { forecast: any; compact?: boolean; context?: Context }) {
  if (!forecast) return <div className={`${styles.card} ${compact ? styles.compact : ""}`}><div className={styles.eyebrow}>MOMENTUM FORECAST</div><div className={styles.muted} style={{ fontSize: 10, marginTop: 6 }}>DATA INCOMPLETE</div></div>;
  const scenarios = [forecast?.scenarios?.bear, forecast?.scenarios?.base, forecast?.scenarios?.bull].filter(Boolean);
  const expected = Number(forecast?.expectedReturnPct);
  const expectedClass = !Number.isFinite(expected) ? styles.muted : expected >= 0 ? styles.positive : styles.negative;
  return <div className={`${styles.card} ${compact ? styles.compact : ""}`} data-momentum-forecast="v26">
    <div className={styles.head}>
      <div><div className={styles.eyebrow}>MOMENTUM FORECAST · {forecast.horizon ?? "20–60D"}</div><div className={styles.outlook}>{String(forecast.outlook ?? "NEUTRAL").replaceAll("_", " ")}</div></div>
      <div className={styles.confidence}><strong>{Number(forecast.confidence ?? 0).toFixed(0)}</strong><small>CONFIDENCE /100</small></div>
    </div>
    <div className={styles.target}>
      <div><div className={styles.targetLabel}>Probability-weighted target</div><div className={styles.targetValue}>{dollars(forecast.probabilityWeightedTarget)}</div></div>
      <div className={`${styles.expected} ${expectedClass}`}>{pct(forecast.expectedReturnPct)}</div>
    </div>
    <div className={styles.scenarios}>{scenarios.map((scenario: any) => <div className={styles.scenario} key={scenario.name}>
      <div className={styles.scenarioTop}><strong>{scenario.name}</strong><span>{Number(scenario.probability ?? 0).toFixed(0)}%</span></div>
      <div className={styles.scenarioTarget}>{dollars(scenario.target)}</div>
      <div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, Number(scenario.probability ?? 0)))}%` }} /></div>
    </div>)}</div>
    <div className={styles.meta}><span className={styles.pill}>{String(forecast.lifecycleStage ?? "UNCONFIRMED").replaceAll("_", " ")}</span><span className={styles.pill}>{String(forecast.path ?? "RANGE_BUILD").replaceAll("_", " ")}</span><span className={styles.pill}>{forecast.confidenceBand ?? "LOW"} EVIDENCE</span></div>
    <div className={styles.note}>{contextNote(context, forecast)}</div>
  </div>;
}
