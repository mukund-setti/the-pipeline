/**
 * Opportunities island: the AI-tracked jobs surface at /portal/<school>/opportunities.
 * Rows come from the shared portal store (Supabase when live, seeded samples
 * otherwise); the serverless scanner at /api/opportunities-scan refreshes the
 * table daily from Simplify's GitHub boards and Hacker News hiring threads.
 * Members can filter by kind, search, mark rows saved or applied, and hand a
 * natural-language query to /api/opportunities-search ("Ask AI"), which
 * returns a structured filter layer. When that endpoint is unavailable (demo
 * session, missing key, network trouble) the same query is parsed locally so
 * the button always does something.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  JobAction,
  JobActionMap,
  Opportunity,
  OpportunityKind,
  ResumeInfo,
} from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';
import type { PortalStore } from '../../lib/portal/data';
import { getSupabase } from '../../lib/supabase';

type KindFilter = 'all' | OpportunityKind;

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'internship', label: 'Internships' },
  { key: 'new-grad', label: 'New grad' },
  { key: 'program', label: 'Programs' },
];

const ACTION_FILTERS: { key: JobAction; label: string }[] = [
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
];

const KIND_LABELS: Record<OpportunityKind, string> = {
  internship: 'Internship',
  'new-grad': 'New grad',
  program: 'Program',
};

const DAY_MS = 86_400_000;

/** Tiny relative-time formatter: "just now", "12m", "3h", "2d", "5w". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 3 * DAY_MS;
}

/* ------------------------------ AI filter ------------------------------ */

/** The structured filter layer applied by "Ask AI" (server or local parse). */
type AiFilter = {
  kinds: OpportunityKind[];
  keywords: string[];
  remote: boolean | null;
  newOnly: boolean;
  explanation: string;
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'me', 'in', 'of', 'show', 'find',
  'jobs', 'roles', 'with', 'that', 'are',
]);

/** Coerce whatever the endpoint returned into a safe AiFilter shape. */
function normalizeFilters(raw: unknown, explanation: string): AiFilter {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kinds = Array.isArray(r.kinds)
    ? (r.kinds.filter(
        (k) => k === 'internship' || k === 'new-grad' || k === 'program'
      ) as OpportunityKind[])
    : [];
  const keywords = Array.isArray(r.keywords)
    ? r.keywords
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim().toLowerCase())
    : [];
  const remote = r.remote === true ? true : r.remote === false ? false : null;
  return { kinds, keywords, remote, newOnly: r.newOnly === true, explanation };
}

/**
 * Offline fallback parser: kind terms, remote, recency words, and whatever is
 * left (minus stopwords) becomes keywords. Kind phrases are consumed before
 * the recency check so "new grad" does not read as "posted recently".
 */
