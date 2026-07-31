"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortfolioIntelligence from "./PortfolioIntelligence";
import styles from "./FundCommandCenter.module.css";

type Lang = "en" | "th";
type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type Quote = { price?: number; changePercent?: number } | null;
type Analytics = { performance?: any; dividends?: any } | null;
type Props = { onNavigate: (tab: string) => void; lang: Lang };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const val = (n: number | null | undefined, suffix = "") => n == null ? "—" : `${n.toFixed(2)}${suffix}`;
const tx = (lang: Lang, en: string, th: string) => lang === "th" ? th : en;

export default function FundCommandCenter({ onNavigate, lang }: Props) {
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
  const postureLabel = posture === "POLICY NORMAL" ? tx(lang, "POLICY NORMAL", "ปกติตามนโยบาย") : posture === "DEFENSIVE REVIEW" ? tx(lang, "DEFENSIVE REVIEW", "ทบทวนเชิงป้องกัน") : tx(lang, "RISK REVIEW", "ทบทวนความเสี่ยง");
  const postureClass = posture === "POLICY NORMAL" ? styles.pos : styles.neg;

  const actions = useMemo(() => {
    const out: { level: "info" | "high" | "medium" | "ok"; en: string; th: string }[] = [];
    if (!holdings.length) out.push({ level: "info", en: "Build the initial portfolio and define target sleeves before deploying capital.", th: "สร้างพอร์ตเริ่มต้นและกำหนดสัดส่วนเป้าหมายของแต่ละกลุ่มก่อนนำเงินลงทุนจริง" });
    if (book.topWeight > 25) out.push({ level: "high", en: `Reduce or explicitly approve concentration: ${book.rows[0]?.ticker} is ${book.topWeight.toFixed(1)}% of NAV.`, th: `ควรลดหรืออนุมัติความกระจุกตัวอย่างชัดเจน: ${book.rows[0]?.ticker} มีน้ำหนัก ${book.topWeight.toFixed(1)}% ของ NAV` });
    if (book.hhi > 25) out.push({ level: "high", en: `Diversification risk is elevated (HHI ${book.hhi.toFixed(1)}). Review correlated exposures and sleeve caps.`, th: `ความเสี่ยงจากการกระจายตัวสูงขึ้น (HHI ${book.hhi.toFixed(1)}) ควรตรวจสอบสินทรัพย์ที่มีความสัมพันธ์สูงและเพดานน้ำหนักแต่ละกลุ่ม` });
    if ((perf?.maxDrawdownPct ?? 0) < -15) out.push({ level: "high", en: `1Y diagnostic drawdown reached ${val(perf.maxDrawdownPct, "%")}. Re-underwrite risk budget and thesis breaks.`, th: `Drawdown ในช่วงวิเคราะห์ 1 ปีแตะ ${val(perf.maxDrawdownPct, "%")} ควรทบทวนงบความเสี่ยงและเงื่อนไขที่ทำให้ thesis ใช้ไม่ได้` });
    if ((perf?.activeReturnPct ?? 0) < -5) out.push({ level: "medium", en: `Portfolio trails SPY by ${Math.abs(perf.activeReturnPct).toFixed(1)}% over the diagnostic window. Review opportunity cost.`, th: `พอร์ตทำผลงานต่ำกว่า SPY ${Math.abs(perf.activeReturnPct).toFixed(1)}% ในช่วงวิเคราะห์ ควรทบทวนต้นทุนค่าเสียโอกาส` });
    if ((perf?.sharpe ?? 0) < 0 && holdings.length) out.push({ level: "medium", en: "Risk-adjusted return is negative. Avoid increasing gross exposure until the source of weakness is understood.", th: "ผลตอบแทนหลังปรับความเสี่ยงเป็นลบ ยังไม่ควรเพิ่มความเสี่ยงรวมจนกว่าจะทราบสาเหตุของความอ่อนแอ" });
    if (div?.portfolioYieldNet != null && div.portfolioYieldNet < 5) out.push({ level: "info", en: `Net portfolio yield is ${div.portfolioYieldNet.toFixed(2)}%, below the 5% income reference level.`, th: `อัตราปันผลสุทธิของพอร์ตอยู่ที่ ${div.portfolioYieldNet.toFixed(2)}% ต่ำกว่าระดับอ้างอิงรายได้ 5%` });
    if (!out.length) out.push({ level: "ok", en: "No critical CIO exceptions detected. Continue monitoring thesis, valuation and regime drift.", th: "ไม่พบข้อยกเว้นสำคัญจาก CIO ให้ติดตาม thesis, valuation และการเปลี่ยน regime ต่อไป" });
    return out;
  }, [holdings.length, book, perf, div]);

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <div className={styles.eyebrow}>{tx(lang, "Sentinel Capital · CIO Command", "Sentinel Capital · ศูนย์บัญชาการ CIO")}</div>
            <h2 className={styles.title}>{tx(lang, "Fund Management OS", "ระบบปฏิบัติการบริหารกองทุน")}</h2>
            <div className={styles.lead}>{tx(lang,
              "Institutional decision architecture for research, portfolio construction, risk control, income and alpha discovery. Research earns conviction; portfolio policy earns sizing; risk retains veto power.",
              "สถาปัตยกรรมการตัดสินใจระดับสถาบันสำหรับการวิจัย การจัดพอร์ต การควบคุมความเสี่ยง รายได้ และการค้นหา Alpha งานวิจัยสร้างความเชื่อมั่น นโยบายพอร์ตกำหนดขนาดการลงทุน และฝ่ายความเสี่ยงมีสิทธิ์ยับยั้งเสมอ"
            )}</div>
          </div>
          <div className={styles.status}><span className={styles.dot}/> {tx(lang, "SYSTEM ONLINE", "ระบบพร้อมใช้งาน")}</div>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.action} ${styles.primary}`} onClick={() => onNavigate("analyze")}>{tx(lang, "Research Security", "วิเคราะห์หลักทรัพย์")}</button>
          <button className={styles.action} onClick={() => onNavigate("portfolio")}>{tx(lang, "Review Portfolio", "ทบทวนพอร์ต")}</button>
          <button className={styles.action} onClick={() => onNavigate("scanner")}>{tx(lang, "Find Alpha", "ค้นหา Alpha")}</button>
          <button className={styles.action} onClick={load}>{tx(lang, "Refresh CIO Book", "รีเฟรชข้อมูล CIO")}</button>
        </div>
      </section>

      <section className={styles.kpis}>
        <Kpi label={tx(lang,"Net Asset Value","มูลค่าทรัพย์สินสุทธิ")} value={loading ? "…" : money(book.nav)} sub={tx(lang, `${holdings.length} live positions`, `${holdings.length} สถานะที่ถืออยู่`)} />
        <Kpi label={tx(lang,"Unrealized P/L","กำไร/ขาดทุนที่ยังไม่ปิด")} value={loading ? "…" : money(book.pnl)} sub={pct(book.ret)} cls={book.pnl >= 0 ? styles.pos : styles.neg} />
        <Kpi label={tx(lang,"Active Return · 1Y","ผลตอบแทนส่วนเกิน · 1 ปี")} value={loading ? "…" : perf?.activeReturnPct == null ? "—" : pct(perf.activeReturnPct)} sub={perf?.benchmarkChangePct == null ? tx(lang,"SPY benchmark unavailable","ไม่มีข้อมูล SPY") : `SPY ${pct(perf.benchmarkChangePct)}`} cls={(perf?.activeReturnPct ?? 0) >= 0 ? styles.pos : styles.neg} />
        <Kpi label={tx(lang,"Risk Posture","สถานะความเสี่ยง")} value={loading ? "…" : postureLabel} sub={tx(lang,"CIO policy engine","ระบบนโยบาย CIO")} cls={postureClass} />
      </section>

      <section className={styles.cioGrid}>
        <CioMetric label={tx(lang,"Sharpe","Sharpe")} value={val(perf?.sharpe)} sub={tx(lang,"annualized diagnostic","วิเคราะห์แบบ annualized")} good={(perf?.sharpe ?? 0) >= 1}/>
        <CioMetric label={tx(lang,"Sortino","Sortino")} value={val(perf?.sortino)} sub={tx(lang,"downside-adjusted","ปรับด้วย downside risk")} good={(perf?.sortino ?? 0) >= 1}/>
        <CioMetric label={tx(lang,"Beta vs SPY","Beta เทียบ SPY")} value={val(perf?.beta)} sub={tx(lang,"systematic sensitivity","ความไวต่อความเสี่ยงตลาด")} good={(perf?.beta ?? 1) <= 1.1}/>
        <CioMetric label={tx(lang,"Alpha · ann.","Alpha · ต่อปี")} value={perf?.alphaAnnualizedPct == null ? "—" : pct(perf.alphaAnnualizedPct)} sub={tx(lang,"diagnostic estimate","ค่าประมาณเชิงวิเคราะห์")} good={(perf?.alphaAnnualizedPct ?? 0) >= 0}/>
        <CioMetric label={tx(lang,"Volatility · ann.","ความผันผวน · ต่อปี")} value={perf?.annualizedVolatilityPct == null ? "—" : `${perf.annualizedVolatilityPct.toFixed(1)}%`} sub={tx(lang,"daily series × √252","ข้อมูลรายวัน × √252")} good={(perf?.annualizedVolatilityPct ?? 0) <= 25}/>
        <CioMetric label={tx(lang,"Max Drawdown","Drawdown สูงสุด")} value={perf?.maxDrawdownPct == null ? "—" : `${perf.maxDrawdownPct.toFixed(1)}%`} sub={tx(lang,"1Y diagnostic","วิเคราะห์ย้อนหลัง 1 ปี")} good={(perf?.maxDrawdownPct ?? 0) >= -15}/>
        <CioMetric label={tx(lang,"Positive Days","วันที่บวก")} value={perf?.positiveDayPct == null ? "—" : `${perf.positiveDayPct.toFixed(1)}%`} sub={tx(lang,"hit-rate of daily returns","สัดส่วนวันที่ผลตอบแทนเป็นบวก")} good={(perf?.positiveDayPct ?? 0) >= 50}/>
        <CioMetric label={tx(lang,"Net Yield","อัตราปันผลสุทธิ")} value={div?.portfolioYieldNet == null ? "—" : `${div.portfolioYieldNet.toFixed(2)}%`} sub={div?.estAnnualIncomeNet != null ? tx(lang, `${money(div.estAnnualIncomeNet)} forward net income`, `รายได้สุทธิคาดการณ์ ${money(div.estAnnualIncomeNet)}`) : tx(lang,"income model unavailable","ไม่มีโมเดลรายได้")} good={(div?.portfolioYieldNet ?? 0) >= 5}/>
      </section>

      <PortfolioIntelligence holdings={holdings} quotes={quotes} lang={lang} />

      <section className={styles.content}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"Live Book · Capital Allocation","พอร์ตปัจจุบัน · การจัดสรรเงินทุน")}</h3><span>{tx(lang,"Market value","มูลค่าตลาด")}</span></div>
          {book.rows.length ? <div className={styles.rows}>{book.rows.slice(0,8).map(r => {
            const w = book.nav ? r.value / book.nav * 100 : 0;
            return <div className={styles.row} key={r.id}><div className={styles.ticker}>{r.ticker}</div><div className={styles.bar}><div className={styles.fill} style={{width:`${Math.min(100,w)}%`}}/></div><div className={styles.pct}>{w.toFixed(1)}%</div></div>;
          })}</div> : <div className={styles.empty}>{loading ? tx(lang,"Loading live portfolio…","กำลังโหลดพอร์ต…") : tx(lang,"No open positions. Build the book from Portfolio & Watchlist.","ยังไม่มีสถานะเปิด สามารถสร้างพอร์ตได้จากหน้า Portfolio & Watchlist")}</div>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"Risk Budget","งบความเสี่ยง")}</h3><span>{tx(lang,"PM guardrails","กรอบควบคุม PM")}</span></div>
          <div className={styles.riskGrid}>
            <Risk label={tx(lang,"Concentration","การกระจุกตัว")} value={`${book.topWeight.toFixed(1)}%`} bad={book.topWeight > 25}/>
            <Risk label="HHI" value={book.hhi.toFixed(1)} bad={book.hhi > 25}/>
            <Risk label={tx(lang,"Positions","จำนวนสถานะ")} value={String(holdings.length)} bad={holdings.length > 20}/>
            <Risk label={tx(lang,"Book Return","ผลตอบแทนพอร์ต")} value={pct(book.ret)} bad={book.ret < 0}/>
          </div>
        </div>
      </section>

      <section className={styles.content}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"CIO Action Queue","รายการดำเนินการของ CIO")}</h3><span>{tx(lang, `${actions.length} review item${actions.length === 1 ? "" : "s"}`, `${actions.length} รายการที่ต้องทบทวน`)}</span></div>
          <div className={styles.queue}>{actions.map((a, i) => <div className={`${styles.queueItem} ${a.level === "high" ? styles.high : a.level === "medium" ? styles.medium : a.level === "ok" ? styles.ok : styles.info}`} key={i}><span className={styles.queueDot}/><div>{tx(lang,a.en,a.th)}</div></div>)}</div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"Income Engine","ระบบรายได้")}</h3><span>{tx(lang,"forward net","คาดการณ์สุทธิ")}</span></div>
          <div className={styles.incomeHero}>{div?.estAnnualIncomeNet == null ? "—" : money(div.estAnnualIncomeNet)}</div>
          <div className={styles.incomeSub}>{tx(lang, `Estimated annual income after ${div?.withholdingPct ?? 15}% withholding`, `รายได้ต่อปีโดยประมาณหลังหักภาษี ณ ที่จ่าย ${div?.withholdingPct ?? 15}%`)}</div>
          <div className={styles.riskGrid} style={{marginTop:12}}>
            <Risk label={tx(lang,"Monthly Avg","เฉลี่ยต่อเดือน")} value={div?.estMonthlyAverageNet == null ? "—" : money(div.estMonthlyAverageNet)} bad={false}/>
            <Risk label={tx(lang,"Trailing 12M","ย้อนหลัง 12 เดือน")} value={div?.trailingIncome12mNet == null ? "—" : money(div.trailingIncome12mNet)} bad={false}/>
          </div>
        </div>
      </section>

      <section className={styles.content}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"Investment Process","กระบวนการลงทุน")}</h3><span>{tx(lang,"Decision architecture","สถาปัตยกรรมการตัดสินใจ")}</span></div>
          <div className={styles.workflow}>
            <Step n="01" title={tx(lang,"Discover","ค้นหา")} text={tx(lang,"Momentum, growth, income and catalyst screens.","คัดกรองโมเมนตัม การเติบโต รายได้ และ catalyst")}/>
            <Step n="02" title={tx(lang,"Underwrite","วิเคราะห์เชิงลึก")} text={tx(lang,"Fundamentals, valuation, thesis, risks and technical context.","พื้นฐาน มูลค่า thesis ความเสี่ยง และบริบททางเทคนิค")}/>
            <Step n="03" title={tx(lang,"Allocate","จัดสรร")} text={tx(lang,"Conviction-weighted sizing inside sleeve and concentration policy.","กำหนดขนาดตาม conviction ภายใต้กรอบกลุ่มและการกระจุกตัว")}/>
            <Step n="04" title={tx(lang,"Monitor","ติดตาม")} text={tx(lang,"Drift, regime, thesis breaks, risk flags and rebalance actions.","ติดตาม drift, regime, thesis break, สัญญาณเสี่ยง และการรีบาลานซ์")}/>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><h3>{tx(lang,"Mandate","พันธกิจการลงทุน")}</h3><span>{tx(lang,"North star","หลักยึด")}</span></div>
          <div className={styles.mandate}>
            <Mandate icon="α" title={tx(lang,"Compound Alpha","สร้าง Alpha แบบทบต้น")} text={tx(lang,"Own durable growth with relative strength; avoid paying any price for momentum.","ถือสินทรัพย์ที่เติบโตยั่งยืนและแข็งแกร่งกว่าตลาด โดยไม่ไล่ซื้อโมเมนตัมทุกระดับราคา")}/>
            <Mandate icon="↓" title={tx(lang,"Protect Drawdown","ควบคุม Drawdown")} text={tx(lang,"Diversification, sizing and risk vetoes come before return maximization.","การกระจายความเสี่ยง ขนาดสถานะ และสิทธิ์ยับยั้งของฝ่ายความเสี่ยงมาก่อนการเร่งผลตอบแทน")}/>
            <Mandate icon="$" title={tx(lang,"Income Quality","คุณภาพรายได้")} text={tx(lang,"Prefer sustainable distributions backed by cash generation, not yield alone.","ให้ความสำคัญกับเงินปันผลที่ยั่งยืนและรองรับด้วยกระแสเงินสด ไม่ดูเพียง yield สูง")}/>
          </div>
        </div>
      </section>
      {perf?.note && <div className={styles.disclaimer}>{lang === "th" ? "หมายเหตุ: ผลย้อนหลังเป็นการจำลองจากจำนวนหุ้นที่ถือปัจจุบันย้อนหลังไปในอดีต เนื่องจากระบบยังไม่ได้เก็บ transaction ledger แบบเต็ม จึงไม่ใช่ time-weighted return" : perf.note}</div>}
    </div>
  );
}

function Kpi({label,value,sub,cls}:{label:string;value:string;sub:string;cls?:string}){return <div className={styles.kpi}><div className={styles.kLabel}>{label}</div><div className={`${styles.kValue} ${cls ?? ""}`}>{value}</div><div className={styles.kSub}>{sub}</div></div>}
function CioMetric({label,value,sub,good}:{label:string;value:string;sub:string;good:boolean}){return <div className={styles.cioMetric}><span>{label}</span><strong className={good?styles.pos:styles.neutral}>{value}</strong><small>{sub}</small></div>}
function Risk({label,value,bad}:{label:string;value:string;bad:boolean}){return <div className={styles.risk}><span>{label}</span><strong className={bad?styles.neg:styles.pos}>{value}</strong></div>}
function Step({n,title,text}:{n:string;title:string;text:string}){return <div className={styles.step}><div className={styles.stepNo}>{n}</div><b>{title}</b><p>{text}</p></div>}
function Mandate({icon,title,text}:{icon:string;title:string;text:string}){return <div className={styles.mandateItem}><div className={styles.icon}>{icon}</div><div><b>{title}</b><p>{text}</p></div></div>}
