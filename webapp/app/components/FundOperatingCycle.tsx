"use client";

import { useMemo, useState } from "react";
import type { AppLang } from "../page";
import styles from "./FundOperatingCycle.module.css";

type StageState = "idle" | "running" | "done" | "warning";
type ActionKind = "ADD_EXISTING" | "ADD_NEW" | "HOLD" | "TRIM" | "EXIT" | "CASH";
type Action = { kind: ActionKind; ticker: string; label: string; reason: string; amount?: number | null; weight?: number | null; score?: number | null };

type Stage = { key: string; en: string; th: string; endpoint: string; state: StageState; detail?: string };

const tx = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;
const money = (n?: number | null) => n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (...values: unknown[]) => values.find(v => typeof v === "string" && v.trim()) as string | undefined;

const INITIAL_STAGES: Stage[] = [
  { key: "macro", en: "Macro & regime", th: "Macro และสภาวะตลาด", endpoint: "/api/macro/intelligence", state: "idle" },
  { key: "portfolio", en: "Holdings & market truth", th: "Holdings และราคาตลาด", endpoint: "/api/portfolio", state: "idle" },
  { key: "integrity", en: "Data integrity", th: "ความถูกต้องของข้อมูล", endpoint: "/api/portfolio/integrity", state: "idle" },
  { key: "liquidity", en: "Liquidity & reserve", th: "สภาพคล่องและเงินสำรอง", endpoint: "/api/portfolio/cash-buffer", state: "idle" },
  { key: "optimizer", en: "Portfolio construction", th: "การจัดพอร์ต", endpoint: "/api/portfolio/optimizer", state: "idle" },
  { key: "opportunity", en: "New opportunities", th: "โอกาสลงทุนใหม่", endpoint: "/api/portfolio/opportunity-allocation", state: "idle" },
  { key: "committee", en: "Investment committee", th: "คณะกรรมการลงทุน", endpoint: "/api/committee/audit", state: "idle" },
  { key: "cio", en: "Final CIO resolution", th: "มติสุดท้ายของ CIO", endpoint: "/api/v10/cio", state: "idle" },
];

async function readJson(endpoint: string) {
  const response = await fetch(endpoint, { cache: "no-store" });
  let body: any = null;
  try { body = await response.json(); } catch { body = null; }
  return { ok: response.ok, status: response.status, body };
}

function actionFromRaw(raw: any, held: Set<string>): Action | null {
  const ticker = String(raw?.ticker ?? raw?.symbol ?? raw?.security ?? "").toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-]{1,12}$/.test(ticker)) return null;
  const rawAction = String(raw?.action ?? raw?.recommendation ?? raw?.decision ?? raw?.status ?? "").toUpperCase();
  let kind: ActionKind = "HOLD";
  if (/EXIT|SELL ALL|CLOSE/.test(rawAction)) kind = "EXIT";
  else if (/TRIM|REDUCE|SELL/.test(rawAction)) kind = "TRIM";
  else if (/ADD|BUY|INITIATE|OPEN/.test(rawAction)) kind = held.has(ticker) ? "ADD_EXISTING" : "ADD_NEW";
  else if (/CASH|RESERVE|LIQUID/.test(rawAction)) kind = "CASH";
  const reason = text(raw?.reason, raw?.rationale, raw?.thesis, raw?.note, raw?.summary) ?? "Policy review completed.";
  return {
    kind,
    ticker,
    label: rawAction || kind.replace("_", " "),
    reason,
    amount: num(raw?.amount ?? raw?.capital ?? raw?.allocationAmount ?? raw?.dollars),
    weight: num(raw?.targetWeight ?? raw?.weight ?? raw?.allocationPct),
    score: num(raw?.score ?? raw?.conviction ?? raw?.confidence),
  };
}

function collectArrays(value: any, output: any[] = [], depth = 0): any[] {
  if (depth > 4 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") output.push(item);
      collectArrays(item, output, depth + 1);
    }
  } else if (typeof value === "object") {
    for (const child of Object.values(value)) collectArrays(child, output, depth + 1);
  }
  return output;
}

