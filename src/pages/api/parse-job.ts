import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { schoolForEmail } from '../../lib/schools';
// @ts-ignore: plain JS port of the JobTracker parser (see the file header)
import { parseJobUrl } from '../../lib/jobs/parse.js';

/**
 * Reads a job posting link for the member's application tracker. The browser
 * cannot fetch other sites, so the tracker hands the link here and gets back
 * the company, role, location, pay, work mode, the full posting text and the
 * prep-sheet sections. Nothing is stored server-side: the client saves the
 * result into the member's own `applications` row, where RLS applies.
 *
 * Auth mirrors /api/opportunities-search: a verified Supabase access token
 * whose email maps to a live chapter. Anyone else gets 401, so this cannot be
 * used as an open fetch proxy.
 *
 * Responses:
 *   200 parse result   400 not a usable link   401 not a member
 */
export const prerender = false;

const SUPABASE_URL =
  import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const ANON_KEY =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Refuse links that point at the server's own network: bare IPs, localhost,
 * and internal-only names. Job postings live on public hostnames.
 */
function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.')) return false;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return false;
  return true;
}

export const POST: APIRoute = async ({ request }) => {
  // ---- auth: verified token + portal membership ------------------------
  // Local dev skips the check so the dev-only demo session can read links.
  // import.meta.env.DEV is false in every production build.
  if (!import.meta.env.DEV) {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!token || !SUPABASE_URL || !ANON_KEY) return json({ error: 'unauthorized' }, 401);
    const supa = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await supa.auth.getUser(token);
    const email = data?.user?.email;
    if (error || !email || !schoolForEmail(email)) return json({ error: 'unauthorized' }, 401);
  }

  // ---- input: {"url": "https://..."} -----------------------------------
  let raw: unknown;
  try {
    raw = (await request.json())?.url;
  } catch {
    return json({ error: 'That does not look like a web link' }, 400);
  }
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim());
    if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname)) throw new Error();
    if (u.href.length > 2000) throw new Error();
  } catch {
    return json({ error: 'That does not look like a web link' }, 400);
  }

  try {
    return json(await parseJobUrl(u.href));
  } catch (e) {
    // The parser collects per-source failures as warnings; a throw here means
    // even the fallback could not run. Return an empty result, not a 500, so
    // the tracker opens the editor for manual entry.
    return json({
      url: u.href,
      host: u.hostname.replace(/^www\./, ''),
      source: 'page',
      title: '', company: '', location: '', salary: '', workMode: '',
      employmentType: '', postedAt: '', team: '', level: '', experience: '',
      description: '', sections: {}, skills: [],
      warnings: [(e as Error)?.message || 'Could not read the posting'],
    });
  }
};
