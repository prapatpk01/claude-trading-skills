import { NextRequest, NextResponse } from "next/server";
import { runActiveFund, type PositionValue } from "@/lib/activeFund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown, limit: number) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => /^[A-Z.\-]{1,10}$/.test(x)))).slice(0, limit)
    : [];

const cleanPositions = (value: unknown): PositionValue[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((x: any) => {
    const ticker = String(x?.ticker ?? "").trim().toUpperCase();
    const marketValue = Number(x?.marketValue);
    return /^[A-Z.\-]{1,10}$/.test(ticker) && Number.isFinite(marketValue) && marketValue >= 0
      ? [{ ticker, marketValue }]
      : [];
  });
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tickers = cleanTickers(body?.tickers, 30);
    const candidateTickers = cleanTickers(body?.candidateTickers, 25);
    const positionValues = cleanPositions(body?.positionValues);
    const nav = typeof body?.nav === "number" && Number.isFinite(body.nav) && body.nav > 0 ? body.nav : 0;
    return NextResponse.json(await runActiveFund(tickers, nav, candidateTickers, positionValues));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Active fund review failed" }, { status: 500 });
  }
}
