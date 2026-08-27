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
const probability = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}%` : "—";
};

function contextNote(context: Context, forecast: any) {
  if (context === "holding") return "Forecast supports ADD / HOLD / TRIM review; thesis, valuation, portfolio risk and CIO authority still govern capital decisions.";
  if (context === "watchlist") return forecast?.trigger ? `Trigger: ${forecast.trigger}` : "Forecast is a research trigger, not a BUY order.";
  return "Probability = rolling-forward statistical prior. Confidence = evidence quality. Forecast V37 is not a guaranteed price target or an automatic order.";
}

function horizonLabel(key: string, row: any) {
  return `${key} · P+ ${probability(row?.probabilityPositivePct)}`;
}

export default function MomentumForecastCard({ forecast, compact = false, context = "cio" }: { forecast: any; compact?: boolean; context?: Context }) {
  if (!forecast) return <div className={`${styles.card} ${compact ? styles.compact : ""}`}><div className={styles.eyebrow}>FORECAST V37</div><div className={styles.muted} style={{ fontSize: 10, marginTop: 6 }}>DATA INCOMPLETE</div></div>;
  const scenarios = [forecast?.scenarios?.bear, forecast?.scenarios?.base, forecast?.scenarios?.bull].filter(Boolean);
  const expected = Number(forecast?.expectedReturnPct);
  const expectedClass = !Number.isFinite(expected) ? styles.muted : expected >= 0 ? styles.positive : styles.negative;
  const horizons = ["5D", "20D", "60D"].map(key => ({ key, row: forecast?.horizons?.[key] })).filter(item => item.row);
  const engineVersion = forecast?.engineVersion ?? forecast?.version ?? "37.0";
  return <div className={`${styles.card} ${compact ? styles.compact : ""}`} data-momentum-forecast="v37">
    <div className={styles.head}>
      <div><div className={styles.eyebrow}>PROBABILISTIC ALPHA FORECAST · V{engineVersion}</div><div className={styles.outlook}>{String(forecast.outlook ?? "NEUTRAL").replaceAll("_", " ")}</div></div>
      <div className={styles.confidence}><strong>{Number(forecast.confidence ?? 0).toFixed(0)}</strong><small>CONFIDENCE /100</small></div>
    </div>
    <div className={styles.target}>
      <div><div className={styles.targetLabel}>20D probability-weighted target</div><div className={styles.targetValue}>{dollars(forecast.probabilityWeightedTarget)}</div></div>
      <div className={`${styles.expected} ${expectedClass}`}>{pct(forecast.expectedReturnPct)}</div>
    </div>
    {horizons.length ? <div className={styles.scenarios}>{horizons.map(({ key, row }) => <div className={styles.scenario} key={key}>
      <div className={styles.scenarioTop}><strong>{horizonLabel(key, row)}</strong><span>{pct(row.expectedReturnPct)}</span></div>
      <div className={styles.scenarioTarget}>α {pct(row.expectedAlphaPct)}</div>
      <div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, Number(row.probabilityPositivePct ?? 0)))}%` }} /></div>
    </div>)}</div> : null}
    <div className={styles.meta}>
      <span className={styles.pill}>P(+5%) {probability(forecast.probabilityGain5Pct)}</span>
      <span className={styles.pill}>P(-5%) {probability(forecast.probabilityLoss5Pct)}</span>
      <span className={styles.pill}>P10 {pct(forecast.rangeP10Pct)} → P90 {pct(forecast.rangeP90Pct)}</span>
      <span className={styles.pill}>ALPHA {pct(forecast.expectedAlphaPct)} vs {forecast.benchmark ?? "SPY"}</span>
      <span className={styles.pill}>AGREEMENT {Number(forecast.modelAgreementPct ?? 0).toFixed(0)}/100</span>
    </div>
    {!compact ? <div className={styles.scenarios}>{scenarios.map((scenario: any) => <div className={styles.scenario} key={scenario.name}>
      <div className={styles.scenarioTop}><strong>{scenario.name}</strong><span>{Number(scenario.probability ?? 0).toFixed(0)}%</span></div>
      <div className={styles.scenarioTarget}>{dollars(scenario.target)}</div>
      <div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, Number(scenario.probability ?? 0)))}%` }} /></div>
    </div>)}</div> : null}
    <div className={styles.meta}><span className={styles.pill}>{String(forecast.lifecycleStage ?? "UNCONFIRMED").replaceAll("_", " ")}</span><span className={styles.pill}>{String(forecast.path ?? "RANGE_BUILD").replaceAll("_", " ")}</span><span className={styles.pill}>{forecast.confidenceBand ?? "LOW"} EVIDENCE</span><span className={styles.pill}>{forecast.calibration?.status ?? "STATISTICAL PRIOR"}</span></div>
    <div className={styles.note}>{contextNote(context, forecast)}</div>
  </div>;
}
