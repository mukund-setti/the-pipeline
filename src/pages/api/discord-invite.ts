import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { partnerForEmail } from '../../lib/partners';

// On-demand (serverless) route. This is the ONLY non-static part of the site.
export const prerender = false;

const SUPABASE_URL =
  import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;
// The invite lives only here, in a server secret. It is never shipped to the
// client, so an unverified visitor cannot pull it from the page source.
const DISCORD_INVITE =
  import.meta.env.DISCORD_INVITE_URL || process.env.DISCORD_INVITE_URL;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return json({ error: 'not_configured' }, 503);
  }

  // The browser sends its Supabase access token as a bearer token.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json({ error: 'unauthenticated' }, 401);

  // Validate the token against Supabase and read the verified email.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email;
  if (error || !email) return json({ error: 'unauthenticated' }, 401);

  // Enforce the partner allowlist server-side. This is the real gate.
  const partner = partnerForEmail(email);
  if (!partner.ok) return json({ error: 'not_partner', domain: partner.domain }, 403);

  if (!DISCORD_INVITE) return json({ error: 'invite_not_configured' }, 503);
  return json({ invite: DISCORD_INVITE, school: partner.name });
};

// Anything other than POST is not allowed.
export const ALL: APIRoute = async () => json({ error: 'method_not_allowed' }, 405);
