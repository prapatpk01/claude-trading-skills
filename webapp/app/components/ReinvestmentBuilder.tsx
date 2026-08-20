"use client";

import { useMemo, useState } from "react";
import {
  buildReinvestmentDraft,
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
  lang = "th",
}: {
  candidates: ReinvestmentCandidate[];
  deployableUsd: number;
  totalNavUsd: number;
  sellReviewPotentialUsd: number;
  cashFloorRepairUsd: number;
  lang?: "th" | "en";
}) {
  const ranked = useMemo(() => rankReinvestmentCandidates(candidates).slice(0, 12), [candidates]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<ReinvestmentSizingMode>("CONVICTION");
  const [showDraft, setShowDraft] = useState(false);

  const selectedRows = useMemo(() => ranked.filter(row => selected.includes(row.ticker)), [ranked, selected]);
  const draft = useMemo(() => buildReinvestmentDraft({
    deployableUsd,
    totalNavUsd,
    selected: selectedRows,
    mode,
    maxNames: 8,
    minOrderUsd: 100,
  }), [deployableUsd, totalNavUsd, selectedRows, mode]);

  const selectTop = (count: number) => {
    const tickers = ranked.slice(0, Math.min(count, 8)).map(row => row.ticker);
    setSelected(tickers);
    setShowDraft(false);
  };

  const toggle = (ticker: string) => {
    setSelected(current => {
      if (current.includes(ticker)) return current.filter(value => value !== ticker);
      if (current.length >= 8) return current;
      return [...current, ticker];
    });
    setShowDraft(false);
  };

  const readyCount = ranked.filter(row => row.readiness === "READY").length;
  const reviewCount = ranked.filter(row => row.readiness === "CIO_REVIEW").length;

  return <section className={styles.builder} data-reinvestment-builder="v28" data-max-names="8" data-auto-trade="false">
    <div className={styles.head}>
      <div>
        <span>04 · REINVESTMENT BUILDER</span>
        <h5>{lang === "th" ? "คัดเลือกการลงทุนจากเงินพร้อมใช้" : "Select investments for available capital"}</h5>
        <p>{lang === "th"
          ? "เลือกได้สูงสุด 8 ตัวจาก INV/AM ที่ผ่านหรือใกล้ผ่านเกณฑ์ แล้วให้ระบบคำนวณ Position Size, จำนวนหุ้น และเงินต่อรายการเป็น Draft ก่อนส่ง Funding/Risk/CIO"
          : "Select up to eight INV/AM candidates and size dollar/share draft orders before Funding, Risk and CIO approval."}</p>
      </div>
      <strong>{formatUsd(deployableUsd)}</strong>
    </div>

    <div className={styles.metrics}>
      <div><small>{lang === "th" ? "เงินพร้อมจัดสรร" : "AVAILABLE POOL"}</small><strong>{formatUsd(deployableUsd)}</strong></div>
      <div><small>{lang === "th" ? "READY" : "READY"}</small><strong>{readyCount}</strong></div>
      <div><small>{lang === "th" ? "CIO REVIEW" : "CIO REVIEW"}</small><strong>{reviewCount}</strong></div>
      <div><small>{lang === "th" ? "เลือกแล้ว" : "SELECTED"}</small><strong>{selected.length}/8</strong></div>
    </div>

    <div className={styles.sourceNote}>
      <span>{lang === "th" ? `Cash Floor repair ${formatUsd(cashFloorRepairUsd)}` : `Cash Floor repair ${formatUsd(cashFloorRepairUsd)}`}</span>
      <span>{lang === "th" ? `SELL REVIEW ${formatUsd(sellReviewPotentialUsd)} ยังไม่นับจนขายจริง` : `SELL REVIEW ${formatUsd(sellReviewPotentialUsd)} excluded until executed`}</span>
    </div>

    <div className={styles.toolbar}>
      <button type="button" onClick={() => selectTop(5)} disabled={!ranked.length || deployableUsd <= 0}>{lang === "th" ? "คัด Top 5" : "Auto Pick Top 5"}</button>
      <button type="button" onClick={() => selectTop(8)} disabled={!ranked.length || deployableUsd <= 0}>{lang === "th" ? "คัด Top 8" : "Auto Pick Top 8"}</button>
      <button type="button" onClick={() => { setSelected([]); setShowDraft(false); }} disabled={!selected.length}>{lang === "th" ? "ล้าง" : "Clear"}</button>
    </div>

    <div className={styles.candidates}>
      {ranked.length ? ranked.map((row, index) => {
        const active = selected.includes(row.ticker);
        return <button type="button" key={row.ticker} className={`${styles.candidate} ${active ? styles.selected : ""}`} onClick={() => toggle(row.ticker)}>
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
          <span className={styles.check}>{active ? "✓" : "+"}</span>
        </button>;
      }) : <div className={styles.empty}>{lang === "th" ? "ยังไม่มี candidate ที่ผ่านขั้นต่ำสำหรับสร้าง Draft ให้กดสแกน INV ใหม่เมื่อข้อมูล Research พร้อม" : "No candidate currently meets the minimum draft threshold."}</div>}
    </div>

    <div className={styles.sizing}>
      <div><span>{lang === "th" ? "POSITION SIZING" : "POSITION SIZING"}</span><small>{lang === "th" ? "BUY ใหม่ cap ~3% NAV/ตัว · ADD cap ~2% NAV/ตัว" : "New BUY cap ~3% NAV/name · ADD cap ~2% NAV/name"}</small></div>
      <div className={styles.modeButtons}>
        {(["EQUAL", "CONVICTION", "CORE_SATELLITE"] as ReinvestmentSizingMode[]).map(value => <button type="button" key={value} className={mode === value ? styles.modeActive : ""} onClick={() => { setMode(value); setShowDraft(false); }}>
          {value === "EQUAL" ? "Equal" : value === "CONVICTION" ? "Conviction" : "Core / Satellite"}
        </button>)}
      </div>
      <p>{mode === "EQUAL"
        ? (lang === "th" ? "แบ่งเงินใกล้เคียงกันทุกตัว ภายใต้ position cap" : "Near-equal allocation subject to position caps.")
        : mode === "CONVICTION"
          ? (lang === "th" ? "ให้น้ำหนักตาม Confidence + Expected Return + Research priority" : "Weights confidence, expected return and research priority.")
          : (lang === "th" ? "Top 3 เป็น Core รวมประมาณ 60% ที่เหลือเป็น Satellite 40%" : "Top three form roughly 60% core; remaining names share 40% satellite.")}</p>
    </div>

    <button type="button" className={styles.buildButton} disabled={!selected.length || deployableUsd <= 0} onClick={() => setShowDraft(true)}>
      {lang === "th" ? `สร้าง Draft Orders · ${selected.length} ตัว` : `Build Draft Orders · ${selected.length} names`}
    </button>

    {showDraft && <div className={styles.draft}>
      <div className={styles.draftHead}>
        <div><span>DRAFT ORDERS · {mode}</span><strong>{formatUsd(draft.allocatedUsd)} / {formatUsd(draft.deployableUsd)}</strong></div>
        <small>{lang === "th" ? `คงเหลือ ${formatUsd(draft.unallocatedUsd)}` : `${formatUsd(draft.unallocatedUsd)} unallocated`}</small>
      </div>
      {draft.orders.length ? draft.orders.map((order, index) => <div className={styles.order} key={order.ticker}>
        <div className={styles.orderRank}>{index + 1}</div>
        <div className={styles.orderName}><strong>{order.ticker}</strong><small>{order.action} · {order.readiness}</small></div>
        <div className={styles.orderSize}><strong>{formatUsd(order.suggestedUsd)}</strong><small>≈ {formatShares(order.estimatedShares)} {lang === "th" ? "หุ้น" : "shares"}</small></div>
        <div className={styles.orderMeta}><span>{order.portfolioPct.toFixed(2)}% NAV</span><span>{order.poolPct.toFixed(1)}% pool</span><span>@ {formatUsd(order.price)}</span></div>
      </div>) : <div className={styles.empty}>{lang === "th" ? "เงิน/position cap ทำให้ยังสร้างรายการขั้นต่ำ $100 ไม่ได้" : "No order cleared the minimum $100 draft size after policy caps."}</div>}
      <div className={styles.approval}>{lang === "th"
        ? "DRAFT ONLY · ยังไม่ส่งคำสั่งซื้อ · ต้องผ่าน Funding → Risk → CIO และยืนยันเงินจาก TRIM/SELL ที่เกิดขึ้นจริงก่อน"
        : "DRAFT ONLY · No broker order is sent. Funding → Risk → CIO approval and executed funding are still required."}</div>
    </div>}
  </section>;
}
