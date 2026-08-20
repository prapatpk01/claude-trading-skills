"use client";

import { useMemo, useState } from "react";
import {
  buildReinvestmentDraft,
  curateReinvestmentCandidates,
  rankReinvestmentCandidates,
  type ReinvestmentCandidate,
  type ReinvestmentSizingMode,
} from "@/lib/research/reinvestmentBuilderPolicy";
import styles from "./ReinvestmentBuilder.module.css";

const formatUsd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);
const formatShares = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 7 }).format(value || 0);

export default function ReinvestmentBuilder({
  candidates,
  deployableUsd,
  totalNavUsd,
  sellReviewPotentialUsd,
  cashFloorRepairUsd,
  researchPassesRun = 1,
  completionReason = "",
  lang = "th",
}: {
  candidates: ReinvestmentCandidate[];
  deployableUsd: number;
  totalNavUsd: number;
  sellReviewPotentialUsd: number;
  cashFloorRepairUsd: number;
  researchPassesRun?: number;
  completionReason?: string;
  lang?: "th" | "en";
}) {
  const ranked = useMemo(() => rankReinvestmentCandidates(candidates).slice(0, 16), [candidates]);
  const curation = useMemo(() => curateReinvestmentCandidates({
    candidates: ranked,
    deployableUsd,
    minNames: 5,
    maxNames: 8,
    minOrderUsd: 100,
  }), [ranked, deployableUsd]);
  const curatedTickers = useMemo(() => new Set(curation.selected.map(row => row.ticker)), [curation.selected]);
  const [mode, setMode] = useState<ReinvestmentSizingMode>("CONVICTION");
  const [showDraft, setShowDraft] = useState(false);

  const draft = useMemo(() => buildReinvestmentDraft({
    deployableUsd,
    totalNavUsd,
    selected: curation.selected,
    mode,
    maxNames: 8,
    minOrderUsd: 100,
  }), [deployableUsd, totalNavUsd, curation.selected, mode]);

  const readyCount = ranked.filter(row => row.readiness === "READY").length;
  const reviewCount = ranked.filter(row => row.readiness === "CIO_REVIEW").length;

  return <section className={styles.builder} data-reinvestment-builder="v28.2" data-selection-owner="INV_RESEARCH" data-max-names="8" data-auto-trade="false">
    <div className={styles.head}>
      <div>
        <span>04 · REINVESTMENT BUILDER</span>
        <h5>{lang === "th" ? "INV คัดสรรหุ้น · AM/CIO จัด Position Size" : "INV-curated investments · AM/CIO position sizing"}</h5>
        <p>{lang === "th"
          ? "ทีม Investment Research คัดชุดลงทุน 5–8 ตัวอัตโนมัติจาก Research + Momentum Lifecycle + Forecast + Valuation และถ้ารอบแรกยังใช้เงินได้ไม่เต็ม ระบบจะขยาย Deep Research ไปยัง Candidate tranche ถัดไปจาก Full-Universe Scan โดยอัตโนมัติ"
          : "Investment Research automatically curates a 5–8 name basket and expands into the next full-universe deep-research tranche when the first pass leaves material capital unallocated."}</p>
      </div>
      <strong>{formatUsd(deployableUsd)}</strong>
    </div>

    <div className={styles.metrics}>
      <div><small>{lang === "th" ? "เงินพร้อมจัดสรร" : "AVAILABLE POOL"}</small><strong>{formatUsd(deployableUsd)}</strong></div>
      <div><small>READY</small><strong>{readyCount}</strong></div>
      <div><small>CIO REVIEW</small><strong>{reviewCount}</strong></div>
      <div><small>{lang === "th" ? "INV คัดแล้ว" : "INV CURATED"}</small><strong>{curation.selected.length}/8</strong></div>
    </div>

    <div className={styles.sourceNote}>
      <span>{`Cash Floor repair ${formatUsd(cashFloorRepairUsd)}`}</span>
      <span>{lang === "th" ? `SELL REVIEW ${formatUsd(sellReviewPotentialUsd)} ยังไม่นับจนขายจริง` : `SELL REVIEW ${formatUsd(sellReviewPotentialUsd)} excluded until executed`}</span>
    </div>

    <div className={styles.curationNote}>
      <strong>INV BASKET COMPLETION · {researchPassesRun}/3 PASSES</strong>
      <span>{lang === "th"
        ? `เป้าหมาย 5–8 ตัว · เงินรองรับได้สูงสุด ${curation.capitalCapacityNames} ตัว · Candidate ที่ใช้พิจารณา ${curation.availableCount} ตัว`
        : `Target 5–8 names · capital supports up to ${curation.capitalCapacityNames} names · ${curation.availableCount} candidates reviewed`}</span>
      <small>{completionReason || curation.rationale}</small>
      <small>{curation.rationale}</small>
    </div>

    <div className={styles.candidates}>
      {ranked.length ? ranked.map((row, index) => {
        const selected = curatedTickers.has(row.ticker);
        return <div key={row.ticker} className={`${styles.candidate} ${selected ? styles.selected : ""}`}>
          <div className={styles.rank}>#{index + 1}</div>
          <div className={styles.identity}>
            <strong>{row.ticker}</strong>
            <small>{row.sourceStage ?? row.lifecycleStage ?? "INV CANDIDATE"} · {row.lifecycleStage ?? "—"}</small>
          </div>
          <div className={styles.signal}>
            <strong>{row.confidence}/100</strong>
            <small>{row.expectedReturnPct >= 0 ? "+" : ""}{row.expectedReturnPct.toFixed(1)}%</small>
          </div>
          <span className={`${styles.readiness} ${row.readiness === "READY" ? styles.ready : styles.review}`}>{row.readiness === "READY" ? row.action : "CIO REVIEW"}</span>
          <span className={styles.check} title={selected ? "INV SELECTED" : "INV STANDBY"}>{selected ? "✓" : "—"}</span>
        </div>;
      }) : <div className={styles.empty}>{lang === "th" ? "ยังไม่มี candidate ที่ผ่านขั้นต่ำหลัง INV ขยาย Research ตาม policy แล้ว เงินคงเหลือจะพักใน Buffer" : "No candidate cleared the minimum after governed INV expansion; residual capital remains in Buffer."}</div>}
    </div>

    <div className={styles.sizing}>
      <div><span>POSITION SIZING · AM / CIO</span><small>{lang === "th" ? "BUY ใหม่ cap ~3% NAV/ตัว · ADD cap ~2% NAV/ตัว" : "New BUY cap ~3% NAV/name · ADD cap ~2% NAV/name"}</small></div>
      <div className={styles.modeButtons}>
        {(["EQUAL", "CONVICTION", "CORE_SATELLITE"] as ReinvestmentSizingMode[]).map(value => <button type="button" key={value} className={mode === value ? styles.modeActive : ""} onClick={() => { setMode(value); setShowDraft(false); }}>
          {value === "EQUAL" ? "Equal" : value === "CONVICTION" ? "Conviction" : "Core / Satellite"}
        </button>)}
      </div>
      <p>{mode === "EQUAL"
        ? (lang === "th" ? "AM/CIO แบ่งเงินใกล้เคียงกันทุกตัวภายใต้ position cap" : "AM/CIO allocates near-equal dollars subject to position caps.")
        : mode === "CONVICTION"
          ? (lang === "th" ? "AM/CIO ให้น้ำหนักตาม Confidence + Expected Return + Research priority ของชุดที่ INV คัดแล้ว" : "AM/CIO weights the INV-curated basket by confidence, expected return and research priority.")
          : (lang === "th" ? "Top 3 ของชุด INV เป็น Core รวมประมาณ 60% ที่เหลือเป็น Satellite 40%" : "Top three INV selections form roughly 60% core; remaining names share 40% satellite.")}</p>
    </div>

    <button type="button" className={styles.buildButton} disabled={!curation.selected.length || deployableUsd <= 0} onClick={() => setShowDraft(true)}>
      {lang === "th" ? `สร้าง Draft จากชุด INV · ${curation.selected.length} ตัว` : `Build draft from INV basket · ${curation.selected.length} names`}
    </button>

    {showDraft && <div className={styles.draft}>
      <div className={styles.draftHead}>
        <div><span>DRAFT ORDERS · INV CURATED · {mode}</span><strong>{formatUsd(draft.allocatedUsd)} / {formatUsd(draft.deployableUsd)}</strong></div>
        <small>{lang === "th" ? `คงเหลือ ${formatUsd(draft.unallocatedUsd)}` : `${formatUsd(draft.unallocatedUsd)} unallocated`}</small>
      </div>
      {draft.orders.length ? draft.orders.map((order, index) => <div className={styles.order} key={order.ticker}>
        <div className={styles.orderRank}>{index + 1}</div>
        <div className={styles.orderName}><strong>{order.ticker}</strong><small>{order.action} · {order.readiness}</small></div>
        <div className={styles.orderSize}><strong>{formatUsd(order.suggestedUsd)}</strong><small>≈ {formatShares(order.estimatedShares)} {lang === "th" ? "หุ้น" : "shares"}</small></div>
        <div className={styles.orderMeta}><span>{order.portfolioPct.toFixed(2)}% NAV</span><span>{order.poolPct.toFixed(1)}% pool</span><span>@ {formatUsd(order.price)}</span></div>
      </div>) : <div className={styles.empty}>{lang === "th" ? "เงิน/position cap ทำให้ยังสร้างรายการขั้นต่ำ $100 ไม่ได้" : "No order cleared the minimum $100 draft size after policy caps."}</div>}
      <div className={styles.approval}>{lang === "th"
        ? "INV คัดสรรและขยาย Basket แล้ว แต่ Draft ยังไม่ใช่คำสั่งซื้อ · ต้องผ่าน AM sizing → Funding → Risk → CIO และยืนยันเงินจาก TRIM/SELL ที่เกิดขึ้นจริงก่อน"
        : "INV has curated and expanded the basket, but this remains a draft. AM sizing → Funding → Risk → CIO approval and executed funding are still required."}</div>
    </div>}
  </section>;
}
