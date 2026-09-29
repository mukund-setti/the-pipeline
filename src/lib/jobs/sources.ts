/**
 * Deterministic job sources for /api/opportunities-scan (no AI involved).
 *
 *  1. Community GitHub boards: SimplifyJobs, speedyapply (which splits its
 *     tables into FAANG+, Quant and Other and lists pay), and vanshb03 /
 *     CSCareers. Their READMEs are parsed directly.
 *  2. Company careers pages: public Greenhouse, Ashby and Lever job-board
 *     APIs for a curated set of top employers, filtered down to intern,
 *     new-grad and early-career titles in the US.
 *
 * Every source returns Candidate rows. postedAt comes from the source when it
 * says (an age column, a posted date, the ATS publish time) so "New" in the
 * portal means new at the company, not new to our scanner.
 */
import { isTopCompany, TOP_TAG } from './tiers';

export type Kind = 'internship' | 'new-grad' | 'program';

export type Candidate = {
  title: string;
  company: string;
  url: string;
  kind: Kind;
  source: string;
  tags: string[];
  location: string | null;
  /** ISO timestamp from the source; null means "first seen now". */
  postedAt: string | null;
};

const DAY_MS = 86_400_000;
/** Postings older than this at scan time are skipped as stale. */
const MAX_AGE_DAYS = 90;
const FETCH_TIMEOUT_MS = 20_000;

/* ------------------------------ helpers -------------------------------- */

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function getJson(url: string): Promise<any | null> {
  const text = await getText(url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Strip markdown/link/HTML noise from a table cell down to plain text. */
function cleanCell(cell: string): string {
  return cell
    .replace(/<br\s*\/?>|<\/br>/gi, ' · ')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [Name](url) -> Name
    .replace(/<[^>]+>/g, ' ') // html tags (badges, <a>)
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .trim();
}

/** First https URL in a cell (markdown link or <a href>), tracking removed. */
function firstUrl(cell: string): string | null {
  const match = cell.match(/https:\/\/[^\s"'<>)\]]+/);
  return match ? stripTracking(match[0]) : null;
}

/** Drop utm_* and referral params so the same posting dedupes across boards. */
export function stripTracking(raw: string): string {
  try {
    const u = new URL(raw.replace(/&amp;/g, '&'));
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith('utm') || k === 'ref' || k === 'source' || k === 'gh_src') {
        u.searchParams.delete(key);
      }
    }
    return u.toString().replace(/\?$/, '');
  } catch {
    return raw.split('?utm')[0];
  }
}

/**
 * Board titles carry eligibility emoji. Turn them into tags and strip every
 * leftover symbol from the title (🔥, 🛂, 🇺🇸, 🎓, 🔒 ...).
 */
function splitTitleFlags(raw: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  if (raw.includes('\u{1F6C2}')) tags.push('no-sponsorship'); // 🛂
  if (raw.includes('\u{1F1FA}\u{1F1F8}')) tags.push('us-citizens-only'); // 🇺🇸
  if (raw.includes('\u{1F393}')) tags.push('advanced-degree'); // 🎓
  const title = raw
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, tags };
}

/** "0d", "12d", "1mo", "3w" -> ISO timestamp that many days ago. */
function fromAge(age: string, now: number): string | null {
  const m = age.trim().match(/^(\d+)\s*(d|w|mo|m|y)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const days = unit === 'd' ? n : unit === 'w' ? n * 7 : unit === 'y' ? n * 365 : n * 30;
  return new Date(now - days * DAY_MS).toISOString();
}

/** "Aug 21" (no year) -> the most recent past Aug 21. */
function fromMonthDay(text: string, now: number): string | null {
  const m = text.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2})$/);
  if (!m) return null;
  const year = new Date(now).getUTCFullYear();
  let t = Date.parse(`${m[1]} ${m[2]}, ${year} 12:00 UTC`);
  if (Number.isNaN(t)) return null;
  if (t > now + DAY_MS) t = Date.parse(`${m[1]} ${m[2]}, ${year - 1} 12:00 UTC`);
  return new Date(t).toISOString();
}

