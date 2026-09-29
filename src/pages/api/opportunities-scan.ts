import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  scanCompanyBoards,
  scanGithubBoards,
  stripTracking,
  type Candidate,
} from '../../lib/jobs/sources';
import { isTopPick, normCompany } from '../../lib/jobs/tiers';

/**
 * Opportunity scanner: the engine behind the portal's "AI-tracked" surface.
 * Vercel Cron hits this daily (see vercel.json) and it refills the public
 * `opportunities` table from three kinds of source:
 *
 *  1. Company careers pages (deterministic, src/lib/jobs/sources.ts): the
 *     public Greenhouse, Ashby and Lever boards of curated top employers,
 *     filtered to US intern, new-grad and early-career titles.
 *  2. Community GitHub boards (deterministic, same module): SimplifyJobs,
 *     speedyapply and vanshb03 / CSCareers README tables.
 *  3. Hacker News "Ask HN: Who is hiring?" (AI-extracted): the latest thread's
 *     top-level comments are handed to Claude in one request, which returns a
 *     strict JSON list of undergrad/new-grad-relevant roles with URLs.
 *
 * The same posting often shows up on several boards, so candidates are
 * deduped by URL and by company + title + city, in source priority order
 * (direct careers page first), and duplicates donate their tags (pay, top
 * pick) to the row that is kept.
 *
 * Security model: the Supabase service-role key lives only in server env vars
 * and never ships to the client; the endpoint itself is gated by CRON_SECRET
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
 * that env var exists). Rows are insert-only and deduped by URL. posted_at is
 * the source's own posting date when it gives one (else first-seen), so the
 * portal's "New" chip means new at the company, not new to the scanner.
 */
export const prerender = false;

const CRON_SECRET = import.meta.env.CRON_SECRET || process.env.CRON_SECRET;
const SUPABASE_URL =
  import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY =
  import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const DISCORD_DROPS_WEBHOOK =
  import.meta.env.DISCORD_DROPS_WEBHOOK || process.env.DISCORD_DROPS_WEBHOOK;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/* ------------------- source 2: Hacker News, via Claude ------------------ */

const HN_SEARCH =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=%22who%20is%20hiring%22&hitsPerPage=1';

/** Strict schema for Claude's structured output: additionalProperties false everywhere. */
const HN_SCHEMA = {
  type: 'object',
  properties: {
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          url: { type: 'string' },
          kind: { type: 'string', enum: ['internship', 'new-grad', 'program'] },
          tags: { type: 'array', items: { type: 'string' } },
          location: { type: ['string', 'null'] },
        },
        required: ['title', 'company', 'url', 'kind', 'tags', 'location'],
        additionalProperties: false,
      },
    },
  },
  required: ['opportunities'],
  additionalProperties: false,
} as const;

