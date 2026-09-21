import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { deriveTags } from '../../lib/portal/recommend';

/**
 * Opportunity scanner: the engine behind the portal's "AI-tracked" surface.
 * Vercel Cron hits this daily (see vercel.json) and it refills the public
 * `opportunities` table from two sources:
 *
 *  1. Simplify's GitHub boards (deterministic): the internship and new-grad
 *     README tables are parsed directly, no AI involved.
 *  2. Hacker News "Ask HN: Who is hiring?" (AI-extracted): the latest thread's
 *     top-level comments are handed to Claude in one request, which returns a
 *     strict JSON list of undergrad/new-grad-relevant roles with URLs.
 *
 * Security model: the Supabase service-role key lives only in server env vars
 * and never ships to the client; the endpoint itself is gated by CRON_SECRET
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
 * that env var exists). Rows are insert-only and deduped by URL, so the "New"
 * chip in the portal stays honest: a row's posted_at is the first time the
 * scanner saw it.
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

type Candidate = {
  title: string;
  company: string;
  url: string;
  kind: 'internship' | 'new-grad' | 'program';
  source: string;
  tags: string[];
  location: string | null;
};

/* --------------------------- shared text helpers ------------------------ */

/** Strip markdown/link/HTML noise from a table cell down to plain text. */
function cleanCell(cell: string): string {
  return cell
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [Name](url) -> Name
    .replace(/<[^>]+>/g, ' ') // html tags (badges, <br>, <a>)
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First https URL in a cell (markdown link or <a href>), utm params removed. */
function firstUrl(cell: string): string | null {
  const match = cell.match(/https:\/\/[^\s"'<>)\]]+/);
  if (!match) return null;
  return stripUtm(match[0]);
}

function stripUtm(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm')) u.searchParams.delete(key);
    }
    return u.toString().replace(/\?$/, '');
  } catch {
    return raw.split('?utm')[0];
  }
}

/* ---------------------- source 1: Simplify GitHub ----------------------- */

const INTERNSHIP_READMES = [
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md',
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md',
];
const NEW_GRAD_READMES = [
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md',
];

async function fetchFirstReachable(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

/**
 * Parse a Simplify README. The repos now render their boards as HTML tables
 * (<tr><td>Company</td><td>Role</td><td>Location</td><td>Application</td>
 * <td>Age</td></tr>); older revisions used markdown pipe tables, kept below
 * as a fallback. In both formats `↳` (or an empty company cell) means "same
 * company as the previous row" and 🔒 marks closed postings. Rows are
 * newest-first, so the first 60 parsed rows are the fresh ones.
 */
function parseSimplifyReadme(md: string, kind: 'internship' | 'new-grad'): Candidate[] {
  const html = parseHtmlRows(md, kind);
  return html.length ? html : parseMarkdownRows(md, kind);
}

function parseHtmlRows(md: string, kind: 'internship' | 'new-grad'): Candidate[] {
  const out: Candidate[] = [];
  let lastCompany = '';
  for (const rowMatch of md.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    if (out.length >= 60) break;
    const row = rowMatch[1];
    if (row.includes('<th')) continue; // header row
    if (row.includes('\u{1F512}')) continue; // 🔒 closed posting
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/&amp;/g, '&').replace(/<br\s*\/?>/g, ' · ')
    );
    if (cells.length < 4) continue;
    // cleanCell leaves emoji like the 🔥 "popular" marker; trim leading symbols.
    const companyText = cleanCell(cells[0]).replace(/^[^\p{L}\p{N}]+/u, '');
    const company = !companyText || companyText === '↳' ? lastCompany : companyText;
    if (!company) continue;
    lastCompany = company;
    const title = cleanCell(cells[1]);
    const location = cleanCell(cells[2]) || null;
    // The application cell is <a href="apply-url"><img ...>, so the first
    // https URL in it is the apply link, not a badge image.
    const url = firstUrl(cells[3]);
    if (!title || !url) continue;
    out.push({
      title,
      company,
      url,
      kind,
      source: 'Simplify · GitHub',
      tags: [],
      location,
    });
  }
  return out;
}

function parseMarkdownRows(md: string, kind: 'internship' | 'new-grad'): Candidate[] {
  const out: Candidate[] = [];
  let lastCompany = '';
  for (const line of md.split('\n')) {
    if (out.length >= 60) break;
    if (!line.trimStart().startsWith('|')) continue;
    if (line.includes('\u{1F512}')) continue; // 🔒 closed posting
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const companyText = cleanCell(cells[0]);
    // Skip the header row and the |---| separator row.
    if (/^company$/i.test(companyText)) continue;
    if (/^:?-{2,}:?$/.test(cells[0])) continue;
    const company =
      !companyText || companyText === '↳' ? lastCompany : companyText;
    if (!company) continue;
    lastCompany = company;
    const title = cleanCell(cells[1]);
    const location = cleanCell(cells[2]) || null;
    const url = firstUrl(cells[3]);
    if (!title || !url) continue;
    out.push({
      title,
      company,
      url,
      kind,
      source: 'Simplify · GitHub',
      tags: [],
      location,
    });
  }
  return out;
}