function isStale(postedAt: string | null, now: number): boolean {
  return !!postedAt && now - Date.parse(postedAt) > MAX_AGE_DAYS * DAY_MS;
}

/** Section heading -> topical tag, shared by every board's category headers. */
function sectionTag(heading: string): string | null {
  const h = heading.toLowerCase();
  if (h.includes('product')) return 'pm';
  if (/data|machine learning|\bai\b/.test(h)) return 'ai-ml';
  if (h.includes('quant')) return 'quant';
  if (h.includes('hardware')) return 'hardware';
  if (h.includes('software')) return 'swe';
  return null;
}

function finish(c: Candidate): Candidate {
  const tags = new Set(c.tags);
  if (isTopCompany(c.company)) tags.add(TOP_TAG);
  return {
    ...c,
    title: c.title.slice(0, 160),
    company: c.company.slice(0, 80),
    location: c.location ? c.location.slice(0, 80) : null,
    tags: [...tags].slice(0, 6),
  };
}

/* --------------------------- SimplifyJobs ------------------------------ */

/**
 * Simplify renders boards as HTML tables (<tr><td>Company</td><td>Role</td>
 * <td>Location</td><td>Application</td><td>Age</td></tr>) under one "##"
 * heading per category. `↳` or an empty company cell means "same company as
 * the previous row", 🔒 marks closed postings, and 🔥 marks the roles
 * Simplify flags as top picks.
 */
function parseSimplify(md: string, kind: Kind, now: number): Candidate[] {
  const out: Candidate[] = [];
  let lastCompany = '';
  let category: string | null = null;
  const token = /^##\s+(.+)$|<tr>([\s\S]*?)<\/tr>/gm;
  for (const m of md.matchAll(token)) {
    if (m[1]) {
      category = sectionTag(m[1]);
      continue;
    }
    const row = m[2];
    if (row.includes('<th')) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const companyText = cleanCell(cells[0]).replace(/^[^\p{L}\p{N}]+/u, '');
    const company = !companyText || companyText === '↳' ? lastCompany : companyText;
    if (!company) continue;
    lastCompany = company;
    if (row.includes('\u{1F512}')) continue; // 🔒 closed posting
    const { title, tags } = splitTitleFlags(cleanCell(cells[1]));
    // The application cell is <a href="apply-url"><img ...>, so the first
    // https URL in it is the apply link, not a badge image.
    const url = firstUrl(cells[3]);
    const postedAt = cells[4] ? fromAge(cleanCell(cells[4]), now) : null;
    if (!title || !url || isStale(postedAt, now)) continue;
    if (category) tags.push(category);
    if (cells[0].includes('\u{1F525}')) tags.push(TOP_TAG); // 🔥
    out.push(
      finish({
        title,
        company,
        url,
        kind,
        source: 'Simplify · GitHub',
        tags,
        location: cleanCell(cells[2]) || null,
        postedAt,
      })
    );
  }
  return out;
}

/* ------------------- markdown pipe-table boards ------------------------ */

/**
 * speedyapply and vanshb03 publish markdown pipe tables. Columns are mapped
 * from each table's own header row, so either layout works:
 *   | Company | Position | Location | Salary | Posting | Age |
 *   | Company | Role | Location | Application/Link | Date Posted |
 * speedyapply groups tables under "### FAANG+", "### Quant" and "### Other";
 * the first two mark rows as top picks.
 */