async function scanHackerNews(): Promise<Candidate[]> {
  if (!ANTHROPIC_API_KEY) return [];

  // Find the latest "Ask HN: Who is hiring?" story, then pull its comments.
  const searchRes = await fetch(HN_SEARCH);
  if (!searchRes.ok) throw new Error(`algolia search ${searchRes.status}`);
  const search = await searchRes.json();
  const storyId = search?.hits?.[0]?.objectID;
  if (!storyId) throw new Error('no who-is-hiring story found');

  const itemRes = await fetch(`https://hn.algolia.com/api/v1/items/${storyId}`);
  if (!itemRes.ok) throw new Error(`algolia item ${itemRes.status}`);
  const item = await itemRes.json();

  // First 40 top-level comments, HTML stripped, capped so one request fits.
  const comments: string[] = (item?.children ?? [])
    .slice(0, 40)
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .map((html: string) =>
      html
        .replace(/<p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, 1500)
    );
  if (comments.length === 0) return [];

  const PROMPT = [
    'Below are comments from the latest Hacker News "Ask HN: Who is hiring?" thread.',
    'Extract ONLY roles plausibly relevant to undergrad students and new grads in tech:',
    'internships, new-grad software/data/hardware roles, and early-career programs.',
    'Rules:',
    '- Each item must include a direct application or company URL taken from the comment; skip any posting without a URL.',
    '- Skip senior, staff, lead, and other experienced-only roles.',
    '- Return at most 25 items.',
    '- kind is one of: internship, new-grad, program.',
    '- tags: a few short lowercase topical tags (e.g. "swe", "ai-ml", "remote-ok"); empty array if unsure.',
    '- location: a short location string, or null when the comment does not say.',
    '',
    'Comments:',
    ...comments.map((c, i) => `--- comment ${i + 1} ---\n${c}`),
  ].join('\n');

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const res = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: HN_SCHEMA } },
    messages: [{ role: 'user', content: PROMPT }],
  } as any);

  // Safety classifiers can decline a request; skip HN results in that case.
  if ((res as any).stop_reason === 'refusal') return [];

  const textBlock = (res as any).content?.find((b: any) => b.type === 'text');
  if (!textBlock?.text) return [];
  const parsed = JSON.parse(textBlock.text);
  const rows: any[] = Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];

  // HN comments are untrusted input to the model, so treat the model output
  // as untrusted too: require a parseable https URL and cap row/field sizes
  // so a hostile comment cannot flood the feed or plant odd-scheme links.
  return rows
    .filter(
      (r) =>
        typeof r?.title === 'string' &&
        typeof r?.company === 'string' &&
        typeof r?.url === 'string' &&
        isHttpsUrl(r.url) &&
        ['internship', 'new-grad', 'program'].includes(r?.kind)
    )
    .slice(0, 25)
    .map((r) => ({
      title: r.title.slice(0, 160),
      company: r.company.slice(0, 80),
      url: stripTracking(r.url),
      kind: r.kind,
      source: 'Hacker News · Who is hiring',
      tags: Array.isArray(r.tags)
        ? r.tags.filter((t: any) => typeof t === 'string').slice(0, 5).map((t: string) => t.slice(0, 40))
        : [],
      location:
        typeof r.location === 'string' && r.location ? r.location.slice(0, 80) : null,
      postedAt: null,
    }));
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

/* --------------------- Discord drop notifications ----------------------- */

const KIND_LABELS: Record<Candidate['kind'], string> = {
  internship: 'Internship',
  'new-grad': 'New grad',
  program: 'Program',
};

/**
 * Announce freshly inserted rows to the DISCORD_DROPS_WEBHOOK channel. URLs
 * ride in <angle brackets> so Discord does not unfurl an embed per link, and
 * the message stays under Discord's 2000-char limit by dropping whole lines
 * from the end (never truncating mid-line).
 */
