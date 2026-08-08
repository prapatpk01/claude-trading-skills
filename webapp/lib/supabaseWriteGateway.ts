import type { NextRequest } from "next/server";

export type GatewayResult = {
  ok: boolean;
  status: number;
  body: any;
};

/**
 * Privileged-write fallback used only when a direct Supabase server secret is
 * not configured. On Vercel, Production Functions may forward the short-lived
 * VERCEL_OIDC_TOKEN to the Supabase sentinel-write Edge Function. Railway does
 * not provide Vercel OIDC, so Railway deployments must use SUPABASE_SECRET_KEY
 * (or one of the supported legacy service-role aliases) for direct server-side
 * writes. The browser never receives the privileged key.
 */
export async function callSupabaseWriteGateway(
  _req: NextRequest,
  payload: Record<string, unknown>,
): Promise<GatewayResult> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  const onRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID,
  );

  if (!base) {
    return { ok: false, status: 503, body: { error: "NEXT_PUBLIC_SUPABASE_URL is missing" } };
  }

  if (!oidc) {
    return {
      ok: false,
      status: 503,
      body: onRailway
        ? {
            code: "RAILWAY_SUPABASE_SECRET_REQUIRED",
            error:
              "Railway secure writes require SUPABASE_SECRET_KEY on the server. Add it in Railway Variables and redeploy.",
          }
        : {
            code: "VERCEL_OIDC_UNAVAILABLE",
            error:
              "Secure writes require either SUPABASE_SECRET_KEY on the server or Vercel Production OIDC Secure Backend Access.",
          },
    };
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/sentinel-write`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vercel-oidc-token": oidc,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({ error: `Write gateway returned HTTP ${response.status}` }));
    return { ok: response.ok && body?.ok !== false, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: { error: error instanceof Error ? error.message : "Supabase write gateway unavailable" },
    };
  }
}