function parsePipeTables(md: string, kind: Kind, source: string, now: number): Candidate[] {
  const out: Candidate[] = [];
  let lastCompany = '';
  let cols: Record<string, number> | null = null;
  let boardTag: string | null = null;
  let sectionTags: string[] = [];
  for (const line of md.split('\n')) {
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const h = heading[2].toLowerCase();
      sectionTags = [];
      if (heading[1].length === 2) {
        // "## 2027 USA AI Internships": a topical tag for the whole board.
        boardTag = sectionTag(h);
      } else {
        if (h.includes('faang')) sectionTags.push(TOP_TAG);
        if (h.includes('quant')) sectionTags.push(TOP_TAG, 'quant');
      }
      cols = null;
      continue;
    }
    if (!line.trimStart().startsWith('|')) {
      if (line.trim()) cols = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // |---| row
    const names = cells.map((c) => cleanCell(c).toLowerCase());
    if (names.includes('company')) {
      const find = (...keys: string[]) => names.findIndex((n) => keys.some((k) => n.startsWith(k)));
      cols = {
        company: find('company'),
        title: find('role', 'position', 'title'),
        location: find('location'),
        salary: find('salary', 'pay'),
        link: find('posting', 'application', 'link', 'apply'),
        age: find('age', 'date'),
      };
      continue;
    }
    if (!cols || cols.company < 0 || cols.title < 0 || cols.link < 0) continue;
    if (line.includes('\u{1F512}')) continue; // 🔒 closed
    const companyText = cleanCell(cells[cols.company] ?? '').replace(/^[^\p{L}\p{N}]+/u, '');
    const company = !companyText || companyText === '↳' ? lastCompany : companyText;
    if (!company) continue;
    lastCompany = company;
    const { title, tags } = splitTitleFlags(cleanCell(cells[cols.title] ?? ''));
    const url = firstUrl(cells[cols.link] ?? '');
    const ageText = cols.age >= 0 ? cleanCell(cells[cols.age] ?? '') : '';
    const postedAt = fromAge(ageText, now) ?? fromMonthDay(ageText, now);
    if (!title || !url || isStale(postedAt, now)) continue;
    const salary = cols.salary >= 0 ? cleanCell(cells[cols.salary] ?? '') : '';
    if (salary.startsWith('$')) tags.push(salary.replace(/\s+/g, '').slice(0, 16));
    out.push(
      finish({
        title,
        company,
        url,
        kind,
        source,
        tags: [...tags, ...sectionTags, ...(boardTag ? [boardTag] : [])],
        location: cols.location >= 0 ? cleanCell(cells[cols.location] ?? '') || null : null,
        postedAt,
      })
    );
  }
  return out;
}

/* --------------------------- board registry ---------------------------- */

const GH = 'https://raw.githubusercontent.com';

type Board = {
  /** Mirrors tried in order; the first reachable one is parsed. */
  urls: string[];
  kind: Kind;
  parse: (md: string, kind: Kind, now: number) => Candidate[];
};

const simplify = parseSimplify;
const speedy = (md: string, kind: Kind, now: number) =>
  parsePipeTables(md, kind, 'speedyapply · GitHub', now);
const vansh = (md: string, kind: Kind, now: number) =>
  parsePipeTables(md, kind, 'CSCareers · GitHub', now);

const BOARDS: Board[] = [
  {
    urls: [
      `${GH}/SimplifyJobs/Summer2027-Internships/dev/README.md`,
      `${GH}/SimplifyJobs/Summer2026-Internships/dev/README.md`,
    ],
    kind: 'internship',
    parse: simplify,
  },
  {
    urls: [`${GH}/SimplifyJobs/Summer2027-Internships/dev/README-Off-Season.md`],
    kind: 'internship',
    parse: simplify,
  },
  { urls: [`${GH}/SimplifyJobs/New-Grad-Positions/dev/README.md`], kind: 'new-grad', parse: simplify },
  { urls: [`${GH}/speedyapply/2027-SWE-College-Jobs/main/README.md`], kind: 'internship', parse: speedy },
  { urls: [`${GH}/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md`], kind: 'new-grad', parse: speedy },
  { urls: [`${GH}/speedyapply/2027-AI-College-Jobs/main/README.md`], kind: 'internship', parse: speedy },
  { urls: [`${GH}/speedyapply/2027-AI-College-Jobs/main/NEW_GRAD_USA.md`], kind: 'new-grad', parse: speedy },
  { urls: [`${GH}/vanshb03/Summer2027-Internships/dev/README.md`], kind: 'internship', parse: vansh },
  {
    urls: [`${GH}/vanshb03/New-Grad-2027/dev/README.md`, `${GH}/vanshb03/New-Grad-2026/dev/README.md`],
    kind: 'new-grad',
    parse: vansh,
  },
];