async function notifyDiscord(webhook: string, fresh: Candidate[]): Promise<void> {
  const header = `**${fresh.length} new drop${fresh.length === 1 ? '' : 's'} just landed in the tracker**`;
  const footer = 'Browse them all: https://pipelineco.org/portal/';
  const lines = fresh.slice(0, 8).map((c) => {
    const meta = c.location ? `${KIND_LABELS[c.kind]}, ${c.location}` : KIND_LABELS[c.kind];
    return `• ${c.company} · ${c.title} (${meta}) <${c.url}>`;
  });

  const assemble = (keep: number) => {
    const parts = [header, ...lines.slice(0, keep)];
    const rest = fresh.length - keep;
    if (rest > 0) parts.push(`…and ${rest} more`);
    parts.push(footer);
    return parts.join('\n');
  };

  let keep = lines.length;
  let content = assemble(keep);
  while (keep > 0 && content.length > 1900) {
    keep -= 1;
    content = assemble(keep);
  }

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

/* ------------------------------- dedupe --------------------------------- */

/** Upper bound per run; a first run backfills a few thousand rows. */
const MAX_INSERTS = 8000;

/** Company + title + first city: the same role mirrored on several boards. */
function postingKey(c: { company: string; title: string; location: string | null }): string {
  const city = (c.location ?? '').toLowerCase().split(/[,·;•|(]/)[0].trim();
  const title = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${normCompany(c.company)}|${title}|${city}`;
}

/**
 * First sighting wins (sources arrive in priority order); later duplicates
 * merge their tags in, so a careers-page row still picks up speedyapply's
 * pay tag and Simplify's category.
 */
function dedupe(all: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  const byUrl = new Map<string, Candidate>();
  const byKey = new Map<string, Candidate>();
  for (const c of all) {
    const key = postingKey(c);
    const prior = byUrl.get(c.url) ?? byKey.get(key);
    if (prior) {
      prior.tags = [...new Set([...prior.tags, ...c.tags])].slice(0, 6);
      prior.postedAt ??= c.postedAt;
      continue;
    }
    const row = { ...c, tags: [...c.tags] };
    kept.push(row);
    byUrl.set(c.url, row);
    byKey.set(key, row);
  }
  return kept;
}

/* ------------------------------ the handler ----------------------------- */

const handler: APIRoute = async ({ request }) => {
  if (!CRON_SECRET) return json({ error: 'not_configured' }, 503);

  const auth = request.headers.get('authorization') ?? '';
  const scanSecret = request.headers.get('x-scan-secret') ?? '';
  if (auth !== `Bearer ${CRON_SECRET}` && scanSecret !== CRON_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 503);
  }

  const errors: string[] = [];

  // Each source is isolated so one failing feed never kills the whole run.
  // Listed in dedupe priority: direct careers links beat board mirrors.
  const sources: [string, () => Promise<Candidate[]>][] = [
    ['careers', scanCompanyBoards],
    ['github', scanGithubBoards],
    ['hn', scanHackerNews],
  ];
  const settled = await Promise.allSettled(sources.map(([, scan]) => scan()));
  const scanned: Record<string, number> = {};
  const all: Candidate[] = [];
  settled.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === 'fulfilled') {
      scanned[name] = r.value.length;
      all.push(...r.value);
    } else {
      errors.push(`${name}: ${r.reason?.message ?? 'failed'}`);
    }
  });

  const candidates = dedupe(all);

  let inserted = 0;
  let freshRows: Candidate[] = [];
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Everything already stored, by URL and by posting key, so a job that
    // moved boards (new URL, same role) is not inserted twice across days.
    const knownUrls = new Set<string>();
    const knownKeys = new Set<string>();
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await supa
        .from('opportunities')
        .select('url, company, title, location')
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data ?? []) {
        knownUrls.add(row.url);
        knownKeys.add(postingKey(row));
      }
      if (!data || data.length < 1000) break;
    }

    const fresh = candidates
      .filter((c) => !knownUrls.has(c.url) && !knownKeys.has(postingKey(c)))
      .slice(0, MAX_INSERTS);

    // ignoreDuplicates turns a URL race into a skip instead of a failed batch;
    // the returned rows are exactly the ones that landed.
    const landed = new Set<string>();
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await supa
        .from('opportunities')
        .upsert(
          fresh.slice(i, i + 500).map((c) => ({
            title: c.title,
            company: c.company,
            url: c.url,
            kind: c.kind,
            source: c.source,
            tags: c.tags,
            location: c.location,
            // Omitted posted_at falls back to now() in the schema.
            ...(c.postedAt ? { posted_at: c.postedAt } : {}),
          })),
          { onConflict: 'url', ignoreDuplicates: true }
        )
        .select('url');
      if (error) throw error;
      for (const row of data ?? []) landed.add(row.url);
    }
    freshRows = fresh.filter((c) => landed.has(c.url));
    inserted = freshRows.length;
  } catch (e: any) {
    errors.push(`db: ${e?.message ?? 'failed'}`);
  }

  // Announce fresh drops in Discord. Best-effort: a webhook hiccup lands in
  // errors[] but never fails the run.
  // Only roles posted in the last few days count as drops (a first run or a
  // new board backfills thousands of older rows); top picks are listed first.
  const drops = freshRows
    .filter((c) => !c.postedAt || Date.now() - Date.parse(c.postedAt) < 3 * 86_400_000)
    .sort((a, b) => Number(isTopPick(b)) - Number(isTopPick(a)));
  let notified = false;
  if (drops.length > 0 && DISCORD_DROPS_WEBHOOK) {
    try {
      await notifyDiscord(DISCORD_DROPS_WEBHOOK, drops);
      notified = true;
    } catch (e: any) {
      errors.push(`discord: ${e?.message ?? 'failed'}`);
    }
  }

  return json({
    ok: true,
    scanned,
    inserted,
    skipped: candidates.length - inserted,
    notified,
    errors,
  });
};

export const POST = handler;
export const GET = handler;
