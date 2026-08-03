"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";

type Action = "OPEN NEW" | "ADD EXISTING" | "TRIM" | "EXIT";
type CandidateStatus = "APPROVED" | "DEFERRED" | "REJECTED";

type MeetingItem = {
  ticker: string;
  action: Action;
  amount: number;
  reason: string;
  approved: boolean;
  status: CandidateStatus;
  votes: string[];
  upside: number | null;
  conviction: number | null;
  target: number | null;
  price: number | null;
  risks: string[];
  monitoring: string[];
  rank: number;
};

type HoldingReview = {
  ticker: string;
  weight: number;
  marketValue: number;
  pnlPct: number | null;
  portfolio: string;
  valuation: string;
  risk: string;
  liquidity: string;
  decision: string;
  reason: string;
};

type Driver = { label: string; score: number; view: string };
type TranscriptRow = { desk: string; text: string };

type MeetingState = {
  holdings: any[];
  holdingReviews: HoldingReview[];
  macroScore: number;
  macroLabel: string;
  posture: string;
  cashTarget: number;
  macroDrivers: Driver[];
  transcript: TranscriptRow[];
  portfolioItems: MeetingItem[];
  strategyItems: MeetingItem[];
  approved: MeetingItem[];
  reserve: number;
  marketValue: number;
  health: number;
  quality: number;
  diversification: number;
  liquidity: number;
  riskScore: number;
  opportunity: number;
  consensus: number;
  concentration: number;
};

const desks = ["CIO", "MACRO", "RESEARCH", "RISK", "QUANT", "PORTFOLIO", "TREASURY"] as const;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function usd(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

async function getJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const raw = await response.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
  if (!response.ok) throw new Error(json?.error ?? `${path} returned ${response.status}`);
  return json;
}

function deskVotes(action: Action, approved: boolean, riskOff: boolean): string[] {
  return desks.map((desk) => {
    if (!approved) return `${desk}: ${desk === "TREASURY" ? "KEEP CASH" : "HOLD / DEFER"}`;
    if (desk === "RISK") return `${desk}: ${riskOff ? "REDUCE / LIMIT" : "SIZE CONTROL"}`;
    if (desk === "TREASURY") return `${desk}: ${action === "TRIM" || action === "EXIT" ? "RELEASE CAPITAL" : "FUND IF SELECTED"}`;
    if (desk === "RESEARCH") return `${desk}: ${action === "TRIM" || action === "EXIT" ? "THESIS REVIEW" : "BUY"}`;
    if (desk === "PORTFOLIO") return `${desk}: ${action === "TRIM" || action === "EXIT" ? "REBALANCE" : "PORTFOLIO FIT"}`;
    return `${desk}: SUPPORT`;
  });
}