async function scanGithub(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const internMd = await fetchFirstReachable(INTERNSHIP_READMES);
  if (internMd) candidates.push(...parseSimplifyReadme(internMd, 'internship'));
  const gradMd = await fetchFirstReachable(NEW_GRAD_READMES);
  if (gradMd) candidates.push(...parseSimplifyReadme(gradMd, 'new-grad'));
  return candidates;
}

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
      url: stripUtm(r.url),
      kind: r.kind,
      source: 'Hacker News · Who is hiring',
      tags: Array.isArray(r.tags)
        ? r.tags.filter((t: any) => typeof t === 'string').slice(0, 5).map((t: string) => t.slice(0, 40))
        : [],
      location:
        typeof r.location === 'string' && r.location ? r.location.slice(0, 80) : null,
    }));
}

/* --------------------------- tag enrichment ----------------------------- */

/**
 * Simplify's boards give us a title, a company and a location, and nothing
 * else, so rows from that source used to land with `tags: []`. Tags are what
 * the portal's "For you" recommender matches a member's resume against
 * (src/lib/portal/recommend.ts), so an untagged row can only ever match on its
 * title, and a feed full of "Software Engineer Intern" ranks flat for everyone.
 *
 * Two passes fill them in:
 *   1. Deterministic: run the recommender's own lexicon over the title and
 *      location. Free, instant, and it catches the specific titles
 *      ("Machine Learning Intern" -> ai-ml).
 *   2. Company domains, via one batched Claude call. This is the pass that
 *      adds information the row does not already contain: Capital One is a
 *      bank, NVIDIA builds hardware. Titles cannot tell us that.
 *
 * Deliberately NOT done: asking a model to invent skill tags for a bare
 * "Software Engineer Intern". It would be guessing, and the recommender
 * renders tags as the "Why:" chips a member reads as fact. A row with nothing
 * to say keeps saying nothing.
 */

/** Closed vocabulary for pass 2. Every entry is a concept the recommender knows. */
const DOMAIN_TAGS = [
  'ai-ml',
  'data',
  'hardware',
  'embedded',
  'systems',
  'cloud',
  'security',
  'mobile',
  'fintech',
  'frontend',
  'backend',
  'research',
] as const;

const MAX_TAGS = 5;
/** Companies classified per run. One call; new companies only. */
const MAX_COMPANIES = 80;
/** Pre-existing untagged rows repaired per run. */
const BACKFILL_LIMIT = 100;

const COMPANY_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string', enum: DOMAIN_TAGS } },
        },
        required: ['name', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['companies'],
  additionalProperties: false,
} as const;

/**
 * Ask Claude what each company works on. Returns an empty map when the key is
 * missing or the call fails: enrichment is an improvement, never a dependency,
 * and the scanner must still run without it.
 */
async function classifyCompanies(names: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ANTHROPIC_API_KEY || names.length === 0) return out;

  const list = names.slice(0, MAX_COMPANIES);
  const PROMPT = [
    'Classify each company by the technical domains it is known for.',
    'Rules:',
    `- Use ONLY these tags: ${DOMAIN_TAGS.join(', ')}.`,
    '- At most 3 tags per company, fewest that are clearly true.',
    '- Return an empty tags array when you do not recognise the company or it has no clear domain. Do not guess.',
    '- Tag what the company builds, not what a job there might involve.',
    '- Echo each name back exactly as given.',
    '',
    'Companies:',
    ...list.map((n) => `- ${n}`),
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: COMPANY_SCHEMA } },
      messages: [{ role: 'user', content: PROMPT }],
    } as any);
    if ((res as any).stop_reason === 'refusal') return out;
    const textBlock = (res as any).content?.find((b: any) => b.type === 'text');
    if (!textBlock?.text) return out;
    const rows: any[] = JSON.parse(textBlock.text)?.companies ?? [];
    // Company names come from scraped pages, so validate the echo rather than
    // trusting it: only names we asked about, only tags in the vocabulary.
    const asked = new Map(list.map((n) => [n.toLowerCase(), n]));
    for (const r of rows) {
      const name = asked.get(String(r?.name ?? '').toLowerCase());
      if (!name || !Array.isArray(r.tags)) continue;
      const tags = r.tags.filter((t: any) => (DOMAIN_TAGS as readonly string[]).includes(t));
      if (tags.length) out.set(name, tags.slice(0, 3));
    }
  } catch {
    // Model unavailable or malformed output: rows keep their text-derived tags.
  }
  return out;
}

