import { NextResponse } from "next/server";
import {
  getSupabase,
  supabaseAdminConfigured,
  supabaseAdminKeySource,
  supabaseConfigured,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const serviceRoleConfigured = supabaseAdminConfigured();
  const adminKeySource = supabaseAdminKeySource();
  const publicUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const sb = getSupabase();

  const checks: Record<string, unknown> = {
    supabaseConfigured: supabaseConfigured(),
    publicUrlConfigured,
    serviceRoleConfigured,
    adminKeySource,
    anonKeyConfigured,
    serverWritesProtected: serviceRoleConfigured,
  };

  let databaseReachable = false;
  let holdingsCount: number | null = null;
  let watchlistCount: number | null = null;
  let databaseError: string | null = null;

  if (sb) {
    try {
      const [holdings, watchlist] = await Promise.all([
        sb.from("holdings").select("id", { count: "exact", head: true }),
        sb.from("watchlist").select("id", { count: "exact", head: true }),
      ]);
      if (holdings.error) throw holdings.error;
      if (watchlist.error) throw watchlist.error;
      databaseReachable = true;
      holdingsCount = holdings.count ?? 0;
      watchlistCount = watchlist.count ?? 0;
    } catch (error: any) {
      databaseError = error?.message ?? "Database health check failed";
    }
  }

  const ready = Boolean(
    publicUrlConfigured &&
      serviceRoleConfigured &&
      databaseReachable &&
      databaseError === null,
  );

  return NextResponse.json(
    {
      ok: ready,
      release: "Sentinel-Investment-OS-v10.0",
      checkedAt: new Date().toISOString(),
      checks: {
        ...checks,
        databaseReachable,
        holdingsCount,
        watchlistCount,
      },
      failures: [
        ...(!publicUrlConfigured ? ["NEXT_PUBLIC_SUPABASE_URL is missing"] : []),
        ...(!serviceRoleConfigured
          ? [
              "No privileged Supabase server key is configured. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in Vercel Production.",
            ]
          : []),
        ...(!databaseReachable ? [databaseError ?? "Supabase database is unreachable"] : []),
      ],
      productionReady: ready,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
