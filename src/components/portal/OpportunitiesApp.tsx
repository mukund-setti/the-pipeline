/**
 * Opportunities island: the AI-tracked jobs surface at /portal/<school>/opportunities.
 * Rows come from the shared portal store (Supabase when live, seeded samples
 * otherwise); the serverless scanner at /api/opportunities-scan refreshes the
 * table daily from Simplify's GitHub boards and Hacker News hiring threads.
 * This component is read-only: filter pills, client-side search, and Apply
 * links out to the source posting.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Opportunity, OpportunityKind } from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';

type KindFilter = 'all' | OpportunityKind;

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'internship', label: 'Internships' },
  { key: 'new-grad', label: 'New grad' },
  { key: 'program', label: 'Programs' },
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

export default function OpportunitiesApp({ school }: { school: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      if (portal.notice === 'setup-required') {
        window.dispatchEvent(new CustomEvent('portal:notice'));
      }
      const rows = await portal.store.listOpportunities();
      if (cancelled) return;
      setOpportunities(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [school]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return opportunities
      .filter((o) => (kind === 'all' ? true : o.kind === kind))
      .filter((o) => {
        if (!q) return true;
        const haystack = [o.company, o.title, o.location ?? '', ...o.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  }, [opportunities, kind, query]);

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
      </div>

      {/* Controls: kind pills + search. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
          {KIND_FILTERS.map((f) => {
            const active = kind === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setKind(f.key)}
                aria-pressed={active}
                className={
                  'rounded-pill px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors ' +
                  (active
                    ? ''
                    : 'text-ink-soft hover:bg-brand-soft hover:text-ink')
                }
                style={
                  active
                    ? { background: 'var(--school-soft)', color: 'var(--school-deep)' }
                    : undefined
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="w-full sm:w-[240px]">
          <input
            type="search"
            className="portal-input"
            placeholder="Search company, role, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search opportunities"
          />
        </div>
      </div>

      {/* Counts line. */}
      {!loading && (
        <p className="mb-3 text-[0.78rem] font-medium text-ink-soft">
          Showing {filtered.length} of {opportunities.length}
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
          {filtered.map((o) => (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
