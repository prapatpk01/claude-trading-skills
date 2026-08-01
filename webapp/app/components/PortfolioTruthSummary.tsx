"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";
import { money, pct, cls } from "./format";

interface Holding {
  ticker: string;
  shares: number;
  avg_cost: number;
  closed_at?: string | null;
}
interface Quote {
  price?: number | null;
  asOf?: string | null;
  stale?: boolean;
  staleReason?: string | null;
}

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export default function PortfolioTruthSummary({ lang, refreshKey = 0 }: { lang: AppLang; refreshKey?: number }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const portfolioRes = await fetch("/api/portfolio", { cache: "no-store" });
      const portfolio = await portfolioRes.json();
      if (!portfolioRes.ok || portfolio.error) throw new Error(portfolio.error || "Portfolio unavailable");
      const open = (portfolio.holdings ?? []).filter((h: Holding) => !h.closed_at && Number(h.shares) > 0);
      setHoldings(open);
      const tickers = Array.from(new Set(open.map((h: Holding) => h.ticker))).filter(Boolean);
      if (!tickers.length) {
        setQuotes({});
        return;
      }
      const quoteRes = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`, { cache: "no-store" });
      const quotePayload = await quoteRes.json();
      if (!quoteRes.ok || quotePayload.error) throw new Error(quotePayload.error || "Market prices unavailable");
      setQuotes(quotePayload.quotes ?? {});
    } catch (e: any) {
      setError(e?.message || "Unable to verify portfolio data");
      setQuotes({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const summary = useMemo(() => {
    let costBasis = 0;
    let marketValue = 0;
    const missing: string[] = [];
    const stale: string[] = [];

    for (const holding of holdings) {
      const shares = Number(holding.shares);
      const avgCost = Number(holding.avg_cost);
      if (!finitePositive(shares) || !Number.isFinite(avgCost) || avgCost < 0) continue;
      costBasis += shares * avgCost;
      const quote = quotes[holding.ticker];
      if (!quote || !finitePositive(quote.price)) {
        missing.push(holding.ticker);
        continue;
      }
      if (quote.stale) stale.push(holding.ticker);
      marketValue += shares * quote.price;
    }

    const complete = holdings.length > 0 && missing.length === 0 && stale.length === 0;
    const pnl = complete ? marketValue - costBasis : null;
    const returnPct = complete && costBasis > 0 && pnl != null ? (pnl / costBasis) * 100 : null;
    return { costBasis, marketValue: complete ? marketValue : null, pnl, returnPct, missing, stale, complete };
  }, [holdings, quotes]);

  const t = (en: string, th: string) => lang === "th" ? th : en;

  return (
    <section className="portfolio-truth-summary" aria-label={t("Verified portfolio summary", "สรุปพอร์ตที่ตรวจสอบแล้ว")}>
      <div className="grid cols-4">
        <div className="metric">
          <div className="label">{t("Verified Market Value", "มูลค่าตลาดที่ยืนยันแล้ว")}</div>
          <div className="value">{loading ? "…" : summary.marketValue == null ? "—" : money(summary.marketValue)}</div>
          <div className="sub">{holdings.length} {t("open positions", "สถานะเปิด")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Cost Basis", "ต้นทุนรวม")}</div>
          <div className="value">{loading ? "…" : money(summary.costBasis)}</div>
          <div className="sub">{t("Recorded transactions", "จากรายการซื้อที่บันทึกไว้")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Unrealized P/L", "กำไร/ขาดทุนที่ยังไม่รับรู้")}</div>
          <div className={cls("value", summary.pnl == null ? "" : summary.pnl >= 0 ? "pos" : "neg")}>{loading ? "…" : summary.pnl == null ? "—" : money(summary.pnl)}</div>
          <div className="sub">{summary.complete ? t("All prices verified", "ราคาครบและตรวจสอบแล้ว") : t("Withheld until prices are complete", "ระงับจนกว่าราคาจะครบ")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Verified Return", "ผลตอบแทนที่ยืนยันแล้ว")}</div>
          <div className={cls("value", summary.returnPct == null ? "" : summary.returnPct >= 0 ? "pos" : "neg")}>
            {loading ? "…" : summary.returnPct == null ? "—" : `${summary.returnPct >= 0 ? "+" : ""}${pct(summary.returnPct)}`}
          </div>
          <div className="sub">{t("No average-cost price fallback", "ไม่ใช้ต้นทุนแทนราคาตลาด")}</div>
        </div>
      </div>

      {!loading && (error || summary.missing.length > 0 || summary.stale.length > 0) && (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>{t("Portfolio valuation withheld", "ระงับการประเมินมูลค่าพอร์ต")}</strong>
          <div style={{ marginTop: 5 }}>
            {error || t("Some market prices could not be verified. NAV, P/L and return are intentionally not calculated.", "ไม่สามารถยืนยันราคาตลาดบางรายการได้ ระบบจึงไม่คำนวณ NAV, กำไร/ขาดทุน และผลตอบแทน")}
          </div>
          {summary.missing.length > 0 && <div style={{ marginTop: 4 }}>{t("Missing", "ไม่มีราคา")}: {summary.missing.join(", ")}</div>}
          {summary.stale.length > 0 && <div style={{ marginTop: 4 }}>{t("Stale", "ราคาเก่า")}: {summary.stale.join(", ")}</div>}
          <button type="button" className="btn ghost sm" onClick={load} style={{ marginTop: 9 }}>{t("Retry prices", "ลองดึงราคาใหม่")}</button>
        </div>
      )}
    </section>
  );
}