export async function scanGithubBoards(now = Date.now()): Promise<Candidate[]> {
  const results = await Promise.all(
    BOARDS.map(async (b) => {
      for (const url of b.urls) {
        const md = await getText(url);
        if (md) return b.parse(md, b.kind, now);
      }
      return [];
    })
  );
  return results.flat();
}

/* ------------------------ company careers pages ------------------------ */

type Ats = 'greenhouse' | 'ashby' | 'lever';
type Employer = { ats: Ats; token: string; company: string };

/**
 * Top employers with public job-board APIs. Tokens were checked live; a
 * token that starts 404ing just contributes nothing until it is fixed here.
 */
const EMPLOYERS: Employer[] = [
  ...(
    [
      ['stripe', 'Stripe'], ['databricks', 'Databricks'], ['figma', 'Figma'],
      ['airbnb', 'Airbnb'], ['robinhood', 'Robinhood'], ['discord', 'Discord'],
      ['anthropic', 'Anthropic'], ['coinbase', 'Coinbase'], ['cloudflare', 'Cloudflare'],
      ['scaleai', 'Scale AI'], ['pinterest', 'Pinterest'], ['lyft', 'Lyft'],
      ['dropbox', 'Dropbox'], ['reddit', 'Reddit'], ['instacart', 'Instacart'],
      ['asana', 'Asana'], ['roblox', 'Roblox'], ['samsara', 'Samsara'], ['brex', 'Brex'],
      ['janestreet', 'Jane Street'], ['imc', 'IMC Trading'], ['point72', 'Point72'],
      ['mongodb', 'MongoDB'], ['datadog', 'Datadog'], ['waymo', 'Waymo'],
      ['andurilindustries', 'Anduril'], ['jumptrading', 'Jump Trading'],
      ['towerresearchcapital', 'Tower Research Capital'], ['doordashusa', 'DoorDash'],
      ['affirm', 'Affirm'], ['chime', 'Chime'], ['nuro', 'Nuro'], ['verkada', 'Verkada'],
      ['duolingo', 'Duolingo'], ['twilio', 'Twilio'], ['okta', 'Okta'],
      ['akunacapital', 'Akuna Capital'], ['virtu', 'Virtu Financial'],
    ] as const
  ).map(([token, company]) => ({ ats: 'greenhouse' as const, token, company })),
  ...(
    [
      ['openai', 'OpenAI'], ['notion', 'Notion'], ['ramp', 'Ramp'], ['plaid', 'Plaid'],
      ['linear', 'Linear'], ['perplexity', 'Perplexity'], ['replit', 'Replit'],
      ['cursor', 'Cursor'], ['snowflake', 'Snowflake'], ['sierra', 'Sierra'],
      ['harvey', 'Harvey'], ['elevenlabs', 'ElevenLabs'], ['cohere', 'Cohere'],
      ['modal', 'Modal'], ['supabase', 'Supabase'],
    ] as const
  ).map(([token, company]) => ({ ats: 'ashby' as const, token, company })),
  ...(
    [
      ['palantir', 'Palantir'], ['spotify', 'Spotify'],
    ] as const
  ).map(([token, company]) => ({ ats: 'lever' as const, token, company })),
];

const EARLY_CAREER =
  /\b(intern(ship)?s?|co-?op|new grad(uate)?s?|university grad(uate)?|graduate (software|engineer|program)|early[- ]career|entry[- ]level|campus|apprentice(ship)?|fellow(ship)?|residency|summer 20\d\d|20\d\d start)\b/i;
const NOT_EARLY =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|recruit(er|ing)|talent community|ph\.?d|mba|postdoc(toral)?)\b/i;

const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
/** State codes and "US" match case-sensitively so words like "in" never count. */
const US_CODES = new RegExp(`\\b(US|USA|U\\.S\\.|${US_STATES})\\b`);
const US_PLACES =
  /\b(united states|san francisco|new york|nyc|seattle|austin|boston|chicago|los angeles|mountain view|palo alto|menlo park|sunnyvale|san jose|san mateo|redmond|bellevue|denver|atlanta|miami|washington|pittsburgh|philadelphia|san diego|irvine|costa mesa|salt lake|portland|dallas|houston|raleigh)\b/i;
