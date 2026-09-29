/**
 * "Add to your tracker" pop-up, opened when a member marks an Opportunities
 * row as applied. One idea: paste the link to the original job posting and
 * the details fill themselves in. The link starts as the feed row's link and
 * is read right away; pasting a different link reads that one instead. On
 * save the role lands in the member's Tracker at the Applied stage, and the
 * caller then sets the applied mark so the feed and the Tracker agree.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Application, Opportunity, ParsedPosting } from '../../lib/portal/types';
import type { PortalStore } from '../../lib/portal/data';
import { parsePosting, parsedDetails, today } from '../../lib/portal/tracker';

type Form = {
  company: string;
  title: string;
  location: string;
  workMode: string;
  salary: string;
  appliedAt: string;
  notes: string;
};

type Status = { text: string; kind: '' | 'busy' | 'ok' | 'warn' };

/** Fields a successful read fills in (member notes and date are left alone). */
const FILLED = ['company', 'title', 'location', 'workMode', 'salary'] as const;

function normalizeLink(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    return new URL(v).href;
  } catch {
    return null;
  }
}

export default function TrackApplyDialog({
  opportunity,
  store,
  onSaved,
  onCancel,
}: {
  /** The row being marked applied; null keeps the dialog closed. */
  opportunity: Opportunity | null;
  store: PortalStore | null;
  onSaved: (app: Application) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [parsed, setParsed] = useState<ParsedPosting | null>(null);
  const [status, setStatus] = useState<Status>({ text: '', kind: '' });
  const [saving, setSaving] = useState(false);
  /** The link most recently sent to the reader; late results for older links are dropped. */
  const readingFor = useRef<string | null>(null);
  const lastRead = useRef<string | null>(null);

  /** Read a posting and fill the form from it. */
  function read(raw: string) {
    const url = normalizeLink(raw);
    if (!url) {
      setStatus({ text: 'That does not look like a link. Paste the full address of the job posting.', kind: 'warn' });
      return;
    }
    if (url === lastRead.current) return;
    lastRead.current = url;
    readingFor.current = url;
    setParsed(null);
    setStatus({ text: 'Reading the job posting…', kind: 'busy' });
    parsePosting(url)
      .then((r) => {
        if (readingFor.current !== url) return;
        setParsed(r);
        setForm((f) => {
          if (!f) return f;
          const next = { ...f };
          for (const k of FILLED) if (r[k]) next[k] = r[k];
          return next;
        });
        const gotBody = (r.description || '').length > 200;
        setStatus(
          gotBody && r.title
            ? { text: 'Filled in from the posting. Check it and add to your tracker.', kind: 'ok' }
            : {
                text: `That page did not show a job posting. Open the job on the company's own careers site and paste that link here.`,
                kind: 'warn',
              }
        );
      })
      .catch(() => {
        if (readingFor.current !== url) return;
        setStatus({
          text: `Couldn't open that link. Paste the link to the job on the company's own careers site, or fill in the details yourself.`,
          kind: 'warn',
        });
      });
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (!opportunity) {
      readingFor.current = null;
      lastRead.current = null;
      if (d.open) d.close();
      return;
    }
    const loc = opportunity.location ?? '';
    setForm({
      company: opportunity.company,
      title: opportunity.title,
      location: loc,
      workMode: /remote/i.test(loc) ? 'Remote' : '',
      salary: '',
      appliedAt: today(),
      notes: '',
    });
    setLink(opportunity.url);
    setSaving(false);
    lastRead.current = null;
    if (!d.open) d.showModal();
    read(opportunity.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!opportunity || !form || !store || saving) return;
    const url = normalizeLink(link) || opportunity.url;
    setSaving(true);
    try {
      const fields = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim()])
      ) as Partial<Application>;
      // Only keep parsed details if they came from the link being saved.
      const p = parsed && lastRead.current === url ? parsed : null;
      const app = await store.createApplication({
        url: p?.applyUrl || url,
        ...parsedDetails(p),
        ...fields,
        stage: 'applied',
      });
      onSaved(app);
    } catch (err) {
      setStatus({
        text: (err as { message?: string })?.message || 'That did not save. Try again.',
        kind: 'warn',
      });
      setSaving(false);
    }
  }

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <dialog ref={dialogRef} className="trk-dialog" onClose={onCancel}>
      {opportunity && form && (
        <form onSubmit={submit}>
          <header className="mb-4">
            <h2 className="font-display text-[1.2rem] font-semibold text-ink">Add to your tracker</h2>
          </header>

          <label className="flex flex-col gap-1.5 text-[0.78rem] font-semibold text-ink-soft">
            Job posting link
            <input
              className="portal-input"
              type="url"
              inputMode="url"
              spellCheck={false}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text) {
                  e.preventDefault();
                  setLink(text.trim());
                  read(text);
                }
              }}
              onBlur={() => read(link)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  read(link);
                }
              }}
            />
          </label>
          <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-soft">
            Use the original job page on the company's careers site (for example Workday, Greenhouse
            or Lever), not a Simplify, LinkedIn or Handshake link. We fill in the rest.
          </p>

          {status.text && (
            <p className={`trk-status trk-status--${status.kind || 'plain'} mt-3`} role="status">
              {status.text}
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input className="portal-input" required value={form.company} onChange={set('company')} />
            </Field>
            <Field label="Role">
              <input className="portal-input" required value={form.title} onChange={set('title')} />
            </Field>
            <Field label="Location">
              <input className="portal-input" value={form.location} onChange={set('location')} />
            </Field>
            <Field label="Work mode">
              <select className="portal-input" value={form.workMode} onChange={set('workMode')}>
                <option value="">Not sure</option>
                <option>Remote</option>
                <option>Hybrid</option>
                <option>On-site</option>
              </select>
            </Field>
            <Field label="Pay">
              <input className="portal-input" placeholder="e.g. $40/hr" value={form.salary} onChange={set('salary')} />
            </Field>
            <Field label="Applied on">
              <input className="portal-input" type="date" value={form.appliedAt} onChange={set('appliedAt')} />
            </Field>
            <Field label="Notes" wide>
              <textarea
                className="portal-input min-h-[64px] resize-y"
                rows={2}
                placeholder="Referral, recruiter name, anything to remember"
                value={form.notes}
                onChange={set('notes')}
              />
            </Field>
          </div>
          <footer className="mt-5 flex justify-end gap-2">
            <button type="button" className="portal-btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="portal-btn-primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add to tracker'}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label
      className={
        'flex flex-col gap-1.5 text-[0.78rem] font-semibold text-ink-soft' + (wide ? ' sm:col-span-2' : '')
      }
    >
      {label}
      {children}
    </label>
  );
}
