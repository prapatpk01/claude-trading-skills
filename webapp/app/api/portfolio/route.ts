import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { mergeLot, findOpenLot } from "@/lib/mergeLot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Columns added by a later migration — the app must work either way. */
const OPTIONAL_COLUMNS = ["opened_at", "closed_at"];

/** True when Postgres rejected the write because a column isn't there yet. */
function isMissingColumn(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    OPTIONAL_COLUMNS.some((c) => m.includes(c)) &&
    (m.includes("column") || m.includes("schema cache") || m.includes("does not exist"))
  );
}

function withoutOptional<T extends Record<string, any>>(row: T): T {
  const copy: Record<string, any> = { ...row };
  for (const c of OPTIONAL_COLUMNS) delete copy[c];
  return copy as T;
}

const optNum = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const optDate = (v: any): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export async function GET() {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").select("*").order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ holdings: data, backend: "supabase" });
  }
  return NextResponse.json({ holdings: memStore.holdings, backend: "memory" });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker symbol (letters only, e.g. NVDA)." }, { status: 400 });
  }
  const shares = optNum(body.shares);
  const avgCost = optNum(body.avg_cost);
  if (shares === null || shares <= 0) {
    return NextResponse.json({ error: "Shares must be a number greater than zero." }, { status: 400 });
  }
  if (avgCost === null || avgCost < 0) {
    return NextResponse.json({ error: "Average cost must be a valid number." }, { status: 400 });
  }
  const row = {
    ticker,
    shares,
    avg_cost: avgCost,
    notes: body.notes?.trim() || null,
    thesis: body.thesis?.trim() || null,
    target_price: optNum(body.target_price),
    opened_at: optDate(body.opened_at) ?? new Date().toISOString().slice(0, 10),
    closed_at: optDate(body.closed_at),
  };

  const sb = getSupabase();
  if (sb) {
    // Buying more of something already held blends into that position rather
    // than creating a second row for the same ticker. Two rows split the
    // weight, and every downstream figure — the single-name cap, the
    // allocation ring, the valuation desk's sizing — would then see half a
    // position twice and understate the real concentration.
    const { data: openRows } = await sb
      .from("holdings").select("*").eq("ticker", ticker);
    const existing = openRows ? findOpenLot(openRows as any[], ticker) : undefined;
    if (existing) {
      const merged = mergeLot(existing as any, row);
      const patch: Record<string, any> = {
        shares: merged.shares,
        avg_cost: merged.avg_cost,
        target_price: merged.target_price,
        thesis: merged.thesis,
        notes: merged.notes,
        opened_at: merged.opened_at,
      };
      let { data, error } = await sb.from("holdings").update(patch).eq("id", (existing as any).id).select().single();
      if (error && isMissingColumn(error.message)) {
        ({ data, error } = await sb.from("holdings").update(withoutOptional(patch)).eq("id", (existing as any).id).select().single());
      }
      if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
      return NextResponse.json({ holding: data, merged: true, mergeSummary: merged.summary });
    }

    let { data, error } = await sb.from("holdings").insert(row).select().single();
    if (error && isMissingColumn(error.message)) {
      // The date migration hasn't been run yet — save what the table supports.
      ({ data, error } = await sb.from("holdings").insert(withoutOptional(row)).select().single());
      if (!error) {
        return NextResponse.json({
          holding: data,
          warning:
            "Saved without the position dates — run the migration at the end of supabase/schema.sql to enable them.",
        });
      }
    }
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }
  const existingMem = findOpenLot(memStore.holdings, ticker);
  if (existingMem) {
    const merged = mergeLot(existingMem, row);
    const updated = memStore.updateHolding(existingMem.id, {
      shares: merged.shares,
      avg_cost: merged.avg_cost,
      target_price: merged.target_price,
      thesis: merged.thesis,
      notes: merged.notes,
      opened_at: merged.opened_at,
    });
    return NextResponse.json({ holding: updated, merged: true, mergeSummary: merged.summary, backend: "memory" });
  }
  return NextResponse.json({ holding: memStore.addHolding(row), backend: "memory" });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, any> = {};
  if (body.ticker !== undefined) {
    const t = String(body.ticker).trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) {
      return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });
    }
    patch.ticker = t;
  }
  if (body.shares !== undefined) {
    const n = optNum(body.shares);
    if (n === null || n <= 0) return NextResponse.json({ error: "Shares must be greater than zero." }, { status: 400 });
    patch.shares = n;
  }
  if (body.avg_cost !== undefined) {
    const n = optNum(body.avg_cost);
    if (n === null || n < 0) return NextResponse.json({ error: "Average cost must be a valid number." }, { status: 400 });
    patch.avg_cost = n;
  }
  if (body.target_price !== undefined) patch.target_price = optNum(body.target_price);
  if (body.thesis !== undefined) patch.thesis = String(body.thesis).trim() || null;
  if (body.notes !== undefined) patch.notes = String(body.notes).trim() || null;
  if (body.opened_at !== undefined) patch.opened_at = optDate(body.opened_at);
  if (body.closed_at !== undefined) patch.closed_at = optDate(body.closed_at);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const sb = getSupabase();
  if (sb) {
    let { data, error } = await sb.from("holdings").update(patch).eq("id", id).select().single();
    if (error && isMissingColumn(error.message)) {
      const reduced = withoutOptional(patch);
      if (Object.keys(reduced).length === 0) {
        return NextResponse.json(
          { error: "Position dates need the migration at the end of supabase/schema.sql." },
          { status: 400 }
        );
      }
      ({ data, error } = await sb.from("holdings").update(reduced).eq("id", id).select().single());
      if (!error) {
        return NextResponse.json({
          holding: data,
          warning: "Saved without the position dates — run the migration in supabase/schema.sql to enable them.",
        });
      }
    }
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }
  const updated = memStore.updateHolding(id, patch as any);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ holding: updated });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from("holdings").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: memStore.deleteHolding(id) });
}
