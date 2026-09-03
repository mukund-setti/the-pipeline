/**
 * Tracker island: the application spreadsheet at /portal/<school>/tracker.
 *
 * Rows are the member's applied roles, joined from two places in the store:
 * listActions() says which opportunities carry an 'applied' mark (that mark is
 * the single source of truth for "is this in my tracker"), and
 * listApplications() supplies the stage each one has since reached. A role
 * with an applied mark but no stage row reads as 'applied', which is what
 * makes every mark made before this page existed show up here for free.
 *
 * Layout is a real table on desktop (sortable columns, inline stage select)
 * and stacked cards under 720px, because a five-column grid is unusable on a
 * phone. Both render from the same row model.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApplicationStage,
  JobActionMap,
  JobApplicationMap,
  Opportunity,
} from '../../lib/portal/types';
import { APPLICATION_STAGES } from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';
import type { PortalStore } from '../../lib/portal/data';

type StageFilter = 'all' | ApplicationStage;
type SortKey = 'updated' | 'company' | 'applied';

const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

/**
 * Stage chip colors. Offer and rejected are the only two that earn a real
 * color: they are terminal states a member scans for. Applied and interview
 * stay neutral so a long list does not turn into a christmas tree.
 */
const STAGE_STYLE: Record<ApplicationStage, string> = {
  applied: 'border-line-strong text-ink-soft',
  interview: 'border-gold-deep/40 text-gold-deep',
  offer: 'border-transparent text-canopy',
  rejected: 'border-line text-ink-soft/70',
};

const STAGE_BG: Partial<Record<ApplicationStage, string>> = {
  offer: 'var(--gold-bright, #F2C230)',
};

/** Tiny relative-time formatter, matching OpportunitiesApp's. */
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

/** One tracker row: the opportunity plus wherever the member has got to. */
type Row = {
  opp: Opportunity;
  stage: ApplicationStage;
  note: string;
  /** When the stage last moved, or the posting date if it never has. */
  updatedAt: string;
  /** False when the stage is implied rather than stored. */
  tracked: boolean;
};