const NON_US =
  /\b(london|dublin|toronto|vancouver|montreal|canada|singapore|india|bengaluru|bangalore|hyderabad|tokyo|japan|paris|france|amsterdam|netherlands|berlin|germany|munich|sydney|australia|europe|emea|apac|latam|mexico|brazil|uk|united kingdom|ireland|hong kong|shanghai|china|korea|seoul|tel aviv|israel|zurich|switzerland|poland|warsaw|spain|madrid|sweden|stockholm|denmark|aarhus)\b/i;

/** Keep US and plain-remote roles; the community applies from UC campuses. */
function looksUS(location: string, country?: string | null): boolean {
  if (country) return /^(us|usa|united states)$/i.test(country.trim());
  if (US_CODES.test(location) || US_PLACES.test(location)) return true;
  return /\bremote\b/i.test(location) && !NON_US.test(location);
}

function kindForTitle(title: string): Kind {
  if (/\b(intern(ship)?s?|co-?op)\b/i.test(title)) return 'internship';
  if (/\b(fellow(ship)?|apprentice(ship)?|residency|program|academy)\b/i.test(title)) return 'program';
  return 'new-grad';
}

type AtsJob = {
  title: string;
  url: string;
  location: string;
  country?: string | null;
  postedAt: string | null;
};

async function fetchAts(e: Employer): Promise<AtsJob[]> {
  if (e.ats === 'greenhouse') {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${e.token}/jobs`);
    return (data?.jobs ?? []).map((j: any) => ({
      title: String(j?.title ?? ''),
      url: String(j?.absolute_url ?? ''),
      location: String(j?.location?.name ?? ''),
      postedAt: j?.first_published ?? j?.updated_at ?? null,
    }));
  }
  if (e.ats === 'ashby') {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${e.token}`);
    return (data?.jobs ?? [])
      .filter((j: any) => j?.isListed !== false)
      .map((j: any) => ({
        // Ashby's employmentType "Intern" catches titles without the word.
        title:
          j?.employmentType === 'Intern' && !/intern/i.test(j?.title ?? '')
            ? `${j.title} (Intern)`
            : String(j?.title ?? ''),
        url: String(j?.jobUrl ?? ''),
        location: [j?.location, ...(j?.secondaryLocations ?? []).map((s: any) => s?.location)]
          .filter(Boolean)
          .join(' · '),
        country: j?.address?.postalAddress?.addressCountry ?? null,
        postedAt: j?.publishedAt ?? null,
      }));
  }
  const data = await getJson(`https://api.lever.co/v0/postings/${e.token}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: any) => ({
    title: String(j?.text ?? ''),
    url: String(j?.hostedUrl ?? ''),
    location: (j?.categories?.allLocations ?? [j?.categories?.location]).filter(Boolean).join(' · '),
    country: j?.country ?? null,
    postedAt: typeof j?.createdAt === 'number' ? new Date(j.createdAt).toISOString() : null,
  }));
}

/** Listed ATS jobs are open by definition, so there is no staleness cut here. */
export async function scanCompanyBoards(): Promise<Candidate[]> {
  const results = await Promise.all(
    EMPLOYERS.map(async (e) => {
      const jobs = await fetchAts(e).catch(() => [] as AtsJob[]);
      return jobs
        .filter(
          (j) =>
            j.title &&
            j.url.startsWith('https://') &&
            EARLY_CAREER.test(j.title) &&
            !NOT_EARLY.test(j.title) &&
            looksUS(j.location, j.country)
        )
        .map((j) =>
          finish({
            title: j.title,
            company: e.company,
            url: stripTracking(j.url),
            kind: kindForTitle(j.title),
            source: `${e.company} careers`,
            tags: [TOP_TAG],
            location: j.location || null,
            postedAt: j.postedAt,
          })
        );
    })
  );
  return results.flat();
}
