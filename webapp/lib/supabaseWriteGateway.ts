import type { NextRequest } from "next/server";

export type GatewayResult = {
  ok: boolean;
  status: number;
  body: any;
};

/**
 * Privileged-write fallback that does not require a long-lived Supabase secret
 * in Vercel. Vercel injects a short-lived OIDC identity token into Function
 * requests. The Supabase Edge Function verifies the exact team, project and
 * production environment claims before using its platform-provided secret key.
 */
export async function callSupabaseWriteGateway(
  req: NextRequest,
  payload: Record<string, unknown>,
): Promise<GatewayResult> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oidc = req.headers.get("x-vercel-oidc-token");
  if (!base) {
    return { ok: false, status: 503, body: { error: "NEXT_PUBLIC_SUPABASE_URL is missing" } };
  }
  if (!oidc) {
    return {
      ok: false,
      status: 503,
      body: {
        code: "VERCEL_OIDC_UNAVAILABLE",
        error: "Secure writes require either a Supabase server secret or Vercel OIDC Secure Backend Access.",
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
