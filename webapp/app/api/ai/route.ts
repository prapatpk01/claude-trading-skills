import { NextRequest, NextResponse } from "next/server";
import { runAI, aiConfigured, activeChain, configuredProviders, setupHint, keyDiagnostics } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are a sharp, institutional-grade equity analyst and portfolio strategist.
You write concise, structured, decision-useful commentary for a sophisticated retail investor.
Be specific and quantitative where data allows; flag uncertainty honestly. Use short markdown
sections with **bold** headers and bullet points. Always end with a one-line disclaimer that this
is research/education, not financial advice. Never invent precise figures that were not provided.`;

function researchPrompt(a: any): string {
  const ov = a.data?.overview ?? {};
  const q = a.data?.quote ?? {};
  const t = a.technicals ?? {};
  const dcf = a.dcf ?? {};
  return `Give a second-opinion analysis of ${a.ticker} (${ov.name ?? a.ticker}).

Snapshot:
- Price: ${q.price} | Market cap: ${ov.marketCap} | Sector: ${ov.sector} / ${ov.industry}
- P/E: ${ov.peRatio} | Fwd P/E: ${ov.forwardPE} | EPS: ${ov.eps} | Beta: ${ov.beta}
- Profit margin: ${ov.profitMargin} | ROE: ${ov.roe} | Revenue TTM: ${ov.revenueTTM}
- Momentum score: ${a.momentum?.total}/100 | Signal: ${a.signal}
- RSI(14): ${t.rsi14} | MACD hist: ${t.macdHist} | RS vs SPY: ${t.rs30} | above 20-EMA: ${t.aboveEma20}
- DCF fair value: ${dcf.fairValue} (${dcf.upsidePct}% vs price) | Blended target: ${a.targetPrice} (${a.upsidePct}%)
- Scenario targets: ${(a.thesis ?? []).map((s: any) => `${s.label} ${s.targetPrice} @ ${s.probability}%`).join(", ")}

Write: **Verdict** (Buy/Hold/Sell + conviction), **Why** (2-3 bullets on the strongest bull & bear points),
**Valuation read** (is the target reasonable?), **What to watch** (catalysts/risks over the next 1-2 quarters).
Keep it under ~250 words.`;
}

function portfolioPrompt(p: any): string {
  const holdings = (p.holdings ?? [])
    .map((h: any) => `${h.ticker}: ${h.shares}sh @ $${h.avg_cost}${h.price ? `, now $${h.price}` : ""}${h.thesis ? ` — ${h.thesis}` : ""}`)
    .join("\n");
  const watch = (p.watchlist ?? []).map((w: any) => `${w.ticker}${w.reason ? ` (${w.reason})` : ""}`).join(", ");
  return `Review this portfolio and watchlist.

Holdings:
${holdings || "(none)"}

Totals: market value ${p.mktValue}, cost basis ${p.costBasis}, unrealized P/L ${p.pnl} (${p.pnlPct}%).

Watchlist: ${watch || "(none)"}

Write: **Portfolio read** (concentration, sector/factor tilt, biggest risks), **Position notes**
(1 line each on the 2-3 most notable holdings — trim/add/hold), **Watchlist priorities**
(which to act on and the trigger), **Suggested next steps** (2-3 concrete actions).
Keep it under ~280 words.`;
}

/** Status: which providers/models are live (used by the UI badge). */
export async function GET() {
  const chain = activeChain();
  return NextResponse.json({
    configured: aiConfigured(),
    providers: configuredProviders(),
    models: chain.map((m) => ({ label: m.label, tier: m.tier })),
    freeCount: chain.filter((m) => m.tier === "free").length,
    hint: aiConfigured() ? null : setupHint(),
    // booleans only — shows whether the server sees each key, never its value
    detectedKeys: keyDiagnostics(),
  });
}

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json({ error: setupHint() }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const mode = body.mode;
  let user: string;
  if (mode === "research" && body.analysis) user = researchPrompt(body.analysis);
  else if (mode === "portfolio" && body.portfolio) user = portfolioPrompt(body.portfolio);
  else return NextResponse.json({ error: "Invalid request. Expected { mode, analysis|portfolio }." }, { status: 400 });

  try {
    const result = await runAI(SYSTEM, user);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI request failed" }, { status: 502 });
  }
}