export default function FundOperatingCycle({ lang }: { lang: AppLang }) {
  const [stages, setStages] = useState<Stage[]>(INITIAL_STAGES);
  const [running, setRunning] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const groups = useMemo(() => {
    const result: Record<ActionKind, Action[]> = { ADD_EXISTING: [], ADD_NEW: [], HOLD: [], TRIM: [], EXIT: [], CASH: [] };
    actions.forEach(a => result[a.kind].push(a));
    return result;
  }, [actions]);

  async function runCycle() {
    setRunning(true); setCompletedAt(null); setActions([]); setSummary(null); setErrors([]);
    setStages(INITIAL_STAGES.map(s => ({ ...s, state: "idle", detail: undefined })));
    const results: Record<string, any> = {};
    const failures: string[] = [];

    for (const stage of INITIAL_STAGES) {
      setStages(prev => prev.map(s => s.key === stage.key ? { ...s, state: "running" } : s));
      const result = await readJson(stage.endpoint);
      results[stage.key] = result.body;
      const detail = result.ok ? `HTTP ${result.status}` : `HTTP ${result.status} · ${text(result.body?.error, result.body?.message) ?? "Unavailable"}`;
      setStages(prev => prev.map(s => s.key === stage.key ? { ...s, state: result.ok ? "done" : "warning", detail } : s));
      if (!result.ok) failures.push(`${stage.en}: ${detail}`);
    }

    const holdings = Array.isArray(results.portfolio?.holdings) ? results.portfolio.holdings.filter((h: any) => !h.closed_at) : [];
    const held = new Set<string>(holdings.map((h: any) => String(h.ticker ?? "").toUpperCase()));
    const rawCandidates = [
      ...collectArrays(results.optimizer),
      ...collectArrays(results.opportunity),
      ...collectArrays(results.committee),
    ];
    const seen = new Set<string>();
    const normalized: Action[] = [];
    for (const raw of rawCandidates) {
      const a = actionFromRaw(raw, held);
      if (!a) continue;
      const key = `${a.kind}:${a.ticker}`;
      if (seen.has(key)) continue;
      seen.add(key); normalized.push(a);
    }

    if (!normalized.length) {
      holdings.slice(0, 8).forEach((h: any) => normalized.push({ kind: "HOLD", ticker: String(h.ticker), label: "HOLD", reason: "No approved change cleared the complete operating cycle." }));
    }

    const reserveAction = text(results.liquidity?.recommendation, results.liquidity?.action, results.optimizer?.liquidityAction);
    if (reserveAction) normalized.push({ kind: "CASH", ticker: "RESERVE", label: reserveAction, reason: text(results.liquidity?.reason, results.liquidity?.summary) ?? "Liquidity policy result.", amount: num(results.liquidity?.deployableExcess ?? results.liquidity?.shortfall) });

    setActions(normalized);
    setSummary({
      posture: text(results.cio?.posture, results.cio?.status, results.macro?.regime?.classification, results.macro?.classification) ?? "REVIEW",
      readiness: num(results.cio?.readinessPct ?? results.cio?.readiness) ?? 0,
      regime: text(results.macro?.regime?.classification, results.macro?.classification, results.macro?.regime?.stance) ?? "—",
      nav: num(results.optimizer?.verifiedNav ?? results.liquidity?.verifiedNav ?? results.portfolio?.summary?.nav),
      reserve: num(results.liquidity?.bufferRatioPct ?? results.liquidity?.ratioPct),
      humanApproval: true,
    });
    setErrors(failures); setCompletedAt(new Date().toISOString()); setRunning(false);
  }

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>ONE-CLICK FUND OPERATING CYCLE</div>
        <h2>{tx(lang, "Convene the entire fund", "ประชุมกองทุนทั้งระบบ")}</h2>
        <p>{tx(lang, "One meeting runs every desk and returns one executable, human-reviewed action plan. No more opening Macro, Valuation, Holdings and Committee separately.", "กดครั้งเดียวเพื่อรันทุกทีม และรับแผนปฏิบัติการฉบับเดียวที่มนุษย์ตรวจสอบแล้ว ไม่ต้องเปิด Macro, Valuation, Holdings และ Committee แยกกันอีก")}</p>
      </div>
      <button className={styles.run} onClick={runCycle} disabled={running}>{running ? tx(lang, "Meeting in progress…", "กำลังประชุม…") : tx(lang, "Convene full fund meeting", "เริ่มประชุมกองทุนทั้งหมด")}</button>
    </div>

    <div className={styles.stages}>{stages.map((stage, index) => <div className={`${styles.stage} ${styles[stage.state]}`} key={stage.key}><span>{index + 1}</span><div><strong>{tx(lang, stage.en, stage.th)}</strong><small>{stage.detail ?? tx(lang, "Waiting", "รอเริ่ม")}</small></div></div>)}</div>

    {summary && <>
      <div className={styles.executive}>
        <Metric label={tx(lang, "CIO posture", "ท่าที CIO")} value={summary.posture}/>
        <Metric label={tx(lang, "Readiness", "ความพร้อม")} value={`${summary.readiness}%`}/>
        <Metric label={tx(lang, "Regime", "สภาวะตลาด")} value={summary.regime}/>
        <Metric label="NAV" value={money(summary.nav)}/>
        <Metric label={tx(lang, "Liquidity reserve", "เงินสำรอง")} value={summary.reserve == null ? "—" : `${summary.reserve.toFixed(1)}%`}/>
        <Metric label={tx(lang, "Execution", "การดำเนินการ")} value={tx(lang, "HUMAN APPROVAL", "มนุษย์อนุมัติ")}/>
      </div>

      <div className={styles.actionGrid}>
        <ActionGroup title={tx(lang, "Add existing holdings", "ซื้อเพิ่มหุ้นที่มีอยู่")} tone="green" actions={groups.ADD_EXISTING} empty={tx(lang, "No existing holding cleared an add", "ไม่มีหุ้นเดิมผ่านเกณฑ์ซื้อเพิ่ม")}/>
        <ActionGroup title={tx(lang, "Open new positions", "เปิดหุ้นใหม่")} tone="cyan" actions={groups.ADD_NEW} empty={tx(lang, "No new position cleared the committee", "ไม่มีหุ้นใหม่ผ่านคณะกรรมการ")}/>
        <ActionGroup title={tx(lang, "Hold / watch", "ถือ / ติดตาม")} tone="blue" actions={groups.HOLD} empty={tx(lang, "No hold instruction", "ไม่มีคำสั่งถือ")}/>
        <ActionGroup title={tx(lang, "Trim", "ลดน้ำหนัก")} tone="amber" actions={groups.TRIM} empty={tx(lang, "No trim required", "ไม่ต้องลดน้ำหนัก")}/>
        <ActionGroup title={tx(lang, "Exit", "ออกจากสถานะ")} tone="red" actions={groups.EXIT} empty={tx(lang, "No thesis break or exit", "ไม่มีหุ้นที่ต้องออก")}/>
        <ActionGroup title={tx(lang, "Cash & reserve", "เงินสดและเงินสำรอง")} tone="purple" actions={groups.CASH} empty={tx(lang, "Maintain current reserve", "รักษาเงินสำรองปัจจุบัน")}/>
      </div>

      <div className={styles.nextStep}><strong>{tx(lang, "What happens next", "ขั้นตอนถัดไป")}</strong><ol><li>{tx(lang, "Review tickers, sizing and dissent above.", "ตรวจชื่อหุ้น ขนาดลงทุน และข้อคัดค้านด้านบน")}</li><li>{tx(lang, "Approve or reject each proposed change.", "อนุมัติหรือปฏิเสธแต่ละข้อเสนอ")}</li><li>{tx(lang, "Approved actions move to the transaction form; nothing executes automatically.", "รายการที่อนุมัติจึงส่งต่อไปแบบฟอร์มธุรกรรม ระบบไม่ซื้อขายอัตโนมัติ")}</li></ol></div>
      {errors.length > 0 && <div className={styles.warning}><strong>{tx(lang, "Meeting completed with warnings", "ประชุมเสร็จพร้อมคำเตือน")}</strong>{errors.map(e => <div key={e}>• {e}</div>)}</div>}
      <div className={styles.timestamp}>{tx(lang, "Completed", "เสร็จสิ้น")} · {completedAt ? new Date(completedAt).toLocaleString() : "—"}</div>
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function ActionGroup({ title, tone, actions, empty }: { title: string; tone: string; actions: Action[]; empty: string }) { return <div className={`${styles.group} ${styles[tone]}`}><h3>{title}<span>{actions.length}</span></h3>{actions.length ? actions.map(a => <div className={styles.action} key={`${a.kind}-${a.ticker}`}><div><strong>{a.ticker}</strong><span>{a.label}</span></div><p>{a.reason}</p><small>{a.amount != null ? money(a.amount) : ""}{a.weight != null ? ` · ${a.weight.toFixed(1)}%` : ""}{a.score != null ? ` · score ${a.score}` : ""}</small></div>) : <div className={styles.empty}>{empty}</div>}</div>; }
