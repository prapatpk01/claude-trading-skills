"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./FundCommandCenter.module.css";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type Quote = { price?: number; changePercent?: number } | null;

type Props = { onNavigate: (tab: string) => void };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function FundCommandCenter({ onNavigate }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetch("/api/portfolio").then(r => r.json());
      const open: Holding[] = (p.holdings ?? []).filter((h: Holding) => !h.closed_at);
      setHoldings(open);
      const tickers = Array.from(new Set(open.map(h => h.ticker)));
      if (tickers.length) {
        const q = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`).then(r => r.json());
        setQuotes(q.quotes ?? {});
      }
    } catch {
      setHoldings([]);
      setQuotes({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const book = useMemo(() => {
    let nav = 0, cost = 0;
    const rows = holdings.map(h => {
      const price = quotes[h.ticker]?.price ?? h.avg_cost;
      const value = price * h.shares;
      nav += value;
      cost += h.avg_cost * h.shares;
      return { ...h, price, value };
    }).sort((a,b) => b.value - a.value);
    const pnl = nav - cost;
    const ret = cost ? pnl / cost * 100 : 0;
    const topWeight = nav && rows[0] ? rows[0].value / nav * 100 : 0;
    const hhi = nav ? rows.reduce((s,r) => s + Math.pow(r.value / nav, 2), 0) * 100 : 0;
    return { nav, cost, pnl, ret, topWeight, hhi, rows };
  }, [holdings, quotes]);

  const posture = book.topWeight > 25 ? "CONCENTRATION WATCH" : book.ret < -8 ? "DEFENSIVE REVIEW" : "POLICY NORMAL";
  const postureClass = book.topWeight > 25 || book.ret < -8 ? styles.neg : styles.pos;

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <div className={styles.eyebrow}>Sentinel Capital · Investment Command</div>
            <h2 className={styles.title}>Fund Management OS</h2>
            <div className={styles.lead}>One operating surface for research, portfolio construction, risk control and alpha discovery. Decisions stay separated from signals: research creates conviction, portfolio policy controls sizing, and risk always has veto power.</div>
          </div>
          <div className={styles.status}><span className={styles.dot}/> SYSTEM ONLINE</div>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.action} ${styles.primary}`} onClick={() => onNavigate("analyze")}>Research Security</button>
          <button className={styles.action} onClick={() => onNavigate("portfolio")}>Review Portfolio</button>
          <button className={styles.action} onClick={() => onNavigate("scanner")}>Find Alpha</button>
          <button className={styles.action} onClick={load}>Refresh Book</button>
        </div>
      </section>

      <section className={styles.kpis}>
        <Kpi label="Net Asset Value" value={loading ? "…" : money(book.nav)} sub={`${holdings.length} live positions`} />
        <Kpi label="Unrealized P/L" value={loading ? "…" : money(book.pnl)} sub={pct(book.ret)} cls={book.pnl >= 0 ? styles.pos : styles.neg} />
        <Kpi label="Largest Position" value={loading ? "…" : `${book.topWeight.toFixed(1)}%`} sub={book.rows[0]?.ticker ?? "No exposure"} cls={book.topWeight > 25 ? styles.neg : undefined} />
        <Kpi label="Risk Posture" value={loading ? "…" : posture} sub="Portfolio policy engine" cls={postureClass} />
      </section>

      <section className={styles.content}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>Live Book · Capital Allocation</h3><span>Market value</span></div>
          {book.rows.length ? <div className={styles.rows}>{book.rows.slice(0,8).map(r => {
            const w = book.nav ? r.value / book.nav * 100 : 0;
            return <div className={styles.row} key={r.id}><div className={styles.ticker}>{r.ticker}</div><div className={styles.bar}><div className={styles.fill} style={{width:`${Math.min(100,w)}%`}}/></div><div className={styles.pct}>{w.toFixed(1)}%</div></div>;
          })}</div> : <div className={styles.empty}>{loading ? "Loading live portfolio…" : "No open positions. Build the book from Portfolio & Watchlist."}</div>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>Risk Control</h3><span>PM guardrails</span></div>
          <div className={styles.riskGrid}>
            <Risk label="Concentration" value={`${book.topWeight.toFixed(1)}%`} bad={book.topWeight > 25}/>
            <Risk label="HHI" value={book.hhi.toFixed(1)} bad={book.hhi > 25}/>
            <Risk label="Positions" value={String(holdings.length)} bad={holdings.length > 20}/>
            <Risk label="Book Return" value={pct(book.ret)} bad={book.ret < 0}/>
          </div>
        </div>
      </section>

      <section className={styles.content}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>Investment Process</h3><span>Decision architecture</span></div>
          <div className={styles.workflow}>
            <Step n="01" title="Discover" text="Momentum, growth, income and catalyst screens."/>
            <Step n="02" title="Underwrite" text="Fundamentals, valuation, thesis, risks and technical context."/>
            <Step n="03" title="Allocate" text="Conviction-weighted sizing inside sleeve and concentration policy."/>
            <Step n="04" title="Monitor" text="Drift, regime, thesis breaks, risk flags and rebalance actions."/>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>Mandate</h3><span>North star</span></div>
          <div className={styles.mandate}>
            <Mandate icon="α" title="Compound Alpha" text="Own durable growth with relative strength; avoid paying any price for momentum."/>
            <Mandate icon="↓" title="Protect Drawdown" text="Diversification, sizing and risk vetoes come before return maximization."/>
            <Mandate icon="$" title="Income Quality" text="Prefer sustainable distributions backed by cash generation, not yield alone."/>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({label,value,sub,cls}:{label:string;value:string;sub:string;cls?:string}){return <div className={styles.kpi}><div className={styles.kLabel}>{label}</div><div className={`${styles.kValue} ${cls ?? ""}`}>{value}</div><div className={styles.kSub}>{sub}</div></div>}
function Risk({label,value,bad}:{label:string;value:string;bad:boolean}){return <div className={styles.risk}><span>{label}</span><strong className={bad?styles.neg:styles.pos}>{value}</strong></div>}
function Step({n,title,text}:{n:string;title:string;text:string}){return <div className={styles.step}><div className={styles.stepNo}>{n}</div><b>{title}</b><p>{text}</p></div>}
function Mandate({icon,title,text}:{icon:string;title:string;text:string}){return <div className={styles.mandateItem}><div className={styles.icon}>{icon}</div><div><b>{title}</b><p>{text}</p></div></div>}
