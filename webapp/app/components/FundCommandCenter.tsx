"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./FundCommandCenter.module.css";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type Quote = { price?: number; changePercent?: number } | null;
type Analytics = { performance?: any; dividends?: any } | null;
type Props = { onNavigate: (tab: string) => void };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const val = (n: number | null | undefined, suffix = "") => n == null ? "—" : `${n.toFixed(2)}${suffix}`;

export default function FundCommandCenter({ onNavigate }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [analytics, setAnalytics] = useState<Analytics>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetch("/api/portfolio").then(r => r.json());
      const open: Holding[] = (p.holdings ?? []).filter((h: Holding) => !h.closed_at);
      setHoldings(open);
      const tickers = Array.from(new Set(open.map(h => h.ticker)));
      const [q, a] = await Promise.all([
        tickers.length ? fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`).then(r => r.json()) : Promise.resolve({ quotes: {} }),
        open.length ? fetch("/api/portfolio/analytics?days=365").then(r => r.json()).catch(() => null) : Promise.resolve(null),
      ]);
      setQuotes(q?.quotes ?? {});
      setAnalytics(a);
    } catch {
      setHoldings([]);
      setQuotes({});
      setAnalytics(null);
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

  const perf = analytics?.performance;
  const div = analytics?.dividends;
  const posture = book.topWeight > 25 || (perf?.maxDrawdownPct ?? 0) < -15 ? "RISK REVIEW" : book.ret < -8 ? "DEFENSIVE REVIEW" : "POLICY NORMAL";
  const postureClass = posture === "POLICY NORMAL" ? styles.pos : styles.neg;

  const actions = useMemo(() => {
    const out: { level: string; text: string }[] = [];
    if (!holdings.length) out.push({ level: "info", text: "Build the initial portfolio and define target sleeves before deploying capital." });
    if (book.topWeight > 25) out.push({ level: "high", text: `Reduce or explicitly approve concentration: ${book.rows[0]?.ticker} is ${book.topWeight.toFixed(1)}% of NAV.` });
    if (book.hhi > 25) out.push({ level: "high", text: `Diversification risk is elevated (HHI ${book.hhi.toFixed(1)}). Review correlated exposures and sleeve caps.` });
    if ((perf?.maxDrawdownPct ?? 0) < -15) out.push({ level: "high", text: `1Y diagnostic drawdown reached ${val(perf.maxDrawdownPct, "%")}. Re-underwrite risk budget and thesis breaks.` });
    if ((perf?.activeReturnPct ?? 0) < -5) out.push({ level: "medium", text: `Portfolio trails SPY by ${Math.abs(perf.activeReturnPct).toFixed(1)}% over the diagnostic window. Review opportunity cost.` });
    if ((perf?.sharpe ?? 0) < 0 && holdings.length) out.push({ level: "medium", text: "Risk-adjusted return is negative. Avoid increasing gross exposure until the source of weakness is understood." });
    if (div?.portfolioYieldNet != null && div.portfolioYieldNet < 5) out.push({ level: "info", text: `Net portfolio yield is ${div.portfolioYieldNet.toFixed(2)}%, below the 5% income reference level.` });
    if (!out.length) out.push({ level: "ok", text: "No critical CIO exceptions detected. Continue monitoring thesis, valuation and regime drift." });
    return out;
  }, [holdings.length, book, perf, div]);

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <div className={styles.eyebrow}>Sentinel Capital · CIO Command</div>
            <h2 className={styles.title}>Fund Management OS</h2>
            <div className={styles.lead}>Institutional decision architecture for research, portfolio construction, risk control, income and alpha discovery. Research earns conviction; portfolio policy earns sizing; risk retains veto power.</div>
          </div>
          <div className={styles.status}><span className={styles.dot}/> SYSTEM ONLINE</div>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.action} ${styles.primary}`} onClick={() => onNavigate("analyze")}>Research Security</button>
          <button className={styles.action} onClick={() => onNavigate("portfolio")}>Review Portfolio</button>
          <button className={styles.action} onClick={() => onNavigate("scanner")}>Find Alpha</button>
          <button className={styles.action} onClick={load}>Refresh CIO Book</button>
        </div>
      </section>

      <section className={styles.kpis}>
        <Kpi label="Net Asset Value" value={loading ? "…" : money(book.nav)} sub={`${holdings.length} live positions`} />
        <Kpi label="Unrealized P/L" value={loading ? "…" : money(book.pnl)} sub={pct(book.ret)} cls={book.pnl >= 0 ? styles.pos : styles.neg} />
        <Kpi label="Active Return · 1Y" value={loading ? "…" : perf?.activeReturnPct == null ? "—" : pct(perf.activeReturnPct)} sub={perf?.benchmarkChangePct == null ? "SPY benchmark unavailable" : `SPY ${pct(perf.benchmarkChangePct)}`} cls={(perf?.activeReturnPct ?? 0) >= 0 ? styles.pos : styles.neg} />
        <Kpi label="Risk Posture" value={loading ? "…" : posture} sub="CIO policy engine" cls={postureClass} />
      </section>

      <section className={styles.cioGrid}>
        <CioMetric label="Sharpe" value={val(perf?.sharpe)} sub="annualized diagnostic" good={(perf?.sharpe ?? 0) >= 1}/>
        <CioMetric label="Sortino" value={val(perf?.sortino)} sub="downside-adjusted" good={(perf?.sortino ?? 0) >= 1}/>
        <CioMetric label="Beta vs SPY" value={val(perf?.beta)} sub="systematic sensitivity" good={(perf?.beta ?? 1) <= 1.1}/>
        <CioMetric label="Alpha · ann." value={perf?.alphaAnnualizedPct == null ? "—" : pct(perf.alphaAnnualizedPct)} sub="diagnostic estimate" good={(perf?.alphaAnnualizedPct ?? 0) >= 0}/>
        <CioMetric label="Volatility · ann." value={perf?.annualizedVolatilityPct == null ? "—" : `${perf.annualizedVolatilityPct.toFixed(1)}%`} sub="daily series × √252" good={(perf?.annualizedVolatilityPct ?? 0) <= 25}/>
        <CioMetric label="Max Drawdown" value={perf?.maxDrawdownPct == null ? "—" : `${perf.maxDrawdownPct.toFixed(1)}%`} sub="1Y diagnostic" good={(perf?.maxDrawdownPct ?? 0) >= -15}/>
        <CioMetric label="Positive Days" value={perf?.positiveDayPct == null ? "—" : `${perf.positiveDayPct.toFixed(1)}%`} sub="hit-rate of daily returns" good={(perf?.positiveDayPct ?? 0) >= 50}/>
        <CioMetric label="Net Yield" value={div?.portfolioYieldNet == null ? "—" : `${div.portfolioYieldNet.toFixed(2)}%`} sub={div?.estAnnualIncomeNet != null ? `${money(div.estAnnualIncomeNet)} forward net income` : "income model unavailable"} good={(div?.portfolioYieldNet ?? 0) >= 5}/>
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
          <div className={styles.panelTitle}><h3>Risk Budget</h3><span>PM guardrails</span></div>
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
          <div className={styles.panelTitle}><h3>CIO Action Queue</h3><span>{actions.length} review item{actions.length === 1 ? "" : "s"}</span></div>
          <div className={styles.queue}>{actions.map((a, i) => <div className={`${styles.queueItem} ${styles[a.level] ?? ""}`} key={i}><span className={styles.queueDot}/><div>{a.text}</div></div>)}</div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>Income Engine</h3><span>forward net</span></div>
          <div className={styles.incomeHero}>{div?.estAnnualIncomeNet == null ? "—" : money(div.estAnnualIncomeNet)}</div>
          <div className={styles.incomeSub}>Estimated annual income after {div?.withholdingPct ?? 15}% withholding</div>
          <div className={styles.riskGrid} style={{marginTop:12}}>
            <Risk label="Monthly Avg" value={div?.estMonthlyAverageNet == null ? "—" : money(div.estMonthlyAverageNet)} bad={false}/>
            <Risk label="Trailing 12M" value={div?.trailingIncome12mNet == null ? "—" : money(div.trailingIncome12mNet)} bad={false}/>
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
      {perf?.note && <div className={styles.disclaimer}>{perf.note}</div>}
    </div>
  );
}

function Kpi({label,value,sub,cls}:{label:string;value:string;sub:string;cls?:string}){return <div className={styles.kpi}><div className={styles.kLabel}>{label}</div><div className={`${styles.kValue} ${cls ?? ""}`}>{value}</div><div className={styles.kSub}>{sub}</div></div>}
function CioMetric({label,value,sub,good}:{label:string;value:string;sub:string;good:boolean}){return <div className={styles.cioMetric}><span>{label}</span><strong className={good?styles.pos:styles.neutral}>{value}</strong><small>{sub}</small></div>}
function Risk({label,value,bad}:{label:string;value:string;bad:boolean}){return <div className={styles.risk}><span>{label}</span><strong className={bad?styles.neg:styles.pos}>{value}</strong></div>}
function Step({n,title,text}:{n:string;title:string;text:string}){return <div className={styles.step}><div className={styles.stepNo}>{n}</div><b>{title}</b><p>{text}</p></div>}
function Mandate({icon,title,text}:{icon:string;title:string;text:string}){return <div className={styles.mandateItem}><div className={styles.icon}>{icon}</div><div><b>{title}</b><p>{text}</p></div></div>}
