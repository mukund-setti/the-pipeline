import { createClient } from '@supabase/supabase-js';

/**
 * Server-side usage quota check for the API routes. Counts one use of
 * `kind` for the member who owns `token` via the consume_api_quota()
 * database function (supabase/guardrails.sql), which holds the limits.
 *
 *   'ok'           within today's limits
 *   'over'         over the member's daily limit or the site-wide ceiling
 *   'unavailable'  the check itself failed (function missing, Supabase down)
 *
 * Callers decide how to treat 'unavailable': routes that spend money fail
 * closed, the rest fail open.
 */
export type QuotaResult = 'ok' | 'over' | 'unavailable';

export async function consumeQuota(
  supabaseUrl: string,
  anonKey: string,
  token: string,
  kind: 'ai_search' | 'parse_job'
): Promise<QuotaResult> {
  try {
    // Calls run as the member (their token), so auth.uid() is theirs.
    const supa = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await supa.rpc('consume_api_quota', { p_kind: kind });
    if (error) return 'unavailable';
    return data === true ? 'ok' : 'over';
  } catch {
    return 'unavailable';
  }
}
