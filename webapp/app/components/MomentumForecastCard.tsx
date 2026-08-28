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
  if (context === "holding") return "Forecast ใช้ประกอบ ADD / HOLD / TRIM เท่านั้น; thesis, valuation, portfolio risk และ CIO authority ยังเป็นตัวตัดสินเงินทุน";
  if (context === "watchlist") return forecast?.trigger ? `Trigger: ${forecast.trigger}` : "Forecast เป็นสัญญาณวิจัย ไม่ใช่คำสั่ง BUY";
  return "Probability เป็น statistical prior จากข้อมูลย้อนหลังและสัญญาณปัจจุบัน ไม่ใช่การรับประกันราคา และไม่ใช่คำสั่งซื้ออัตโนมัติ";
}

function horizonLabel(key: string, row: any) {
  return `${key} · โอกาสขึ้น ${probability(row?.probabilityPositivePct)}`;
}

function forecastTone(forecast: any) {
  const expected = Number(forecast?.expectedReturnPct);
  const pUp = Number(forecast?.probabilityPositivePct);
  const pDown = Number(forecast?.probabilityLoss5Pct);
  if (Number.isFinite(expected) && Number.isFinite(pUp) && expected >= 5 && pUp >= 60 && (!Number.isFinite(pDown) || pDown <= 25)) return "ATTRACTIVE";
  if ((Number.isFinite(expected) && expected < 0) || (Number.isFinite(pUp) && pUp < 45) || (Number.isFinite(pDown) && pDown >= 35)) return "DEFENSIVE";
  return "WATCH";
}

export default function MomentumForecastCard({ forecast, compact = false, context = "cio" }: { forecast: any; compact?: boolean; context?: Context }) {
  if (!forecast) return <div className={`${styles.card} ${compact ? styles.compact : ""}`}><div className={styles.eyebrow}>FORECAST V37.1</div><div className={styles.muted} style={{ fontSize: 10, marginTop: 6 }}>DATA INCOMPLETE</div></div>;
  const scenarios = [forecast?.scenarios?.bear, forecast?.scenarios?.base, forecast?.scenarios?.bull].filter(Boolean);
  const expected = Number(forecast?.expectedReturnPct);
  const expectedClass = !Number.isFinite(expected) ? styles.muted : expected >= 0 ? styles.positive : styles.negative;
  const horizons = ["5D", "20D", "60D"].map(key => ({ key, row: forecast?.horizons?.[key] })).filter(item => item.row);
  const engineVersion = forecast?.engineVersion ?? forecast?.version ?? "37.1";
  const tone = forecastTone(forecast);

  return <div className={`${styles.card} ${compact ? styles.compact : ""}`} data-momentum-forecast="v37.1-decision-first">
    <div className={styles.head}>
      <div><div className={styles.eyebrow}>FORECAST · 20D · V{engineVersion}</div><div className={styles.outlook}>{tone}</div></div>
      <div className={styles.confidence}><strong>{Number(forecast.confidence ?? 0).toFixed(0)}</strong><small>CONFIDENCE /100</small></div>
    </div>

    <div className={styles.target}>
      <div><div className={styles.targetLabel}>ผลตอบแทนคาดการณ์ 20 วัน</div><div className={styles.targetValue}>{dollars(forecast.probabilityWeightedTarget)}</div></div>
      <div className={`${styles.expected} ${expectedClass}`}>{pct(forecast.expectedReturnPct)}</div>
    </div>

    <div className={styles.scenarios}>
      <div className={styles.scenario}>
        <div className={styles.scenarioTop}><strong>โอกาสขึ้น</strong><span>{probability(forecast.probabilityPositivePct)}</span></div>
        <div className={styles.scenarioTarget}>ราคาปิดสูงกว่าปัจจุบัน</div>
      </div>
      <div className={styles.scenario}>
        <div className={styles.scenarioTop}><strong>โอกาส +5%</strong><span>{probability(forecast.probabilityGain5Pct)}</span></div>
        <div className={styles.scenarioTarget}>Upside ที่มีนัยสำคัญ</div>
      </div>
      <div className={styles.scenario}>
        <div className={styles.scenarioTop}><strong>ความเสี่ยง -5%</strong><span>{probability(forecast.probabilityLoss5Pct)}</span></div>
        <div className={styles.scenarioTarget}>Downside มากกว่า 5%</div>
      </div>
    </div>

    {!compact ? <details style={{ marginTop: 10, borderTop: "1px solid rgba(143,164,200,.18)", paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 800, color: "#8fa4c8" }}>รายละเอียด Forecast</summary>
      <div style={{ marginTop: 10 }}>
        {horizons.length ? <div className={styles.scenarios}>{horizons.map(({ key, row }) => <div className={styles.scenario} key={key}>
          <div className={styles.scenarioTop}><strong>{horizonLabel(key, row)}</strong><span>{pct(row.expectedReturnPct)}</span></div>
          <div className={styles.scenarioTarget}>เหนือ {forecast.benchmark ?? "SPY"} {pct(row.expectedAlphaPct)}</div>
          <div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, Number(row.probabilityPositivePct ?? 0)))}%` }} /></div>
        </div>)}</div> : null}

        <div className={styles.meta}>
          <span className={styles.pill}>เหนือ {forecast.benchmark ?? "SPY"} {pct(forecast.expectedAlphaPct)}</span>
          <span className={styles.pill}>ช่วง P10 {pct(forecast.rangeP10Pct)} → P90 {pct(forecast.rangeP90Pct)}</span>
          <span className={styles.pill}>MODEL AGREEMENT {Number(forecast.modelAgreementPct ?? 0).toFixed(0)}/100</span>
          <span className={styles.pill}>{forecast.confidenceBand ?? "LOW"} EVIDENCE</span>
        </div>

        <div className={styles.scenarios}>{scenarios.map((scenario: any) => <div className={styles.scenario} key={scenario.name}>
          <div className={styles.scenarioTop}><strong>{scenario.name}</strong><span>{Number(scenario.probability ?? 0).toFixed(0)}%</span></div>
          <div className={styles.scenarioTarget}>{dollars(scenario.target)}</div>
          <div className={styles.bar}><div className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, Number(scenario.probability ?? 0)))}%` }} /></div>
        </div>)}</div>

        <div className={styles.meta}>
          <span className={styles.pill}>{String(forecast.lifecycleStage ?? "UNCONFIRMED").replaceAll("_", " ")}</span>
          <span className={styles.pill}>{String(forecast.path ?? "RANGE_BUILD").replaceAll("_", " ")}</span>
          <span className={styles.pill}>{forecast.calibration?.status ?? "STATISTICAL PRIOR"}</span>
        </div>
      </div>
    </details> : null}

    <div className={styles.note}>{contextNote(context, forecast)}</div>
  </div>;
}
