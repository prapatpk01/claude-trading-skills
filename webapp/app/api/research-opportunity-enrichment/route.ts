import { NextRequest, NextResponse } from "next/server";
import { dailyCandles } from "@/lib/marketData";
import { computePortfolioTechnicalOverlay } from "@/lib/portfolioTechnicalOverlay";
import { classifyMomentumLifecycle } from "@/lib/research/momentumLifecycle";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OpportunityInput = {
  ticker: string;
  momentum: number | null;
  institutional: number | null;
  currentPrice: number | null;
  targetPrice: number | null;
  source: unknown;
};

const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      out[index] = await fn(items[index]);
    }
  }));
  return out;
}

function pctReturn(rows: Candle[], bars: number): number | null {
  if (rows.length <= bars) return null;
  const start = rows[rows.length - 1 - bars]?.close;
  const end = rows.at(-1)?.close;
  if (!(start > 0) || !(end && end > 0)) return null;
  return (end / start - 1) * 100;
}

function relativeStrength(stock: Candle[], benchmark: Candle[], bars = 30): number | null {
  const sr = pctReturn(stock, bars);
  const br = pctReturn(benchmark, bars);
  if (sr == null || br == null || 1 + br / 100 <= 0) return null;
  return (1 + sr / 100) / (1 + br / 100);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function volumeRatio(rows: Candle[]): number | null {
  const last20 = rows.slice(-20).filter(row => row.volume > 0);
  const last5 = rows.slice(-5).filter(row => row.volume > 0);
  const a20 = average(last20.map(row => row.volume));
  const a5 = average(last5.map(row => row.volume));
  return a20 && a5 ? a5 / a20 : null;
}

function upDownVolume(rows: Candle[]): number | null {
  const recent = rows.slice(-20);
  let up = 0, down = 0;
  for (let i = 1; i < recent.length; i++) {
    const volume = Math.max(0, recent[i].volume || 0);
    if (recent[i].close >= recent[i - 1].close) up += volume;
    else down += volume;
  }
  if (down <= 0) return up > 0 ? 3 : null;
  return Math.min(3, up / down);
}

function ema(values: number[], length: number): number | null {
  if (values.length < length) return null;
  const k = 2 / (length + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function sma(values: number[], length: number): number | null {
  if (values.length < length) return null;
  return average(values.slice(-length));
}

const ENGINE_LABELS: Record<string, string> = {
  MOMENTUM: "Momentum Lifecycle",
  INSTITUTIONAL: "Institutional Accumulation",
  GROWTH: "Growth Acceleration",
  QUALITY: "Quality Leadership",
  VALUE: "Valuation Room-to-Run",
  AI: "Catalyst / AI Theme",
  DIVIDEND: "Income Momentum",
};

function researchEngine(source: unknown) {
  const rows = Array.isArray(source) ? source.map(value => String(value).toUpperCase()) : [];
  for (const row of rows) {
    for (const [token, label] of Object.entries(ENGINE_LABELS)) if (row === token || row.includes(` ${token}`)) return label;
  }
  return rows.some(row => row.includes("WATCHLIST")) ? "Watchlist Re-underwrite" : "Research OS / Multi-engine";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const incoming: unknown[] = Array.isArray(body?.rows) ? body.rows : [];
    const rows: OpportunityInput[] = incoming
      .map((raw): OpportunityInput => {
        const row = raw && typeof raw === "object" ? raw as Record<string, any> : {};
        return {
          ticker: cleanTicker(row.ticker),
          momentum: finite(row.momentum),
          institutional: finite(row.factors?.institutional),
          currentPrice: finite(row.currentPrice),
          targetPrice: finite(row.targetPrice),
          source: row.source,
        };
      })
      .filter((row: OpportunityInput) => /^[A-Z.\-]{1,10}$/.test(row.ticker))
      .slice(0, 24);
    if (!rows.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });

    const benchmark = await dailyCandles("SPY", 120).catch(() => [] as Candle[]);
    const enriched = await mapLimit<OpportunityInput, Record<string, unknown>>(rows, 5, async (row) => {
      const candles = await dailyCandles(row.ticker, 260).catch(() => [] as Candle[]);
      const overlay = computePortfolioTechnicalOverlay(candles);
      const closes = candles.map(candle => candle.close).filter(value => value > 0);
      const e10 = ema(closes, 10), e20 = ema(closes, 20), s50 = sma(closes, 50);
      const last = closes.at(-1) ?? null;
      const gap = row.currentPrice != null && row.currentPrice > 0 && row.targetPrice != null && row.targetPrice > 0
        ? (row.targetPrice / row.currentPrice - 1) * 100
        : null;
      const lifecycle = classifyMomentumLifecycle({
        momentum: row.momentum,
        institutional: row.institutional,
        rs30: relativeStrength(candles, benchmark, 30),
        volumeRatio: volumeRatio(candles),
        upDownVolume: upDownVolume(candles),
        return1m: pctReturn(candles, 21),
        return3m: pctReturn(candles, 63),
        aboveEma20: last != null && e20 != null ? last > e20 : null,
        maFanning: e10 != null && e20 != null && s50 != null ? e10 > e20 && e20 > s50 : null,
        valuationGapPct: gap,
      });
      const valuationReady = gap != null && gap >= 5;
      const technicalReady = overlay?.action === "ADD";
      const researchState = !valuationReady
        ? "VALUATION_REQUIRED"
        : !lifecycle.preferredEntry
          ? "WAIT_LIFECYCLE"
          : !technicalReady
            ? "WAIT_TECHNICAL"
            : "RESEARCH_READY";

      return {
        ticker: row.ticker,
        researchEngine: researchEngine(row.source),
        lifecycleStage: lifecycle.stage,
        lifecycleScore: lifecycle.score,
        lifecycleReason: lifecycle.reason,
        preferredEntryStage: lifecycle.preferredEntry,
        researchState,
        technicalDecision: overlay?.action ?? null,
        technicalConfidence: overlay?.confidence ?? null,
        technicalReason: overlay?.reason ?? null,
        technicalTarget1: overlay?.target1 ?? null,
        technicalTarget2: overlay?.target2 ?? null,
        technicalSupport1: overlay?.support1 ?? null,
        technicalRoomAtr: overlay?.roomAtr ?? null,
      };
    });

    return NextResponse.json({
      rows: enriched,
      methodology: "Active Momentum Lifecycle: ACCUMULATION → EARLY MARKUP → MOMENTUM EXPANSION. MATURE and WEAKENING are watch/trim states. New risk additionally requires valuation room and the shared Holdings technical gate.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Opportunity enrichment failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
