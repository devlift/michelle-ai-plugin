/**
 * Supabase client factory for Edge Functions.
 * Uses service_role key for DB operations (bypasses RLS).
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

let _serviceClient: SupabaseClient | null = null;

/**
 * Get a Supabase client with service_role privileges.
 * Edge Functions use this for all DB operations.
 */
export function getServiceClient(): SupabaseClient {
  if (!_serviceClient) {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    _serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _serviceClient;
}

/**
 * Get a Supabase client scoped to the user's JWT (for RLS).
 * Used when we want RLS to apply (rare in Edge Functions).
 */
export function getUserClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