export default function EndToEndInvestmentCommittee({ lang }: { lang: AppLang }) {
  const [data, setData] = useState<any>(null);
  const [cycle, setCycle] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [execution, setExecution] = useState<any>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setExecution(null);

    Promise.allSettled([
      getJson("/api/macro/intelligence"),
      getJson("/api/v10/cio"),
      getJson("/api/portfolio"),
      getJson("/api/portfolio/optimizer"),
      getJson("/api/portfolio/opportunity-allocation"),
      getJson("/api/portfolio/cash-buffer"),
    ])
      .then((results) => {
        if (!active) return;
        const values = results.map((result) => (result.status === "fulfilled" ? result.value : {}));
        setData({
          macro: values[0],
          cio: values[1],
          portfolio: values[2],
          optimizer: values[3],
          allocation: values[4],
          buffer: values[5],
        });
        const failed = results.filter((result) => result.status === "rejected").length;
        setError(failed ? `${failed} meeting source(s) unavailable; unresolved evidence was excluded.` : null);
        setSelected({});
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cycle]);

  const meeting = useMemo<MeetingState>(() => {
    const holdings = (Array.isArray(data?.portfolio?.holdings) ? data.portfolio.holdings : []).filter(
      (holding: any) => !holding?.closed_at,
    );
    const macroScore = finite(data?.macro?.regime?.score) ?? 50;
    const macroLabel = String(
      data?.macro?.regime?.classification ?? data?.macro?.regime?.label ?? "NEUTRAL",
    ).toUpperCase();
    const riskOff = macroScore < 40 || /BEAR|RISK.OFF|DEFENSIVE/.test(macroLabel);
    const riskOn = macroScore >= 65 || /BULL|RISK.ON|EXPANSION/.test(macroLabel);
    const posture = riskOff
      ? "REDUCE RISK / RAISE CASH"
      : riskOn
        ? "ADVANCE SELECTIVELY"
        : "BALANCED / SELECTIVE";
    const cashTarget = riskOff ? 15 : riskOn ? 5 : 10;

    const macroDrivers: Driver[] = [
      { label: "Trend", score: clamp(Math.round(macroScore * 0.95)), view: macroScore >= 55 ? "supportive" : "soft" },
      { label: "Liquidity", score: clamp(Math.round(macroScore * 0.88)), view: macroScore >= 50 ? "adequate" : "tight" },
      { label: "Breadth", score: clamp(Math.round(macroScore * 0.82)), view: macroScore >= 60 ? "broad" : "narrow" },
      { label: "Volatility", score: clamp(Math.round(100 - (100 - macroScore) * 0.72)), view: riskOff ? "elevated" : "contained" },
      { label: "Valuation", score: clamp(Math.round(42 + macroScore * 0.42)), view: riskOn ? "acceptable" : "selective" },
      { label: "Sentiment", score: clamp(Math.round(50 + (macroScore - 50) * 0.65)), view: macroScore > 70 ? "crowded" : macroScore < 35 ? "fearful" : "neutral" },
    ];

    const transcript: TranscriptRow[] = [
      { desk: "CIO", text: riskOff ? "Protect capital first; raise cash and remove broken theses." : riskOn ? "Advance only into high-conviction ideas with defined risk." : "Maintain a balanced book and approve only asymmetric opportunities." },
      { desk: "MACRO", text: `Regime is ${macroLabel}; liquidity and breadth justify a ${posture.toLowerCase()} stance.` },
      { desk: "RESEARCH", text: "Present a ranked shortlist, not a single stock. Approved, deferred and rejected ideas remain visible." },
      { desk: "RISK", text: riskOff ? "Cut exposure and concentration before adding risk." : "Approve only with position-size controls and explicit invalidation levels." },
      { desk: "QUANT", text: "Rank by expected return, conviction, valuation and evidence quality." },
      { desk: "PORTFOLIO", text: "Every holding receives KEEP, WATCH, ADD, TRIM or EXIT opinion even when no trade is proposed." },
      { desk: "TREASURY", text: "SGOV remains reserve capital until a named destination is human-approved." },
    ];

    const marketValue = holdings.reduce((sum: number, holding: any) => {
      const shares = Math.max(0, finite(holding?.shares) ?? 0);
      const price = Math.max(0, finite(holding?.price ?? holding?.current_price ?? holding?.avg_cost) ?? 0);
      return sum + shares * price;
    }, 0);

    const holdingReviews: HoldingReview[] = holdings
      .map((holding: any): HoldingReview => {
        const ticker = String(holding?.ticker ?? "").trim().toUpperCase();
        const shares = Math.max(0, finite(holding?.shares) ?? 0);
        const price = Math.max(0, finite(holding?.price ?? holding?.current_price ?? holding?.avg_cost) ?? 0);
        const cost = finite(holding?.avg_cost);
        const holdingValue = shares * price;
        const weight = marketValue > 0 ? (holdingValue / marketValue) * 100 : 0;
        const pnlPct = cost !== null && cost > 0 ? (price / cost - 1) * 100 : null;
        const over = weight > 20;
        const weak = pnlPct !== null && pnlPct < -12;
        const strong = pnlPct !== null && pnlPct > 18;
        const decision = over ? "TRIM REVIEW" : weak ? "WATCH / THESIS REVIEW" : strong ? "KEEP WINNER" : "KEEP";
        return {
          ticker,
          weight,
          marketValue: holdingValue,
          pnlPct,
          portfolio: decision,
          valuation: pnlPct === null ? "DATA LIMITED" : pnlPct > 25 ? "PREMIUM / WATCH" : pnlPct < -10 ? "DISCOUNT / VERIFY THESIS" : "FAIR RANGE",
          risk: over ? "CONCENTRATION HIGH" : weak ? "DRAWDOWN WATCH" : "WITHIN POLICY",
          liquidity: shares > 0 && price > 0 ? "TRADEABLE" : "VERIFY PRICE",
          decision,
          reason: over
            ? "Weight exceeds the single-name review zone."
            : weak
              ? "Loss threshold requires thesis and catalyst review."
              : strong
                ? "Winner remains within policy; do not trim mechanically."
                : "No evidence currently justifies a portfolio change.",
        };
      })
      .sort((a: HoldingReview, b: HoldingReview) => b.weight - a.weight);

    const optimizer = Array.isArray(data?.optimizer?.proposals) ? data.optimizer.proposals : [];
    const portfolioItems: MeetingItem[] = optimizer.flatMap((proposal: any, index: number): MeetingItem[] => {
      const ticker = String(proposal?.ticker ?? "").trim().toUpperCase();
      const rawAction = String(proposal?.action ?? "").toUpperCase();
      if (!ticker || ticker === "LIQUIDITY") return [];

      let action: Action | null = null;
      if (/TRIM|REDUCE/.test(rawAction)) action = "TRIM";
      else if (/EXIT|SELL/.test(rawAction)) action = "EXIT";
      else if (/ADD|BUY/.test(rawAction)) action = "ADD EXISTING";
      if (action === null) return [];

      const amount = Math.max(0, finite(proposal?.capitalUsd ?? proposal?.amountUsd) ?? 0);
      const approved = action === "TRIM" || action === "EXIT"
        ? riskOff || finite(proposal?.score) !== null
        : riskOn || macroScore >= 45;
      const status: CandidateStatus = approved ? "APPROVED" : "DEFERRED";

      return [{
        ticker,
        action,
        amount,
        reason: String(proposal?.reason ?? "Portfolio review recommendation."),
        approved,
        status,
        votes: deskVotes(action, approved, riskOff),
        upside: finite(proposal?.expectedReturnPct),
        conviction: finite(proposal?.score),
        target: finite(proposal?.targetPrice),
        price: finite(proposal?.price),
        risks: ["Position concentration", "Thesis deterioration", "Correlation shock"],
        monitoring: ["Weight drift", "Price trend", "Earnings revisions"],
        rank: index + 1,
      }];
    });

    const heldTickers = new Set<string>(
      holdings.map((holding: any) => String(holding?.ticker ?? "").trim().toUpperCase()),
    );
    const allocations: any[] = Array.isArray(data?.allocation?.allocations) ? data.allocation.allocations : [];
    const rejected: any[] = Array.isArray(data?.allocation?.rejected) ? data.allocation.rejected : [];
    const candidateMap = new Map<string, any>();

    allocations.forEach((candidate: any) => {
      const ticker = String(candidate?.ticker ?? "").trim().toUpperCase();
      if (ticker) candidateMap.set(ticker, { ...candidate, _source: "allocation" });
    });
    rejected.forEach((candidate: any) => {
      const ticker = String(candidate?.ticker ?? "").trim().toUpperCase();
      if (ticker && !candidateMap.has(ticker)) candidateMap.set(ticker, { ...candidate, _source: "rejected" });
    });

    const rawCandidates: any[] = Array.from(candidateMap.values())
      .filter((candidate: any) => Boolean(candidate?.ticker))
      .sort((a: any, b: any) => {
        const convictionDiff = (finite(b?.conviction) ?? 0) - (finite(a?.conviction) ?? 0);
        if (convictionDiff !== 0) return convictionDiff;
        return (finite(b?.expectedReturnPct) ?? -999) - (finite(a?.expectedReturnPct) ?? -999);
      })
      .slice(0, 8);

    const strategyItems: MeetingItem[] = rawCandidates.map((candidate: any, index: number): MeetingItem => {
      const ticker = String(candidate?.ticker ?? "").trim().toUpperCase();
      const amount = Math.max(0, finite(candidate?.approvedCapitalUsd) ?? 0);
      const action: Action = heldTickers.has(ticker) ? "ADD EXISTING" : "OPEN NEW";
      const upside = finite(candidate?.expectedReturnPct);
      const conviction = finite(candidate?.conviction);
      const target = finite(candidate?.targetPrice);
      const price = finite(candidate?.currentPrice ?? candidate?.price);
      const approved = candidate?._source === "allocation"
        && amount > 0
        && !riskOff
        && (upside === null || upside >= 8)
        && (conviction === null || conviction >= 60)
        && (target === null || price === null || target > price);
      const status: CandidateStatus = approved
        ? "APPROVED"
        : candidate?._source === "allocation"
          ? "DEFERRED"
          : "REJECTED";

      return {
        ticker,
        action,
        amount,
        reason: String(candidate?.thesis ?? candidate?.reason ?? "Candidate did not clear all allocation gates."),
        approved,
        status,
        votes: deskVotes(action, approved, riskOff),
        upside,
        conviction,
        target,
        price,
        risks: Array.isArray(candidate?.risks)
          ? candidate.risks.map(String)
          : ["Execution risk", "Valuation compression", "Catalyst delay"],
        monitoring: Array.isArray(candidate?.monitoring)
          ? candidate.monitoring.map(String)
          : ["Revenue growth", "Free cash flow", "Guidance and valuation"],
        rank: index + 1,
      };
    });

    const approved = [...portfolioItems, ...strategyItems].filter((item) => item.approved);
    const reserve = finite(data?.allocation?.portfolio?.deployableCapitalUsd ?? data?.buffer?.gapValue) ?? 0;
    const concentration = clamp(100 - Math.min(55, holdings.length < 8 ? 38 : 12));
    const diversification = clamp(45 + holdings.length * 2.2);
    const quality = clamp(Math.round(62 + macroScore * 0.18));
    const liquidity = clamp(Math.round(78 + Math.min(15, reserve / 100)));
    const riskScore = clamp(Math.round(100 - (100 - macroScore) * 0.58 - (holdings.length < 8 ? 12 : 0)));
    const health = clamp(Math.round(quality * 0.3 + diversification * 0.22 + liquidity * 0.18 + riskScore * 0.18 + macroScore * 0.12));
    const opportunity = clamp(Math.round(macroScore * 0.55 + (strategyItems.length ? 72 : 44) * 0.45));
    const consensus = approved.length
      ? clamp(Math.round(70 + approved.length * 5))
      : clamp(Math.round(48 + macroScore * 0.25));

    return {
      holdings,
      holdingReviews,
      macroScore,
      macroLabel,
      posture,
      cashTarget,
      macroDrivers,
      transcript,
      portfolioItems,
      strategyItems,
      approved,
      reserve,
      marketValue,
      health,
      quality,
      diversification,
      liquidity,
      riskScore,
      opportunity,
      consensus,
      concentration,
    };
  }, [data]);

  const key = (item: MeetingItem) => `${item.action}:${item.ticker}`;
  const selectedItems = meeting.approved.filter((item) => selected[key(item)]);
  const buys = selectedItems.filter((item) => item.action === "OPEN NEW" || item.action === "ADD EXISTING");
  const sells = selectedItems.filter((item) => item.action === "TRIM" || item.action === "EXIT");
  const buyTotal = buys.reduce((sum, item) => sum + item.amount, 0);
  const sellTotal = sells.reduce((sum, item) => sum + item.amount, 0);
  const reserveNeeded = Math.max(0, buyTotal - sellTotal);
  const reserveUsed = Math.min(meeting.reserve, reserveNeeded);
  const funding = buys.length
    ? `TRIM SGOV ${usd(reserveUsed)} → ${buys.map((item) => `${item.ticker} ${usd(item.amount)}`).join(" + ")}`
    : `KEEP ${usd(meeting.reserve)} IN SGOV — NO SALE AUTHORIZED`;
  const projectedCash = Math.max(0, meeting.reserve + sellTotal - buyTotal);
  const projectedHoldings = meeting.holdings.length
    + selectedItems.filter((item) => item.action === "OPEN NEW").length
    - selectedItems.filter((item) => item.action === "EXIT").length;

  const selectApproved = () => {
    setSelected(Object.fromEntries(meeting.approved.map((item) => [key(item), true])));
  };

  const toggle = (item: MeetingItem) => {
    setSelected((current) => ({ ...current, [key(item)]: !current[key(item)] }));
  };

  async function submit() {
    if (!selectedItems.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await getJson("/api/portfolio/rebalance-execution", {
        method: "POST",
        body: JSON.stringify({
          humanApproved:true,
          humanApprovedBy: "portfolio_owner",
          meetingCode: `IC-${new Date().toISOString().slice(0, 10)}`,
          reserveTicker: "SGOV",
          deployable: meeting.reserve,
          portfolioBefore: data?.portfolio ?? {},
          macro: {
            label: meeting.macroLabel,
            score: meeting.macroScore,
            posture: meeting.posture,
          },
          items: selectedItems,
        }),
      });
      setExecution(result);
    } catch (submitError: any) {
      setError(submitError?.message ?? "Execution package failed");
    } finally {
      setSubmitting(false);
    }
  }

  const agendaStyle = {
    border: "1px solid rgba(119,137,255,.28)",
    borderRadius: 18,
    padding: 18,
    marginTop: 14,
    background: "rgba(7,18,45,.52)",
  } as const;
  const summaryStyle = {
    cursor: "pointer",
    fontWeight: 900,
    fontSize: "1.02rem",
    letterSpacing: 0.3,
  } as const;

  return (
    <section className="card" style={{ borderTop: "2px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: 1.4 }}>
            INSTITUTIONAL AI FUND OPERATING SYSTEM · SINGLE MEETING STATE
          </div>
          <h2 className="section" style={{ margin: "6px 0" }}>
            {lang === "th" ? "กองทุนอัจฉริยะและคณะกรรมการลงทุน" : "INTELLIGENT FUND COMMITTEE"}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            One governed meeting: macro, every holding, ranked research shortlist, debate, funding and execution.
          </p>
        </div>
        <button className="btn" onClick={() => setCycle((value) => value + 1)} disabled={loading}>
          {loading ? "Running meeting…" : "Run Full Fund Meeting"}
        </button>
      </div>

      {error && <div className="notice" style={{ marginTop: 12 }}>⚠ {error}</div>}
      {execution && (
        <div className="notice" style={{ marginTop: 12, borderColor: "rgba(72,228,167,.45)" }}>
          ✓ Package {execution.package?.packageId} · {execution.package?.status}
        </div>
      )}

      <section style={{ ...agendaStyle, background: "linear-gradient(145deg,rgba(20,33,75,.78),rgba(7,18,45,.66))" }}>
        <div className="muted" style={{ fontSize: 11, letterSpacing: 1.2 }}>CIO EXECUTIVE VIEW</div>
        <h3 style={{ margin: "5px 0" }}>Fund intelligence dashboard</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 12, marginTop: 14 }}>
          <Gauge label="Fund health" value={meeting.health} note="Institutional composite" />
          <Gauge label="Market opportunity" value={meeting.opportunity} note="Selective opportunity" />
          <Gauge label="Portfolio quality" value={meeting.quality} note="Quality composite" />
          <Gauge label="Risk control" value={meeting.riskScore} note="Policy control" />
          <Gauge label="Committee consensus" value={meeting.consensus} note={`${meeting.approved.length} approved ideas`} />
        </div>
      </section>

      <details style={agendaStyle} open>
        <summary style={summaryStyle}>1 · MACRO, REGIME & SENTIMENT</summary>
        <div style={{ marginTop: 14 }}>
          <div className="grid cols-4">
            <Metric l="Regime" v={meeting.macroLabel} />
            <Metric l="Macro score" v={`${meeting.macroScore}/100`} />
            <Metric l="Fund posture" v={meeting.posture} />
            <Metric l="Target cash" v={`${meeting.cashTarget}%`} />
          </div>
          <DriverChart rows={meeting.macroDrivers} />
          <Transcript rows={meeting.transcript} />
        </div>
      </details>

      <details style={agendaStyle}>
        <summary style={summaryStyle}>2 · PORTFOLIO REVIEW & CAPITAL RELEASE</summary>
        <div style={{ marginTop: 14 }}>
          <div className="grid cols-4">
            <Metric l="Open holdings" v={String(meeting.holdings.length)} />
            <Metric l="Market value" v={usd(meeting.marketValue)} />
            <Metric l="Trade proposals" v={String(meeting.portfolioItems.length)} />
            <Metric l="Reserve" v={usd(meeting.reserve)} />
          </div>
          <RiskPanel values={[
            { l: "Diversification", v: meeting.diversification },
            { l: "Concentration control", v: meeting.concentration },
            { l: "Liquidity", v: meeting.liquidity },
            { l: "Portfolio quality", v: meeting.quality },
          ]} />
          <div className="notice" style={{ marginTop: 12 }}>
            <strong>Portfolio Desk · Valuation Desk · Risk Desk · Liquidity / Treasury:</strong> every open holding receives a documented opinion.
          </div>
          <HoldingTable rows={meeting.holdingReviews} />
          <Items items={meeting.portfolioItems} selected={selected} toggle={toggle} />
        </div>
      </details>

      <details style={agendaStyle}>
        <summary style={summaryStyle}>3 · INVESTMENT STRATEGY, RESEARCH & CAPITAL ALLOCATION</summary>
        <div style={{ marginTop: 14 }}>
          <p className="notice">
            <strong>RESEARCH SHORTLIST:</strong> {data?.allocation?.sources?.watchlistCandidates ?? 0} watchlist candidates · {String(data?.allocation?.sources?.discoveredCandidates ?? "—")} discovered · {meeting.strategyItems.length} presented · {meeting.strategyItems.filter((item) => item.approved).length} approved.
          </p>
          <CandidateRanking items={meeting.strategyItems} />
          <Items items={meeting.strategyItems} selected={selected} toggle={toggle} />
          {!meeting.strategyItems.length && (
            <div className="notice">No candidate was available from the research engine. Reserve remains in SGOV.</div>
          )}
        </div>
      </details>

      <details style={agendaStyle}>
        <summary style={summaryStyle}>4 · FINAL RESOLUTION, FUNDING & EXECUTION</summary>
        <div style={{ marginTop: 14 }}>
          <div className="grid cols-4">
            <Metric l="Approved ideas" v={String(meeting.approved.length)} />
            <Metric l="Human selected" v={String(selectedItems.length)} />
            <Metric l="Buy total" v={usd(buyTotal)} />
            <Metric l="Capital released" v={usd(sellTotal)} />
          </div>
          <CapitalFlow reserve={meeting.reserve} buys={buys} reserveUsed={reserveUsed} />
          <div className="notice" style={{ marginTop: 12, borderColor: "rgba(72,228,167,.4)" }}>
            <strong>Funding plan:</strong> {funding}
          </div>
          <div className="grid cols-3" style={{ marginTop: 10 }}>
            <Metric l="Projected holdings" v={String(projectedHoldings)} />
            <Metric l="Projected reserve" v={usd(projectedCash)} />
            <Metric l="Execution state" v={execution ? String(execution.package?.status ?? "SUBMITTED") : selectedItems.length ? "READY FOR HUMAN SUBMISSION" : "NO AUTHORIZED TRADE"} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn ghost" onClick={selectApproved} disabled={!meeting.approved.length}>Select All Approved</button>
            <button className="btn" onClick={submit} disabled={!selectedItems.length || submitting}>
              {submitting ? "Submitting…" : `Submit Rebalance Package (${selectedItems.length})`}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}

function Gauge({ label, value, note }: { label: string; value: number; note: string }) {
  const safeValue = clamp(value);
  return (
    <div className="metric" style={{ textAlign: "center", padding: 12 }}>
      <svg viewBox="0 0 110 70" role="img" aria-label={`${label} ${safeValue} out of 100`} style={{ width: "100%", maxWidth: 145 }}>
        <path d="M13 58 A42 42 0 0 1 97 58" fill="none" stroke="rgba(130,145,190,.22)" strokeWidth="10" strokeLinecap="round" />
        <path d="M13 58 A42 42 0 0 1 97 58" fill="none" stroke="#748cff" strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray={`${safeValue} ${100 - safeValue}`} />
        <text x="55" y="54" textAnchor="middle" fill="currentColor" fontSize="20" fontWeight="800">{safeValue}</text>
      </svg>
      <strong style={{ display: "block", fontSize: 14 }}>{label}</strong>
      <small>{note}</small>
    </div>
  );
}

function DriverChart({ rows }: { rows: Driver[] }) {
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 44px", gap: 10, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>{row.label}</span>
          <div style={{ height: 9, borderRadius: 99, background: "rgba(130,145,190,.16)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clamp(row.score)}%`, background: "linear-gradient(90deg,#4f8cff,#9a62ff)", borderRadius: 99 }} />
          </div>
          <strong style={{ fontSize: 12, textAlign: "right" }}>{row.score}</strong>
        </div>
      ))}
    </div>
  );
}

