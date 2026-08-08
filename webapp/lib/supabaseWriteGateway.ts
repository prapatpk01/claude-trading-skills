import type { NextRequest } from "next/server";

export type GatewayResult = {
  ok: boolean;
  status: number;
  body: any;
};

/**
 * Privileged-write fallback that does not require a long-lived Supabase secret
 * in Vercel. Production Vercel Functions receive a short-lived OIDC token in
 * the VERCEL_OIDC_TOKEN environment variable. Forward that token to the
 * Supabase sentinel-write Edge Function, which verifies the exact Production
 * deployment claims before using its platform-provided privileged key.
 */
export async function callSupabaseWriteGateway(
  _req: NextRequest,
  payload: Record<string, unknown>,
): Promise<GatewayResult> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oidc = process.env.VERCEL_OIDC_TOKEN;

  if (!base) {
    return { ok: false, status: 503, body: { error: "NEXT_PUBLIC_SUPABASE_URL is missing" } };
  }

  if (!oidc) {
    return {
      ok: false,
      status: 503,
      body: {
        code: "VERCEL_OIDC_UNAVAILABLE",
        error: "Secure writes require either SUPABASE_SECRET_KEY on the server or Vercel Production OIDC Secure Backend Access.",
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
