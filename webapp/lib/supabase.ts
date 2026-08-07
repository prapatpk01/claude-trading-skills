import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let readClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/**
 * Resolve the privileged Supabase server key.
 *
 * SUPABASE_SERVICE_ROLE_KEY is the legacy/standard name used by this app.
 * Newer Supabase dashboards label the generated credential as a "Secret key",
 * so deployments sometimes store it under SUPABASE_SECRET_KEY instead.  Keep
 * both server-only names supported (plus SUPABASE_SERVICE_KEY for backwards
 * compatibility) without ever exposing the value to client bundles.
 */
function getSupabaseAdminKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  );
}

export function supabaseAdminKeySource(): string | null {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY";
  if (process.env.SUPABASE_SECRET_KEY) return "SUPABASE_SECRET_KEY";
  if (process.env.SUPABASE_SERVICE_KEY) return "SUPABASE_SERVICE_KEY";
  return null;
}

/**
 * Server-side read client. It prefers a privileged server key but may use the
 * publishable/anon key for read-only operations when RLS permits public reads.
 */
export function getSupabase(): SupabaseClient | null {
  if (readClient) return readClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseAdminKey() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  readClient = createClient(url, key, { auth: { persistSession: false } });
  return readClient;
}

/**
 * Privileged server-only client for INSERT/UPDATE/DELETE. Never falls back to
 * the public anon key: a missing privileged key must block writes rather than
 * silently depending on permissive RLS.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseAdminKey();
  if (!url || !key) return null;
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

export function supabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (getSupabaseAdminKey() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export function supabaseAdminConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabaseAdminKey());
}