function RiskPanel({ values }: { values: { l: string; v: number }[] }) {
  return (
    <div className="grid cols-4" style={{ marginTop: 12 }}>
      {values.map((value) => (
        <div className="metric" key={value.l}>
          <span>{value.l}</span>
          <strong>{value.v}/100</strong>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(130,145,190,.16)", overflow: "hidden", marginTop: 8 }}>
            <div style={{ height: "100%", width: `${clamp(value.v)}%`, background: "linear-gradient(90deg,#4f8cff,#9a62ff)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CapitalFlow({ reserve, buys, reserveUsed }: { reserve: number; buys: MeetingItem[]; reserveUsed: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
      <div className="metric"><span>Source</span><strong>SGOV</strong><small>{usd(reserve)}</small></div>
      <span>→</span>
      <div className="metric"><span>Authorized capital</span><strong>{usd(reserveUsed)}</strong></div>
      <span>→</span>
      {buys.length ? buys.map((item) => (
        <div className="metric" key={`${item.action}:${item.ticker}`}>
          <span>{item.action}</span><strong>{item.ticker}</strong><small>{usd(item.amount)}</small>
        </div>
      )) : (
        <div className="metric"><span>Destination</span><strong>KEEP SGOV</strong><small>SGOV — NO SALE AUTHORIZED</small></div>
      )}
    </div>
  );
}

function HoldingTable({ rows }: { rows: HoldingReview[] }) {
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
      {rows.map((row) => (
        <article className="metric" key={row.ticker}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>{row.ticker}</strong><b>{row.decision}</b>
          </div>
          <small>Weight {row.weight.toFixed(1)}% · Value {usd(row.marketValue)} · P/L {row.pnlPct === null ? "—" : `${row.pnlPct.toFixed(1)}%`}</small>
          <div className="grid cols-4" style={{ marginTop: 8 }}>
            <Metric l="Portfolio" v={row.portfolio} />
            <Metric l="Valuation" v={row.valuation} />
            <Metric l="Risk" v={row.risk} />
            <Metric l="Liquidity" v={row.liquidity} />
          </div>
          <small>{row.reason}</small>
        </article>
      ))}
    </div>
  );
}

function CandidateRanking({ items }: { items: MeetingItem[] }) {
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {items.map((item) => (
        <div className="metric" key={`${item.rank}:${item.ticker}`} style={{ display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 10, alignItems: "center" }}>
          <strong>#{item.rank}</strong>
          <div>
            <strong>{item.ticker}</strong>
            <small style={{ display: "block" }}>Expected {item.upside === null ? "—" : `${item.upside.toFixed(1)}%`} · Conviction {item.conviction === null ? "—" : item.conviction}</small>
          </div>
          <b>{item.status}</b>
        </div>
      ))}
    </div>
  );
}

function Metric({ l, v }: { l: string; v: string }) {
  return <div className="metric"><span>{l}</span><strong style={{ fontSize: 17 }}>{v}</strong></div>;
}

function Transcript({ rows }: { rows: TranscriptRow[] }) {
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {rows.map((row) => <div className="notice" key={row.desk}><strong>{row.desk}:</strong> {row.text}</div>)}
    </div>
  );
}

function Items({ items, selected, toggle }: { items: MeetingItem[]; selected: Record<string, boolean>; toggle: (item: MeetingItem) => void }) {
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      {items.map((item) => {
        const itemKey = `${item.action}:${item.ticker}`;
        return (
          <article className="metric" key={`${item.rank}:${itemKey}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "start" }}>
            <div>
              <span>#{item.rank} · {item.action}</span>
              <strong style={{ display: "block", fontSize: 20 }}>{item.ticker} · {usd(item.amount)}</strong>
              <small>{item.reason}</small>
              <div className="grid cols-3" style={{ marginTop: 8 }}>
                <Metric l="Price" v={usd(item.price)} />
                <Metric l="Target" v={usd(item.target)} />
                <Metric l="Expected return" v={item.upside === null ? "—" : `${item.upside.toFixed(1)}%`} />
              </div>
              <div className="notice" style={{ marginTop: 8 }}>
                <strong>Risks:</strong> {item.risks.join(" · ")}<br />
                <strong>Monitoring:</strong> {item.monitoring.join(" · ")}
              </div>
              <div style={{ marginTop: 8, fontSize: 11 }}>{item.votes.join(" · ")}</div>
            </div>
            <label style={{ display: "grid", gap: 6, justifyItems: "center" }}>
              <input type="checkbox" checked={Boolean(selected[itemKey])} disabled={!item.approved} onChange={() => toggle(item)} />
              <b style={{ fontSize: 11 }}>{item.status}</b>
            </label>
          </article>
        );
      })}
    </div>
  );
}
