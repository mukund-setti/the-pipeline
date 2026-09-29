/**
 * Helpers shared by everything that writes to a member's application
 * tracker: the Tracker page itself and the "Mark applied" flow on the
 * Opportunities page.
 */
import { getSupabase } from '../supabase';
import type { ApplicationInput, ParsedPosting } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as YYYY-MM-DD. */
export const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toDay(new Date());

/** Compare links loosely so the same posting is not tracked twice. */
export const normUrl = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return u;
  }
};

/**
 * Ask the server to read a posting. In production this needs a signed-in
 * member's token. In local dev the endpoint also accepts calls without one,
 * so the dev-only demo session (?demo=<school>) can read links too.
 */
export async function parsePosting(url: string): Promise<ParsedPosting> {
  const supa = getSupabase();
  const token = supa ? (await supa.auth.getSession()).data.session?.access_token : null;
  if (!token && !import.meta.env.DEV) throw new Error('sign in again to read links');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch('/api/parse-job', { method: 'POST', headers, body: JSON.stringify({ url }) });
  } catch {
    throw new Error('could not reach the site server');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('sign in again to read links');
  if (!res.ok) throw new Error(body?.error || `the server returned ${res.status}`);
  return body as ParsedPosting;
}

/**
 * The parser-owned part of a new tracker row: posting text, prep-sheet
 * sections and detected facts. Member-facing fields (company, role, stage,
 * notes...) come from the form and are spread on top by the caller.
 */
export function parsedDetails(p: ParsedPosting | null): ApplicationInput {
  let host = p?.host;
  if (p?.applyUrl) {
    try {
      host = new URL(p.applyUrl).hostname.replace(/^www\./, '');
    } catch {
      /* keep the parsed host */
    }
  }
  return {
    host,
    description: p?.description || '',
    postedAt: p?.postedAt || '',
    employmentType: p?.employmentType || '',
    source: p?.source || '',
    team: p?.team || '',
    level: p?.level || '',
    experience: p?.experience || '',
    jobRef: p?.jobRef || '',
    sections: p?.sections || {},
    skills: p?.skills || [],
    parsedAt: p ? new Date().toISOString() : '',
    parseWarning:
      p && (p.description || '').length <= 200
        ? p.warnings?.[0] || 'Only a summary could be read from this posting'
        : '',
  };
}
