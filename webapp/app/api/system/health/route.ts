import { NextRequest, NextResponse } from "next/server";
import {
  getSupabase,
  supabaseAdminConfigured,
  supabaseAdminKeySource,
  supabaseConfigured,
} from "@/lib/supabase";
import { callSupabaseWriteGateway } from "@/lib/supabaseWriteGateway";
import { SENTINEL_RELEASE } from "@/lib/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const serviceRoleConfigured = supabaseAdminConfigured();
  const adminKeySource = supabaseAdminKeySource();
  const publicUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const sb = getSupabase();

  let oidcGatewayReady = false;
  let oidcGatewayError: string | null = null;
  if (!serviceRoleConfigured && publicUrlConfigured) {
    const gateway = await callSupabaseWriteGateway(req, { resource: "system", action: "health" });
    oidcGatewayReady = gateway.ok;
    if (!gateway.ok) oidcGatewayError = String(gateway.body?.error ?? `HTTP ${gateway.status}`);
  }

  const protectedWriteReady = serviceRoleConfigured || oidcGatewayReady;
  const checks: Record<string, unknown> = {
    supabaseConfigured: supabaseConfigured(),
    publicUrlConfigured,
    serviceRoleConfigured,
    adminKeySource,
    anonKeyConfigured,
    oidcGatewayReady,
    writeAuth: serviceRoleConfigured ? "supabase-secret" : oidcGatewayReady ? "vercel-oidc" : null,
    serverWritesProtected: protectedWriteReady,
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

  const ready = Boolean(publicUrlConfigured && protectedWriteReady && databaseReachable && databaseError === null);

  return NextResponse.json(
    {
      ok: ready,
      release: SENTINEL_RELEASE.healthRelease,
      versions: {
        app: SENTINEL_RELEASE.appVersion,
        capitalClarity: SENTINEL_RELEASE.capitalClarityVersion,
        research: SENTINEL_RELEASE.researchVersion,
        technical: SENTINEL_RELEASE.technicalVersion,
        forecast: SENTINEL_RELEASE.forecastVersion,
      },
      checkedAt: new Date().toISOString(),
      checks: { ...checks, databaseReachable, holdingsCount, watchlistCount },
      failures: [
        ...(!publicUrlConfigured ? ["NEXT_PUBLIC_SUPABASE_URL is missing"] : []),
        ...(!protectedWriteReady ? [`No secure write identity is available. ${oidcGatewayError ?? "Configure SUPABASE_SECRET_KEY or enable Vercel OIDC Secure Backend Access."}`] : []),
        ...(!databaseReachable ? [databaseError ?? "Supabase database is unreachable"] : []),
      ],
      productionReady: ready,
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