export default function TrackerApp({ school }: { school: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [actions, setActions] = useState<JobActionMap>({});
  const [applications, setApplications] = useState<JobApplicationMap>({});
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [note, setNote] = useState<string | null>(null);
  /** Opportunity id whose note is being edited inline, if any. */
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
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
      const [rows, marks, apps] = await Promise.all([
        portal.store.listOpportunities(),
        portal.store.listActions().catch(() => ({}) as JobActionMap),
        portal.store.listApplications().catch(() => ({}) as JobApplicationMap),
      ]);
      if (cancelled) return;
      setOpportunities(rows);
      setActions(marks);
      setApplications(apps);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(noteTimer.current);
    };
  }, [school]);

  const flash = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 5000);
  };

  /** Every applied role, with its stage resolved. */
  const rows: Row[] = useMemo(() => {
    return opportunities
      .filter((o) => actions[o.id]?.applied)
      .map((o) => {
        const app = applications[o.id];
        return {
          opp: o,
          stage: app?.stage ?? 'applied',
          note: app?.note ?? '',
          updatedAt: app?.updatedAt ?? o.postedAt,
          tracked: !!app,
        };
      });
  }, [opportunities, actions, applications]);

  const counts = useMemo(() => {
    const c: Record<StageFilter, number> = {
      all: rows.length,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
    };
    for (const r of rows) c[r.stage] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (stageFilter === 'all' ? true : r.stage === stageFilter))
      .filter((r) => {
        if (!q) return true;
        return [r.opp.company, r.opp.title, r.opp.location ?? '', r.note]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        if (sort === 'company') return a.opp.company.localeCompare(b.opp.company);
        if (sort === 'applied') return b.opp.postedAt.localeCompare(a.opp.postedAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [rows, stageFilter, query, sort]);

  /** Optimistic stage move; reverts and explains if the write fails. */
  const moveStage = (id: string, stage: ApplicationStage) => {
    const store = storeRef.current;
    if (!store) return;
    const prev = applications[id];
    setApplications((p) => ({
      ...p,
      [id]: { stage, note: prev?.note ?? '', updatedAt: new Date().toISOString() },
    }));
    store.setApplicationStage(id, stage).catch(() => {
      setApplications((p) => {
        const next = { ...p };
        if (prev) next[id] = prev;
        else delete next[id];
        return next;
      });
      flash('That stage change did not save. Check your connection and try again.');
    });
  };

  const saveNote = (id: string) => {
    const store = storeRef.current;
    const text = noteDraft.trim();
    setEditingNote(null);
    if (!store) return;
    const prev = applications[id];
    if ((prev?.note ?? '') === text) return;
    const stage = prev?.stage ?? 'applied';
    setApplications((p) => ({
      ...p,
      [id]: { stage, note: text, updatedAt: new Date().toISOString() },
    }));
    store.setApplicationStage(id, stage, text).catch(() => {
      setApplications((p) => {
        const next = { ...p };
        if (prev) next[id] = prev;
        else delete next[id];
        return next;
      });
      flash('That note did not save. Check your connection and try again.');
    });
  };

  const pillClass = (active: boolean) =>
    'rounded-pill px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors ' +
    (active ? '' : 'text-ink-soft hover:bg-brand-soft hover:text-ink');
  const pillStyle = (active: boolean) =>
    active ? { background: 'var(--school-soft)', color: 'var(--school-deep)' } : undefined;

  /** The inline stage picker, shared by the table and the card layouts. */
  const StageSelect = ({ row }: { row: Row }) => (
    <select
      value={row.stage}
      onChange={(e) => moveStage(row.opp.id, e.target.value as ApplicationStage)}
      aria-label={`Stage for ${row.opp.title} at ${row.opp.company}`}
      className={
        'cursor-pointer rounded-pill border bg-transparent py-1 pl-2.5 pr-1.5 text-[0.74rem] font-semibold outline-none transition-colors focus:border-gold-deep ' +
        STAGE_STYLE[row.stage]
      }
      style={STAGE_BG[row.stage] ? { background: STAGE_BG[row.stage] } : undefined}
    >
      {APPLICATION_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto w-full max-w-[980px] px-5 py-8 sm:px-7">
      {/* Header */}
      <div className="mb-6">
        <h2 className="mb-2 font-display text-[1.35rem] font-semibold tracking-tight text-ink">
          Internship tracker
        </h2>
        <p className="max-w-[62ch] text-[0.92rem] leading-relaxed text-ink-soft">
          Every role you marked applied, in one place. Move it along as you hear back, so
          you always know what is live and what is done.
        </p>
      </div>

      {/* Stage filters + search + sort */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by stage"
        >
          {(['all', ...APPLICATION_STAGES] as StageFilter[]).map((key) => {
            const active = stageFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStageFilter(key)}
                aria-pressed={active}
                className={pillClass(active)}
                style={pillStyle(active)}
              >
                {key === 'all' ? 'All' : STAGE_LABELS[key]}
                <span className="ml-1.5 opacity-60">{counts[key]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, role, note"
            aria-label="Search your applications"
            className="w-full rounded-field border border-line-strong bg-surface px-3.5 py-2 font-sans text-[0.85rem] text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-gold-deep sm:w-[230px]"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort applications"
            className="cursor-pointer rounded-field border border-line-strong bg-surface px-2.5 py-2 text-[0.8rem] font-semibold text-ink-soft outline-none focus:border-gold-deep"
          >
            <option value="updated">Last update</option>
            <option value="company">Company</option>
            <option value="applied">Date posted</option>
          </select>
        </div>
      </div>

      {note && (
        <p className="mb-3 text-[0.78rem] font-medium text-gold-deep" role="status">
          {note}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="portal-card animate-pulse p-4">
              <div className="mb-2.5 h-4 w-1/3 rounded bg-line" />
              <div className="h-3 w-1/2 rounded bg-line/70" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="portal-card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <span className="font-display text-[1.05rem] font-semibold text-ink">
            Nothing tracked yet
          </span>
          <span className="max-w-[44ch] text-[0.85rem] text-ink-soft">
            Hit <b className="font-semibold text-ink">Mark applied</b> on any role in
            Opportunities and it lands here, ready to move through interview, offer, or
            rejected.
          </span>
          <a href={`/portal/${school}/opportunities/`} className="portal-btn-ghost mt-2">
            Browse openings
          </a>
        </div>
      ) : visible.length === 0 ? (
        <div className="portal-card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="font-display text-[1.05rem] font-semibold text-ink">
            Nothing at this stage
          </span>
          <span className="max-w-[40ch] text-[0.85rem] text-ink-soft">
            You have {rows.length} tracked {rows.length === 1 ? 'role' : 'roles'}, just none
            matching that filter.
          </span>
        </div>
      ) : (
        <>
          {/* Desktop: the spreadsheet. */}
          <div className="portal-card hidden overflow-x-auto min-[720px]:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[0.7rem] uppercase tracking-wider text-ink-soft">
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                  <th className="px-4 py-3 font-semibold">Note</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Updated</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Open posting</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.opp.id}
                    className="border-b border-line/60 align-middle last:border-0 hover:bg-brand-soft/40"
                  >
                    <td className="px-4 py-3 font-semibold text-ink">{r.opp.company}</td>
                    <td className="px-4 py-3 text-[0.9rem] text-ink">
                      {r.opp.title}
                      {r.opp.location && (
                        <span className="block text-[0.76rem] text-ink-soft">
                          {r.opp.location}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StageSelect row={r} />
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-[0.82rem] text-ink-soft">
                      {editingNote === r.opp.id ? (
                        <input
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onBlur={() => saveNote(r.opp.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveNote(r.opp.id);
                            if (e.key === 'Escape') setEditingNote(null);
                          }}
                          aria-label="Application note"
                          className="w-full rounded-field border border-line-strong bg-surface px-2 py-1 text-[0.82rem] text-ink outline-none focus:border-gold-deep"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNote(r.opp.id);
                            setNoteDraft(r.note);
                          }}
                          className="w-full truncate text-left hover:text-ink"
                          title={r.note || 'Add a note'}
                        >
                          {r.note || <span className="opacity-50">Add a note</span>}
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[0.8rem] text-ink-soft">
                      {r.tracked ? (
                        <span title={new Date(r.updatedAt).toLocaleString()}>
                          {relativeTime(r.updatedAt)}
                        </span>
                      ) : (
                        <span className="opacity-50">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={r.opp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-soft transition-colors hover:text-ink"
                        aria-label={`Open ${r.opp.company} posting`}
                      >
                        <svg
                          className="h-4 w-4"
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: the same rows, stacked. */}
          <ul className="flex flex-col gap-3 min-[720px]:hidden">
            {visible.map((r) => (
              <li key={r.opp.id} className="portal-card p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{r.opp.company}</div>
                    <div className="font-display text-[0.98rem] text-ink">{r.opp.title}</div>
                    {r.opp.location && (
                      <div className="text-[0.78rem] text-ink-soft">{r.opp.location}</div>
                    )}
                  </div>
                  <a
                    href={r.opp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-none text-ink-soft"
                    aria-label={`Open ${r.opp.company} posting`}
                  >
                    <svg
                      className="h-4 w-4"
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
                <div className="flex flex-wrap items-center gap-2">
                  <StageSelect row={r} />
                  {r.tracked && (
                    <span className="text-[0.76rem] text-ink-soft">
                      updated {relativeTime(r.updatedAt)}
                    </span>
                  )}
                </div>
                {editingNote === r.opp.id ? (
                  <input
                    autoFocus
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={() => saveNote(r.opp.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveNote(r.opp.id);
                      if (e.key === 'Escape') setEditingNote(null);
                    }}
                    aria-label="Application note"
                    className="mt-2.5 w-full rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-[0.82rem] text-ink outline-none focus:border-gold-deep"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNote(r.opp.id);
                      setNoteDraft(r.note);
                    }}
                    className="mt-2.5 w-full text-left text-[0.82rem] text-ink-soft hover:text-ink"
                  >
                    {r.note || <span className="opacity-50">Add a note</span>}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