/** Fill in tags for a batch of rows, in place of the source's empty arrays. */
async function enrichTags(candidates: Candidate[]): Promise<void> {
  const needsCompany = [...new Set(candidates.map((c) => c.company))].filter(Boolean);
  const domains = await classifyCompanies(needsCompany);
  for (const c of candidates) {
    const merged = new Set([
      ...c.tags,
      ...deriveTags(c.title, c.location),
      ...(domains.get(c.company) ?? []),
    ]);
    c.tags = [...merged].slice(0, MAX_TAGS);
  }
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
  const scanned = { github: 0, hn: 0 };
  let github: Candidate[] = [];
  let hn: Candidate[] = [];

  // Each source is isolated so one failing feed never kills the whole run.
  try {
    github = await scanGithub();
    scanned.github = github.length;
  } catch (e: any) {
    errors.push(`github: ${e?.message ?? 'failed'}`);
  }
  try {
    hn = await scanHackerNews();
    scanned.hn = hn.length;
  } catch (e: any) {
    errors.push(`hn: ${e?.message ?? 'failed'}`);
  }

  // Dedupe within the batch by URL (first sighting wins).
  const byUrl = new Map<string, Candidate>();
  for (const c of [...github, ...hn]) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const candidates = [...byUrl.values()];

  let inserted = 0;
  let tagged = 0;
  let backfilled = 0;
  let freshRows: Candidate[] = [];
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Which of these URLs do we already know? Checked in batches to keep the
    // .in() filter a reasonable size. Rows are never updated afterwards, so a
    // posting's posted_at stays its first-seen date and "New" stays honest.
    const existing = new Set<string>();
    const urls = candidates.map((c) => c.url);
    for (let i = 0; i < urls.length; i += 100) {
      const batch = urls.slice(i, i + 100);
      const { data, error } = await supa
        .from('opportunities')
        .select('url')
        .in('url', batch);
      if (error) throw error;
      for (const row of data ?? []) existing.add(row.url);
    }

    const fresh = candidates.filter((c) => !existing.has(c.url)).slice(0, 100);
    // Enrich only the rows about to be inserted, so the company-classification
    // call scales with new postings rather than the whole board.
    if (fresh.length > 0) {
      try {
        await enrichTags(fresh);
        tagged = fresh.filter((c) => c.tags.length > 0).length;
      } catch (e: any) {
        errors.push(`tags: ${e?.message ?? 'failed'}`);
      }
    }
    if (fresh.length > 0) {
      const { error } = await supa.from('opportunities').insert(
        fresh.map((c) => ({
          title: c.title,
          company: c.company,
          url: c.url,
          kind: c.kind,
          source: c.source,
          tags: c.tags,
          location: c.location,
          // posted_at defaults to now() in the schema.
        }))
      );
      if (error) throw error;
      inserted = fresh.length;
      freshRows = fresh;
    }

    // Backfill: rows stored before tagging existed have empty tags and are
    // invisible to the recommender. Update a bounded slice per run (tags only,
    // never posted_at, so the "New" chip stays honest) until the table is
    // caught up. Best-effort; a failure here never fails the scan.
    try {
      const { data: stale } = await supa
        .from('opportunities')
        .select('id, title, company, url, kind, source, tags, location')
        .or('tags.is.null,tags.eq.{}')
        .limit(BACKFILL_LIMIT);
      const rows = (stale ?? []) as any[];
      if (rows.length) {
        const batch: Candidate[] = rows.map((r) => ({
          title: r.title,
          company: r.company,
          url: r.url,
          kind: r.kind,
          source: r.source,
          tags: [],
          location: r.location,
        }));
        await enrichTags(batch);
        for (let i = 0; i < rows.length; i++) {
          if (batch[i].tags.length === 0) continue;
          const { error } = await supa
            .from('opportunities')
            .update({ tags: batch[i].tags })
            .eq('id', rows[i].id);
          if (!error) backfilled++;
        }
      }
    } catch (e: any) {
      errors.push(`backfill: ${e?.message ?? 'failed'}`);
    }
  } catch (e: any) {
    errors.push(`db: ${e?.message ?? 'failed'}`);
  }

  // Announce fresh drops in Discord. Best-effort: a webhook hiccup lands in
  // errors[] but never fails the run.
  let notified = false;
  if (inserted > 0 && DISCORD_DROPS_WEBHOOK) {
    try {
      await notifyDiscord(DISCORD_DROPS_WEBHOOK, freshRows);
      notified = true;
    } catch (e: any) {
      errors.push(`discord: ${e?.message ?? 'failed'}`);
    }
  }

  return json({
    ok: true,
    scanned,
    inserted,
    tagged,
    backfilled,
    skipped: candidates.length - inserted,
    notified,
    errors,
  });
};

export const POST = handler;
export const GET = handler;
