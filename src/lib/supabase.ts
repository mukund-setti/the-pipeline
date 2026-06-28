import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client (lazy singleton). Returns null when the public env
 * vars are not set, so the verify UI can render and degrade gracefully instead
 * of crashing during local dev or an unconfigured deploy.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'pkce',
    },
  });
  return client;
}
