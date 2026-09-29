/**
 * Application tracker island at /portal/<school>/tracker. A port of the
 * standalone JobTracker app, made per-member: every row lives in the
 * member's own `applications` rows (RLS-private), not a local JSON file.
 *
 * Paste a posting link and /api/parse-job reads the company, role, location,
 * pay and the full posting; the member checks the details and saves. Each
 * row has a stage rail (Saved, Applied, Screen, Interview, Offer), a separate
 * outcome (Rejected, Withdrawn, Accepted), notes that save on blur, a prep
 * sheet built from the posting, and a status history written by the
 * database. Rows sitting in Applied for 10+ days get a "no word" nudge.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  Application,
  ApplicationInput,
  AppOutcome,
  AppStage,
  ParsedPosting,
} from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';
import type { PortalStore } from '../../lib/portal/data';
import { normUrl, parsePosting, parsedDetails, toDay, today } from '../../lib/portal/tracker';

/* ------------------------------ constants ------------------------------ */

const STAGES: [AppStage, string][] = [
  ['saved', 'Saved'],
  ['applied', 'Applied'],
  ['screen', 'Screen'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
];
const STAGE_IDX = Object.fromEntries(STAGES.map(([k], i) => [k, i])) as Record<AppStage, number>;
const LABELS: Record<string, string> = {
  ...Object.fromEntries(STAGES),
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  accepted: 'Accepted',
};
const OUTCOMES: [AppOutcome, string][] = [
  ['', 'Open'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
  ['accepted', 'Accepted'],
];
const FOLLOW_UP_DAYS = 10;

type Filter = 'all' | AppStage | 'closed';
type Sort = 'applied-desc' | 'applied-asc' | 'updated-desc' | 'company-asc';

const SECTION_ORDER: [keyof Application['sections'], string][] = [
  ['responsibilities', "What you'd do"],
  ['requirements', 'What they want'],
  ['niceToHave', 'Nice to have'],
  ['benefits', 'Benefits'],
  ['about', 'About the company'],
];

/** Editor fields, in form order. */
const FORM_FIELDS = [
  'company',
  'title',
  'location',
  'workMode',
  'salary',
  'appliedAt',
  'stage',
  'notes',
] as const;
type FormFields = Record<(typeof FORM_FIELDS)[number], string>;

/** Parser-owned fields a refresh may fill when the member left them empty. */
const FILL_IF_EMPTY = [
  'title',
  'company',
  'location',
  'salary',
  'workMode',
  'employmentType',
  'postedAt',
] as const;

/* -------------------------------- dates -------------------------------- */

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
function fmtDay(iso: string): string {
  if (!iso) return '';
  const d = parseDay(iso);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
const daysSince = (iso: string) =>
  iso ? Math.round((parseDay(today()).getTime() - parseDay(iso).getTime()) / 86_400_000) : null;
const ago = (n: number | null) =>
  n === null || n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
const fmtStamp = (ts: string) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const localDay = (ts: string) => toDay(new Date(ts));

/* ----------------------------- prep sheet ------------------------------ */

/** Render the parser's light markdown: "## " headings, "- " bullets, paragraphs. */
function PostingBody({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      const items = list;
      out.push(
        <ul key={out.length}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith('## ')) {
      flush();
      out.push(<h4 key={out.length}>{line.slice(3)}</h4>);
    } else if (line.startsWith('- ')) list.push(line.slice(2));
    else {
      flush();
      out.push(<p key={out.length}>{line}</p>);
    }
  }
  flush();
  return <div className="trk-posting">{out}</div>;
}

/** Plain-text prep sheet for the clipboard. */
function prepText(a: Application): string {
  const lines = [
    `${a.company || 'Unknown company'}: ${a.title || 'Untitled role'}`,
    a.url,
    [a.location, a.workMode, a.salary].filter(Boolean).join(' · '),
  ];
  const facts = [a.level, a.experience, a.team, a.employmentType].filter(Boolean).join(' · ');
  if (facts) lines.push(facts);
  if (a.skills.length) lines.push('', 'SKILLS: ' + a.skills.join(', '));
  for (const [k, label] of SECTION_ORDER) {
    const items = a.sections[k];
    if (items?.length) lines.push('', label.toUpperCase(), ...items.map((x) => '- ' + x));
  }
  if (a.notes) lines.push('', 'NOTES', a.notes);
  return lines.join('\n');
}

/* ------------------------------- editor -------------------------------- */

type EditorState =
  | { mode: 'add'; url: string; parsed: ParsedPosting | null; key: number }
  | { mode: 'edit'; app: Application; key: number };

type ParseStatus = { text: string; kind: '' | 'busy' | 'ok' | 'warn' };

/* ------------------------------ component ------------------------------ */

export default function TrackerApp({ school }: { school: string }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('applied-desc');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<FormFields>(blankForm());
  const [status, setStatus] = useState<ParseStatus>({ text: '', kind: '' });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const storeRef = useRef<PortalStore | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const editorSeq = useRef(0);
  /** The editor that is currently open; late parse results check against it. */
  const editorKey = useRef<number | null>(null);

  /* ---------------------------- boot ---------------------------- */

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
      setLive(portal.store.live);
      try {
        const rows = await portal.store.listApplications();
        if (!cancelled) setApps(rows);
      } catch {
        if (!cancelled) {
          setLoadError(
            'Your tracker could not load. If this keeps happening, the applications table may not be set up yet.'
          );
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(toastTimer.current);
    };
  }, [school]);

  // Open and close the native dialog in step with editor state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (editor && !d.open) d.showModal();
    if (!editor && d.open) d.close();
  }, [editor]);

  // Scroll a freshly added (or duplicate) row into view and pulse it.
  useEffect(() => {
    if (!flashId) return;
    const el = document.querySelector(`[data-app-id="${flashId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = window.setTimeout(() => setFlashId(null), 1700);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const say = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };

  const errMsg = (e: unknown, fallback: string) =>
    (e as { message?: string })?.message || fallback;

  /* ---------------------------- writes ---------------------------- */

  const replace = (saved: Application) =>
    setApps((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));

  async function update(id: string, patch: ApplicationInput): Promise<Application | null> {
    const store = storeRef.current;
    if (!store) return null;
    try {
      const saved = await store.updateApplication(id, patch);
      replace(saved);
      return saved;
    } catch (e) {
      say(errMsg(e, 'That did not save. Check your connection and try again.'));
      return null;
    }
  }

  async function moveStage(a: Application, stage: AppStage) {
    if (a.stage === stage) return;
    const saved = await update(a.id, { stage });
    if (saved) say(`${saved.company || 'Job'}: ${LABELS[saved.stage]}`);
  }

  async function setOutcome(a: Application, outcome: AppOutcome) {
    const saved = await update(a.id, { outcome });
    if (saved) say(outcome ? `${saved.company || 'Job'}: ${LABELS[outcome]}` : 'Reopened');
  }

  async function saveNotes(a: Application, notes: string) {
    if (notes === a.notes) return;
    const saved = await update(a.id, { notes });
    if (saved) say('Notes saved');
  }

  async function remove(a: Application) {
    const store = storeRef.current;
    if (!store) return;
    try {
      await store.deleteApplication(a.id);
      setApps((prev) => prev.filter((x) => x.id !== a.id));
      setOpen((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
      say('Deleted');
    } catch (e) {
      say(errMsg(e, 'Could not delete it. Try again.'));
    } finally {
      setConfirmDelete(null);
    }
  }

  /**
   * Re-read the posting and rebuild the prep sheet. Never overwrites what the
   * member typed: parser-owned details are replaced, member-facing fields are
   * only filled when empty.
   */
  async function refresh(a: Application) {
    setRefreshing((prev) => new Set(prev).add(a.id));
    const patch: ApplicationInput = { parsedAt: new Date().toISOString(), parseWarning: '' };
    try {
      const r = await parsePosting(a.url);
      const gotBody = (r.description || '').length > 200;
      for (const k of ['team', 'level', 'source', 'jobRef'] as const) {
        if (r[k]) patch[k] = r[k];
      }
      for (const k of FILL_IF_EMPTY) {
        if (!a[k] && r[k]) (patch as Record<string, unknown>)[k] = r[k];
      }
      if (gotBody) {
        patch.description = r.description;
        patch.sections = r.sections;
        patch.skills = r.skills;
        patch.experience = r.experience;
      } else {
        if (!a.description && r.description) patch.description = r.description;
        patch.parseWarning =
          r.warnings?.[0] ||
          `${r.host} loads the posting text in the browser, so only the summary could be read`;
      }
    } catch (e) {
      patch.parseWarning = `Could not read the posting (${errMsg(e, 'unknown error')})`;
    }
    const saved = await update(a.id, patch);
    setRefreshing((prev) => {
      const next = new Set(prev);
      next.delete(a.id);
      return next;
    });
    if (saved) {
      say(
        saved.parseWarning
          ? `${saved.company || 'Job'}: ${saved.parseWarning}`
          : `Prep sheet updated for ${saved.company || 'job'}`
      );
    }
  }

  /* ---------------------------- editor ---------------------------- */

  function openAdd(url: string) {
    const key = ++editorSeq.current;
    editorKey.current = key;
    setForm({ ...blankForm(), appliedAt: today(), stage: 'applied' });
    setStatus({ text: 'Reading the page…', kind: 'busy' });
    setEditor({ mode: 'add', url, parsed: null, key });

    parsePosting(url)
      .then((r) => {
        if (editorKey.current !== key) return; // closed or replaced meanwhile
        setEditor((cur) => (cur && cur.key === key && cur.mode === 'add' ? { ...cur, parsed: r } : cur));
        // Fill only what the member has not typed yet.
        setForm((f) => {
          const next = { ...f };
          for (const k of ['company', 'title', 'location', 'workMode', 'salary'] as const) {
            if (!next[k] && r[k]) next[k] = r[k];
          }
          return next;
        });
        const found = (['company', 'title', 'location', 'salary'] as const).filter((k) => r[k]);
        if (found.length >= 2) {
          setStatus({
            text: `Found ${found.join(', ')} via ${r.source === 'page' ? r.host : r.source}. Check them and save.`,
            kind: 'ok',
          });
        } else {
          setStatus({
            text: `Couldn't read much from ${r.host}${r.warnings?.length ? ` (${r.warnings[0]})` : ''}. Fill in the details by hand.`,
            kind: 'warn',
          });
        }
      })
      .catch((e) => {
        if (editorKey.current !== key) return;
        setStatus({
          text: `Couldn't read that page (${errMsg(e, 'unknown error')}). Fill in the details by hand.`,
          kind: 'warn',
        });
      });
  }

  function openEdit(app: Application) {
    const key = ++editorSeq.current;
    editorKey.current = key;
    setForm({
      company: app.company,
      title: app.title,
      location: app.location,
      workMode: app.workMode,
      salary: app.salary,
      appliedAt: app.appliedAt,
      stage: app.stage,
      notes: app.notes,
    });
    setStatus({ text: '', kind: '' });
    setEditor({ mode: 'edit', app, key });
  }

  function closeEditor() {
    editorKey.current = null;
    setEditor(null);
  }

  async function submitEditor(e: FormEvent) {
    e.preventDefault();
    const store = storeRef.current;
    if (!editor || !store || saving) return;
    const fields: ApplicationInput = Object.fromEntries(
      FORM_FIELDS.map((k) => [k, form[k].trim()])
    ) as ApplicationInput;
    setSaving(true);
    try {
      if (editor.mode === 'add') {
        // Saved-but-not-applied should not carry today's date by default.
        if (fields.stage === 'saved' && fields.appliedAt === today()) fields.appliedAt = '';
        const p = editor.parsed;
        const app = await store.createApplication({
          url: p?.applyUrl || editor.url,
          ...parsedDetails(p),
          ...fields,
        });
        setApps((prev) => [app, ...prev]);
        setFilter('all');
        setFlashId(app.id);
        say(`Tracking ${app.company || app.title || 'it'}`);
      } else {
        const saved = await store.updateApplication(editor.app.id, fields);
        replace(saved);
        say('Saved');
      }
      closeEditor();
    } catch (err) {
      setStatus({ text: errMsg(err, 'That did not save. Try again.'), kind: 'warn' });
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------- intake ---------------------------- */

  function submitIntake(e: FormEvent) {
    e.preventDefault();
    let raw = urlInput.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    let url: string;
    try {
      url = new URL(raw).href;
    } catch {
      setUrlError('That does not look like a link. Paste the full address of the job posting.');
      return;
    }
    setUrlError(null);
    setUrlInput('');
    const dupe = apps.find((a) => normUrl(a.url) === normUrl(url));
    if (dupe) {
      say(`Already tracking ${dupe.company || dupe.title || 'this one'}`);
      setFilter('all');
      setQuery('');
      setFlashId(dupe.id);
      return;
    }
    openAdd(url);
  }

  /* ---------------------------- export ---------------------------- */

  function exportCsv() {
    const cols = [
      'company', 'title', 'location', 'workMode', 'salary', 'stage',
      'outcome', 'appliedAt', 'postedAt', 'url', 'notes',
    ] as const;
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...sorted(apps, sort).map((a) => cols.map((c) => cell(a[c])).join(','))];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `applications-${today()}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /* ---------------------------- derived ---------------------------- */

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length, closed: 0 };
    for (const [k] of STAGES) c[k] = 0;
    for (const a of apps) {
      if (a.outcome) c.closed++;
      else c[a.stage]++;
    }
    return c;
  }, [apps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted(
      apps.filter((a) => {
        if (filter === 'closed') {
          if (!a.outcome) return false;
        } else if (filter !== 'all' && (a.outcome || a.stage !== filter)) return false;
        if (q) {
          const hay = `${a.company} ${a.title} ${a.location} ${a.notes} ${a.host}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
      sort
    );
  }, [apps, filter, query, sort]);

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ---------------------------- render ---------------------------- */

  const chips: [Filter, string][] = [['all', 'All'], ...STAGES, ['closed', 'Closed']];

  return (
    <div className="mx-auto w-full max-w-[1060px] px-5 py-8 sm:px-7">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[1.35rem] font-semibold tracking-tight text-ink">
            Your applications
          </h2>
          <p className="mt-1 max-w-[60ch] text-[0.92rem] leading-relaxed text-ink-soft">
            Paste a posting link and track where you are in the process. Only you can see this
            list.
          </p>
        </div>
        <button
          type="button"
          className="portal-btn-ghost disabled:cursor-default disabled:opacity-50"
          onClick={exportCsv}
          disabled={!apps.length}
        >
          Export CSV
        </button>
      </div>

      {/* Intake */}
      <form className="portal-card mb-5 p-4 sm:p-5" onSubmit={submitIntake} autoComplete="off">
        <label htmlFor="trk-url" className="mb-2 block text-[0.8rem] font-semibold text-ink">
          Paste a job link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="trk-url"
            type="url"
            inputMode="url"
            spellCheck={false}
            className="portal-input"
            placeholder="https://jobs.lever.co/company/…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <button type="submit" className="portal-btn-primary flex-none" disabled={!urlInput.trim()}>
            Track it
          </button>
        </div>
        <p
          className={
            'mt-2 text-[0.8rem] ' + (urlError ? 'font-semibold text-[color:var(--school-gold)]' : 'text-ink-soft')
          }
        >
          {urlError ||
            (live || import.meta.env.DEV
              ? "Use the original job page on the company's careers site (Workday, Greenhouse, Lever and so on), not a Simplify, LinkedIn or Handshake link. The details fill in from it."
              : 'Demo session: links are not read automatically here, so fill in the details by hand.')}
        </p>
      </form>

      {/* Stage filters */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
        {chips.map(([k, label]) => {
          const active = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={active}
              className={
                'rounded-pill px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors ' +
                (active ? '' : 'text-ink-soft hover:bg-brand-soft hover:text-ink')
              }
              style={active ? { background: 'var(--school-soft)', color: 'var(--school-deep)' } : undefined}
            >
              {label}
              <span
                className={
                  'ml-1.5 inline-block min-w-[1.15rem] rounded-pill px-1 text-center text-[0.66rem] font-bold ' +
                  (active ? '' : 'bg-line text-ink')
                }
                style={active ? { background: 'var(--school-deep)', color: 'var(--school-soft)' } : undefined}
              >
                {counts[k] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + sort */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          className="portal-input"
          placeholder="Search company, role, notes"
          aria-label="Search applications"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sm:w-[210px] sm:flex-none">
          <select
            className="portal-input"
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="applied-desc">Newest applied</option>
            <option value="applied-asc">Oldest applied</option>
            <option value="updated-desc">Recently updated</option>
            <option value="company-asc">Company A to Z</option>
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="portal-card animate-pulse p-4">
              <div className="mb-2.5 h-4 w-1/4 rounded bg-line" />
              <div className="mb-2 h-3 w-1/2 rounded bg-line/70" />
              <div className="h-3 w-1/5 rounded bg-line/50" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="portal-card px-6 py-10 text-center text-[0.9rem] text-ink-soft">{loadError}</div>
      ) : !apps.length ? (
        <div className="portal-card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="font-display text-[1.05rem] font-semibold text-ink">Nothing tracked yet</span>
          <span className="max-w-[42ch] text-[0.85rem] text-ink-soft">
            Paste a job link above to add your first application. Roles from the{' '}
            <a href={`/portal/${school}/opportunities/`} className="font-semibold text-ink hover:underline">
              Opportunities
            </a>{' '}
            feed work too.
          </span>
        </div>
      ) : !visible.length ? (
        <div className="portal-card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="font-display text-[1.05rem] font-semibold text-ink">No matches</span>
          <span className="text-[0.85rem] text-ink-soft">
            Nothing in this stage{query.trim() ? ' matches your search' : ''}.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {visible.map((a) => (
            <AppRow
              key={a.id}
              app={a}
              open={open.has(a.id)}
              flash={flashId === a.id}
              refreshing={refreshing.has(a.id)}
              confirmingDelete={confirmDelete === a.id}
              onToggle={() => toggleOpen(a.id)}
              onStage={(s) => moveStage(a, s)}
              onOutcome={(o) => setOutcome(a, o)}
              onNotes={(n) => saveNotes(a, n)}
              onEdit={() => openEdit(a)}
              onRefresh={() => refresh(a)}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(prepText(a));
                  say('Prep sheet copied');
                } catch {
                  say('Copy was blocked by the browser');
                }
              }}
              onAskDelete={() => setConfirmDelete(a.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onDelete={() => remove(a)}
            />
          ))}
        </ul>
      )}

      {/* Editor dialog */}
      <dialog
        ref={dialogRef}
        className="trk-dialog"
        onClose={() => {
          editorKey.current = null;
          setEditor(null);
        }}
      >
        {editor && (
          <form onSubmit={submitEditor}>
            <header className="mb-3">
              <h2 className="font-display text-[1.2rem] font-semibold text-ink">
                {editor.mode === 'add' ? 'New application' : 'Edit details'}
              </h2>
              <a
                className="mt-0.5 block truncate text-[0.78rem] text-ink-soft hover:text-ink"
                href={editor.mode === 'add' ? editor.url : editor.app.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {editor.mode === 'add' ? editor.url : editor.app.url}
              </a>
            </header>
            {status.text && (
              <p className={`trk-status trk-status--${status.kind || 'plain'}`} role="status">
                {status.text}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company">
                <input
                  className="portal-input"
                  required
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <input
                  className="portal-input"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              <Field label="Location">
                <input
                  className="portal-input"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </Field>
              <Field label="Work mode">
                <select
                  className="portal-input"
                  value={form.workMode}
                  onChange={(e) => setForm({ ...form, workMode: e.target.value })}
                >
                  <option value="">Not sure</option>
                  <option>Remote</option>
                  <option>Hybrid</option>
                  <option>On-site</option>
                </select>
              </Field>
              <Field label="Pay">
                <input
                  className="portal-input"
                  placeholder="e.g. $40/hr or $120k to $140k"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                />
              </Field>
              <Field label="Applied on">
                <input
                  className="portal-input"
                  type="date"
                  value={form.appliedAt}
                  onChange={(e) => setForm({ ...form, appliedAt: e.target.value })}
                />
              </Field>
              <Field label="Stage">
                <select
                  className="portal-input"
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value })}
                >
                  <option value="saved">Saved, not applied yet</option>
                  <option value="applied">Applied</option>
                  <option value="screen">Screen</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer</option>
                </select>
              </Field>
              <Field label="Notes" wide>
                <textarea
                  className="portal-input min-h-[84px] resize-y"
                  rows={3}
                  placeholder="Referral, recruiter name, anything to remember"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </div>
            <footer className="mt-5 flex justify-end gap-2">
              <button type="button" className="portal-btn-ghost" onClick={closeEditor}>
                Cancel
              </button>
              <button type="submit" className="portal-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </form>
        )}
      </dialog>

      {/* Toast */}
      <div className="trk-toast" data-show={toast ? '' : undefined} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

/* ------------------------------ row ------------------------------------ */

type RowProps = {
  app: Application;
  open: boolean;
  flash: boolean;
  refreshing: boolean;
  confirmingDelete: boolean;
  onToggle: () => void;
  onStage: (s: AppStage) => void;
  onOutcome: (o: AppOutcome) => void;
  onNotes: (n: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
};

function AppRow(p: RowProps) {
  const a = p.app;
  const idx = STAGE_IDX[a.stage] ?? 0;
  const days = daysSince(a.appliedAt);
  const nudge = !a.outcome && a.stage === 'applied' && days !== null && days >= FOLLOW_UP_DAYS;
  const meta = [a.location, a.workMode, a.salary].filter(Boolean);

  return (
    <li
      className="portal-card trk-row"
      data-app-id={a.id}
      data-outcome={a.outcome || undefined}
      data-flash={p.flash ? '' : undefined}
    >
      <div className="trk-row-main">
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">
            {a.company || <span className="italic text-ink-soft">Unknown company</span>}
          </div>
          <div className="font-display text-[1.02rem] leading-snug text-ink">
            {a.title || <span className="italic text-ink-soft">Untitled role</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.78rem] text-ink-soft">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-2">
                {m}
                <span aria-hidden="true">·</span>
              </span>
            ))}
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink hover:underline"
              title="Open the posting"
            >
              {a.host || 'posting'} ↗
            </a>
          </div>
        </div>

        <div className="trk-rail" role="group" aria-label="Stage">
          {STAGES.map(([k, label], i) => (
            <button
              key={k}
              type="button"
              className="trk-node"
              data-done={i < idx ? '' : undefined}
              data-current={i === idx ? '' : undefined}
              aria-pressed={i === idx}
              title={`Move to ${label}`}
              onClick={() => p.onStage(k)}
            >
              <span className="trk-dot" />
              <span className="trk-lbl">{label}</span>
            </button>
          ))}
        </div>

        <div className="trk-when">
          {a.appliedAt ? (
            <>
              <div className="text-[0.82rem] font-semibold text-ink">Applied {fmtDay(a.appliedAt)}</div>
              <div className={'text-[0.74rem] ' + (nudge ? 'trk-nudge' : 'text-ink-soft')}>
                {nudge ? `No word in ${days} days` : ago(days)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[0.82rem] font-semibold text-ink-soft">Not applied yet</div>
              <div className="text-[0.74rem] text-ink-soft">saved {ago(daysSince(localDay(a.createdAt)))}</div>
            </>
          )}
        </div>

        <div className="trk-side">
          <select
            className="trk-outcome"
            data-outcome={a.outcome || 'open'}
            aria-label="Outcome"
            value={a.outcome}
            onChange={(e) => p.onOutcome(e.target.value as AppOutcome)}
          >
            {OUTCOMES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" className="trk-more" aria-expanded={p.open} onClick={p.onToggle}>
            {p.open ? 'Less' : 'More'}
          </button>
        </div>
      </div>

      {p.open && (
        <div className="trk-detail">
          <div className="min-w-0">
            <label className="trk-label" htmlFor={`notes-${a.id}`}>
              Notes
            </label>
            <textarea
              key={`${a.id}-${a.notes}`}
              id={`notes-${a.id}`}
              className="portal-input min-h-[88px] resize-y text-[0.88rem]"
              defaultValue={a.notes}
              placeholder="Recruiter name, interview dates, what to prepare. Saves when you click away."
              onBlur={(e) => p.onNotes(e.target.value)}
            />

            <div className="mt-4 flex items-center justify-between">
              <span className="trk-label mb-0">Prep sheet</span>
              <span className="flex gap-3">
                {a.description && (
                  <button type="button" className="trk-link" onClick={p.onCopy}>
                    Copy
                  </button>
                )}
                <button
                  type="button"
                  className="trk-link"
                  onClick={p.onRefresh}
                  disabled={p.refreshing}
                  title="Read the posting again"
                >
                  {p.refreshing ? 'Reading…' : a.parsedAt ? 'Refresh' : 'Read posting'}
                </button>
              </span>
            </div>
            <div className="mt-2">
              <PrepSheet app={a} onRefresh={p.onRefresh} refreshing={p.refreshing} />
            </div>
          </div>

          <div>
            <div className="trk-label">History</div>
            <ol className="trk-timeline">
              {[...a.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className={i === 0 ? 'font-semibold text-ink' : 'text-ink'}>
                    {LABELS[h.status] || h.status}
                  </span>
                  <span className="text-ink-soft">{fmtStamp(h.at)}</span>
                </li>
              ))}
            </ol>
            {a.source && a.source !== 'page' && (
              <div className="trk-kv">
                <span>Details from</span>
                <span>{a.source}</span>
              </div>
            )}
            {a.parsedAt && (
              <div className="trk-kv">
                <span>Posting read</span>
                <span>{fmtStamp(a.parsedAt)}</span>
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {p.confirmingDelete ? (
                <>
                  <span className="self-center text-[0.8rem] text-ink-soft">Delete for good?</span>
                  <button type="button" className="portal-btn-ghost" onClick={p.onCancelDelete}>
                    Keep
                  </button>
                  <button type="button" className="portal-btn-ghost trk-danger" onClick={p.onDelete}>
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="portal-btn-ghost trk-danger" onClick={p.onAskDelete}>
                    Delete
                  </button>
                  <button type="button" className="portal-btn-ghost" onClick={p.onEdit}>
                    Edit details
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function PrepSheet({
  app: a,
  onRefresh,
  refreshing,
}: {
  app: Application;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (!a.parsedAt && !a.description) {
    return (
      <p className="text-[0.85rem] text-ink-soft">
        No details yet.{' '}
        <button type="button" className="trk-link" onClick={onRefresh} disabled={refreshing}>
          Read the posting
        </button>{' '}
        to build a prep sheet.
      </p>
    );
  }
  if (!a.description) {
    return (
      <p className="text-[0.85rem] text-ink-soft">
        {a.parseWarning || 'Nothing could be read from this posting.'}{' '}
        <button type="button" className="trk-link" onClick={onRefresh} disabled={refreshing}>
          Try again
        </button>
      </p>
    );
  }
  const facts = (
    [
      ['Level', a.level],
      ['Experience', a.experience],
      ['Team', a.team],
      ['Type', a.employmentType],
      ['Posted', a.postedAt ? fmtDay(a.postedAt) : ''],
      ['Ref', a.jobRef],
    ] as [string, string][]
  ).filter(([, v]) => v);
  const secs = SECTION_ORDER.filter(([k]) => a.sections[k]?.length);
  return (
    <div>
      {facts.length > 0 && (
        <dl className="trk-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.skills.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {a.skills.map((s) => (
            <span key={s} className="portal-chip">
              {s}
            </span>
          ))}
        </div>
      )}
      {secs.map(([k, label], i) => (
        <details key={k} className="trk-sec" open={i < 2}>
          <summary>
            {label}
            <span className="trk-n">{a.sections[k]!.length}</span>
          </summary>
          <ul>
            {a.sections[k]!.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        </details>
      ))}
      <details className="trk-sec">
        <summary>
          Full posting
          <span className="trk-n">{secs.length ? '' : 'no headings found'}</span>
        </summary>
        <PostingBody text={a.description} />
      </details>
      {a.parseWarning && <p className="mt-2 text-[0.78rem] text-ink-soft">{a.parseWarning}</p>}
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={'flex flex-col gap-1.5 text-[0.78rem] font-semibold text-ink-soft' + (wide ? ' sm:col-span-2' : '')}>
      {label}
      {children}
    </label>
  );
}

/* ------------------------------ helpers -------------------------------- */

function blankForm(): FormFields {
  return { company: '', title: '', location: '', workMode: '', salary: '', appliedAt: '', stage: 'applied', notes: '' };
}

function sorted(list: Application[], sort: Sort): Application[] {
  const key = (a: Application) => a.appliedAt || localDay(a.createdAt);
  const cmp: Record<Sort, (a: Application, b: Application) => number> = {
    'applied-desc': (a, b) => key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt),
    'applied-asc': (a, b) => key(a).localeCompare(key(b)) || a.createdAt.localeCompare(b.createdAt),
    'updated-desc': (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    'company-asc': (a, b) =>
      (a.company || '').localeCompare(b.company || '') || (a.title || '').localeCompare(b.title || ''),
  };
  return [...list].sort(cmp[sort]);
}
