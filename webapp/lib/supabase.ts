import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let readClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/**
 * Server-side read client. It prefers the service-role key but may use the
 * publishable/anon key for read-only operations when RLS permits public reads.
 */
export function getSupabase(): SupabaseClient | null {
  if (readClient) return readClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  readClient = createClient(url, key, { auth: { persistSession: false } });
  return readClient;
}

/**
 * Privileged server-only client for INSERT/UPDATE/DELETE. Never falls back to
 * the public anon key: a missing service-role key must block writes rather than
 * silently depending on permissive RLS.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}

export function supabaseAdminConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