function parseQueryLocally(q: string): AiFilter {
  let text = q.toLowerCase();
  const kinds: OpportunityKind[] = [];
  const take = (re: RegExp, kind: OpportunityKind) => {
    if (re.test(text)) {
      kinds.push(kind);
      text = text.replace(new RegExp(re.source, 'g'), ' ');
    }
  };
  take(/new.?grads?|full.?time/, 'new-grad');
  take(/intern\w*/, 'internship');
  take(/program\w*|fellowship\w*/, 'program');

  const remote = /remote/.test(text) ? true : null;
  text = text.replace(/remote\w*/g, ' ');

  const newOnly = /\b(new|recent\w*|latest|today)\b/.test(text);
  text = text.replace(/\b(new|recent\w*|latest|today)\b/g, ' ');

  const keywords = Array.from(
    new Set(
      text
        .split(/[^a-z0-9+#.-]+/)
        .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    )
  ).slice(0, 8);

  const parts: string[] = [];
  for (const k of kinds) {
    parts.push(k === 'internship' ? 'internships' : k === 'new-grad' ? 'new grad' : 'programs');
  }
  if (remote === true) parts.push('remote');
  if (newOnly) parts.push('posted recently');
  if (keywords.length) parts.push(keywords.join(', '));
  const explanation = parts.length
    ? 'Filtered locally: ' + parts.join(', ')
    : 'Filtered locally: nothing specific recognized';
  return { kinds, keywords, remote, newOnly, explanation };
}

/**
 * Ask the serverless endpoint to turn the query into filters. Any miss
 * (no session, 503, network trouble, odd response) falls back to the local
 * parser so the member always gets a result.
 */
async function fetchAiFilter(q: string): Promise<AiFilter> {
  try {
    const supa = getSupabase();
    if (!supa) return parseQueryLocally(q);
    const { data } = await supa.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return parseQueryLocally(q);
    const res = await fetch('/api/opportunities-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ q: q.slice(0, 200) }),
    });
    if (!res.ok) return parseQueryLocally(q);
    const body = await res.json();
    const explanation =
      typeof body?.explanation === 'string' && body.explanation.trim()
        ? body.explanation.trim()
        : 'AI filter applied';
    return normalizeFilters(body?.filters, explanation);
  } catch {
    return parseQueryLocally(q);
  }
}

/* ---------------------------- mark helpers ----------------------------- */

/** Immutable update of the saved/applied map; drops empty entries. */
function withMark(map: JobActionMap, id: string, action: JobAction, on: boolean): JobActionMap {
  const entry = { ...(map[id] ?? {}) };
  if (on) entry[action] = true;
  else delete entry[action];
  const next = { ...map };
  if (entry.saved || entry.applied) next[id] = entry;
  else delete next[id];
  return next;
}

/* ------------------------------ component ------------------------------ */

export default function OpportunitiesApp({ school }: { school: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [actions, setActions] = useState<JobActionMap>({});
  const [actionFilter, setActionFilter] = useState<JobAction | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  /** undefined = still loading, null = none on file. */
  const [resume, setResume] = useState<ResumeInfo | null | undefined>(undefined);
  const [aiFilter, setAiFilter] = useState<AiFilter | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const storeRef = useRef<PortalStore | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      if (portal.notice === 'setup-required') {
        window.dispatchEvent(new CustomEvent('portal:notice'));
      }
      storeRef.current = portal.store;
      const [rows, marks, resumeInfo] = await Promise.all([
        portal.store.listOpportunities(),
        portal.store.listActions().catch(() => ({}) as JobActionMap),
        portal.store.getResume().catch(() => null),
      ]);
      if (cancelled) return;
      setOpportunities(rows);
      setActions(marks);
      setResume(resumeInfo);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(noteTimer.current);
    };
  }, [school]);

  const showActionNote = (msg: string) => {
    setActionNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setActionNote(null), 5000);
  };

  /** Optimistic toggle; reverts and leaves a quiet note if the write fails. */
  const toggleAction = (id: string, action: JobAction) => {
    const store = storeRef.current;
    if (!store || (id.startsWith('seed-') && store.live)) return;
    const on = !actions[id]?.[action];
    setActions((prev) => withMark(prev, id, action, on));
    store.setAction(id, action, on).catch(() => {
      setActions((prev) => withMark(prev, id, action, !on));
      showActionNote('That mark did not save. Check your connection and try again.');
    });
  };

  const askAi = async () => {
    const q = query.trim();
    if (!q || aiLoading) return;
    setAiLoading(true);
    const filter = await fetchAiFilter(q);
    setAiFilter(filter);
    setQuery('');
    setAiLoading(false);
  };

  const savedCount = useMemo(
    () => opportunities.filter((o) => actions[o.id]?.saved).length,
    [opportunities, actions]
  );
  const appliedCount = useMemo(
    () => opportunities.filter((o) => actions[o.id]?.applied).length,
    [opportunities, actions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return opportunities
      .filter((o) => {
        if (!aiFilter) return true;
        if (aiFilter.kinds.length && !aiFilter.kinds.includes(o.kind)) return false;
        const loc = (o.location ?? '').toLowerCase();
        if (aiFilter.remote === true && !loc.includes('remote')) return false;
        if (aiFilter.remote === false && loc.includes('remote')) return false;
        if (aiFilter.newOnly && !isNew(o.postedAt)) return false;
        if (aiFilter.keywords.length) {
          const haystack = [o.company, o.title, ...o.tags, o.location ?? '']
            .join(' ')
            .toLowerCase();
          if (!aiFilter.keywords.some((k) => haystack.includes(k))) return false;
        }
        return true;
      })
      .filter((o) => (kind === 'all' ? true : o.kind === kind))
      .filter((o) => (actionFilter ? !!actions[o.id]?.[actionFilter] : true))
      .filter((o) => {
        if (!q) return true;
        const haystack = [o.company, o.title, o.location ?? '', ...o.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  }, [opportunities, kind, query, aiFilter, actionFilter, actions]);

  /** Shared pill styling so the action pills match the kind pills exactly. */
  const pillClass = (active: boolean) =>
    'rounded-pill px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors ' +
    (active ? '' : 'text-ink-soft hover:bg-brand-soft hover:text-ink');
  const pillStyle = (active: boolean) =>
    active ? { background: 'var(--school-soft)', color: 'var(--school-deep)' } : undefined;

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8 sm:px-7">
      {/* Header: what this surface is and where the rows come from. */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-display text-[1.35rem] font-semibold tracking-tight text-ink">
            Tracked openings
          </h2>
          <span className="portal-chip--gold portal-chip">
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            </svg>
            AI-tracked
          </span>
        </div>
        <p className="max-w-[58ch] text-[0.92rem] leading-relaxed text-ink-soft">
          Roles tracked automatically across Simplify's GitHub boards and Hacker News
          hiring threads, plus drops from members, refreshed daily by the scanner.
        </p>
        {/* Resume nudge: one quiet line until a file is on record. */}
        {resume === null && (
          <p className="mt-2 text-[0.85rem] text-ink-soft">
            No resume on file yet. Add it on your{' '}
            <a href={`/portal/${school}/`} className="font-semibold text-ink hover:underline">
              Home tab
            </a>{' '}
            so it is ready when you apply.
          </p>
        )}
        {resume ? (
          <div className="mt-2">
            <span className="portal-chip portal-chip--gold">
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 12.5l5 5L19.5 7" />
              </svg>
              Resume on file
            </span>
          </div>
        ) : null}
      </div>

      {/* Controls: kind pills, saved/applied pills, search, Ask AI. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter opportunities">
          {KIND_FILTERS.map((f) => {
            const active = kind === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setKind(f.key)}
                aria-pressed={active}
                className={pillClass(active)}
                style={pillStyle(active)}
              >
                {f.label}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px self-center bg-line" aria-hidden="true" />
          {ACTION_FILTERS.map((f) => {
            const active = actionFilter === f.key;
            const count = f.key === 'saved' ? savedCount : appliedCount;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActionFilter(active ? null : f.key)}
                aria-pressed={active}
                className={pillClass(active)}
                style={pillStyle(active)}
              >
                {f.label}
                <span
                  className={
                    'ml-1.5 inline-block min-w-[1.15rem] rounded-pill px-1 text-center text-[0.66rem] font-bold ' +
                    (active ? '' : 'bg-line/70 text-ink-soft')
                  }
                  style={
                    active
                      ? { background: 'var(--school-deep)', color: 'var(--school-soft)' }
                      : undefined
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            type="search"
            className="portal-input sm:w-[220px]"
            placeholder="Search company, role, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search opportunities"
          />
          <button
            type="button"
            className="portal-btn-ghost flex-none disabled:cursor-default disabled:opacity-50"
            onClick={askAi}
            disabled={!query.trim() || aiLoading}
            title="Turn your search into smart filters"
          >
            {aiLoading ? (
              <svg
                className="h-3.5 w-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            ) : (
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
              </svg>
            )}
            {aiLoading ? 'Asking…' : 'Ask AI'}
          </button>
        </div>
      </div>

      {/* Active AI filter chip: the explanation plus a clear button. */}
      {aiFilter && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="portal-chip max-w-full">
            <svg
              className="h-3 w-3 flex-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            </svg>
            <span className="min-w-0">{aiFilter.explanation}</span>
            <button
              type="button"
              onClick={() => setAiFilter(null)}
              aria-label="Clear AI filter"
              className="ml-0.5 flex-none rounded-pill p-0.5 transition-opacity hover:opacity-60"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        </div>
      )}

      {/* Counts line. */}
      {!loading && (
        <p className="mb-3 text-[0.78rem] font-medium text-ink-soft">
          Showing {filtered.length} of {opportunities.length}
        </p>
      )}

      {/* Quiet note when a saved/applied write fails and gets reverted. */}
      {actionNote && (
        <p className="mb-3 text-[0.78rem] font-medium text-gold-deep" role="status">
          {actionNote}
        </p>
      )}

      {/* List. */}
      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="portal-card animate-pulse p-4">
              <div className="mb-2.5 h-4 w-1/3 rounded bg-line" />
              <div className="mb-2 h-3 w-2/3 rounded bg-line/70" />
              <div className="h-3 w-1/4 rounded bg-line/50" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="portal-card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="font-display text-[1.05rem] font-semibold text-ink">
            Nothing matches that filter
          </span>
          <span className="max-w-[40ch] text-[0.85rem] text-ink-soft">
            Try a different search or kind. The scanner adds new rows every day, so
            check back tomorrow too.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((o) => {
            const sample = o.id.startsWith('seed-') && (storeRef.current?.live ?? true);
            const saved = !!actions[o.id]?.saved;
            const applied = !!actions[o.id]?.applied;
            return (
              <li key={o.id} className="portal-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-ink">{o.company}</span>
                      <span className="font-display text-[1.02rem] text-ink">
                        {o.title}
                      </span>
                      {isNew(o.postedAt) && (
                        <span className="portal-chip portal-chip--gold">New</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-ink-soft">
                      <span className="portal-chip">{KIND_LABELS[o.kind]}</span>
                      {o.location && <span>{o.location}</span>}
                      <span aria-hidden="true">·</span>
                      <span>{o.source}</span>
                      <span aria-hidden="true">·</span>
                      <span title={new Date(o.postedAt).toLocaleString()}>
                        posted {relativeTime(o.postedAt)}
                      </span>
                    </div>
                    {o.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {o.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded-pill border border-line px-2 py-px text-[0.68rem] font-semibold text-ink-soft"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    {/* Marks live only on real rows; samples are read-only. */}
                    {!sample && (
                      <button
                        type="button"
                        onClick={() => toggleAction(o.id, 'saved')}
                        aria-pressed={saved}
                        title="Save for later"
                        className={
                          'flex h-9 w-9 items-center justify-center rounded-pill border transition-colors ' +
                          (saved
                            ? 'border-line-strong'
                            : 'border-line text-ink-soft hover:border-line-strong hover:text-ink')
                        }
                        style={saved ? { color: 'var(--school-deep)' } : undefined}
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill={saved ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.2 5.9-.9z" />
                        </svg>
                      </button>
                    )}
                    {!sample &&
                      (applied ? (
                        <button
                          type="button"
                          onClick={() => toggleAction(o.id, 'applied')}
                          aria-pressed={true}
                          className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[0.74rem] font-semibold transition-opacity hover:opacity-80"
                          style={{
                            background: 'var(--school-soft)',
                            color: 'var(--school-deep)',
                          }}
                        >
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4.5 12.5l5 5L19.5 7" />
                          </svg>
                          Applied
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleAction(o.id, 'applied')}
                          aria-pressed={false}
                          className="inline-flex items-center rounded-pill border border-line px-3 py-1.5 text-[0.74rem] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                        >
                          Mark applied
                        </button>
                      ))}
                    <a
                      className="portal-btn-ghost flex-none"
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Apply
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M7 17L17 7M7 7h10v10" />
                      </svg>
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
