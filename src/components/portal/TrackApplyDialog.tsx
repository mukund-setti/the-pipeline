/**
 * "Add to your tracker" pop-up, opened when a member marks an Opportunities
 * row as applied. It starts filled from the feed row (company, role,
 * location, link), reads the posting in the background to fill pay, work
 * mode and the prep sheet, and on save creates the member's tracker row at
 * the Applied stage. The caller then sets the applied mark, so the feed and
 * the tracker never disagree.
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
  stage: string;
  notes: string;
};

type Status = { text: string; kind: '' | 'busy' | 'ok' | 'warn' };

function formFrom(o: Opportunity): Form {
  const loc = o.location ?? '';
  return {
    company: o.company,
    title: o.title,
    location: loc,
    workMode: /remote/i.test(loc) ? 'Remote' : '',
    salary: '',
    appliedAt: today(),
    stage: 'applied',
    notes: '',
  };
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
  const [form, setForm] = useState<Form | null>(null);
  const [parsed, setParsed] = useState<ParsedPosting | null>(null);
  const [status, setStatus] = useState<Status>({ text: '', kind: '' });
  const [saving, setSaving] = useState(false);
  /** Guards late parse results against a dialog that was closed or reopened. */
  const openFor = useRef<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (!opportunity) {
      openFor.current = null;
      if (d.open) d.close();
      return;
    }
    const id = opportunity.id;
    openFor.current = id;
    setForm(formFrom(opportunity));
    setParsed(null);
    setSaving(false);
    if (!d.open) d.showModal();

    // Sample rows (shown until the scanner fills the feed, and in the demo
    // session) link to general careers pages, not a single posting.
    if (id.startsWith('seed-')) {
      setStatus({
        text: 'This is a sample row. Its link is a general careers page, so there is no posting to read. Real feed rows link to the actual posting.',
        kind: 'warn',
      });
      return;
    }
    setStatus({ text: 'Reading the posting for pay and details…', kind: 'busy' });

    parsePosting(opportunity.url)
      .then((r) => {
        if (openFor.current !== id) return;
        setParsed(r);
        // Only fill what the feed row and the member left empty.
        setForm((f) => {
          if (!f) return f;
          const next = { ...f };
          for (const k of ['company', 'title', 'location', 'workMode', 'salary'] as const) {
            if (!next[k] && r[k]) next[k] = r[k];
          }
          return next;
        });
        const gotBody = (r.description || '').length > 200;
        setStatus(
          gotBody
            ? { text: 'Read the posting. A prep sheet will be saved with it.', kind: 'ok' }
            : { text: `Couldn't read much from ${r.host}. Add any details you know.`, kind: 'warn' }
        );
      })
      .catch((err) => {
        if (openFor.current !== id) return;
        const why = (err as { message?: string })?.message;
        setStatus({
          text: `Couldn't read the posting${why ? ` (${why})` : ''}. Add any details you know.`,
          kind: 'warn',
        });
      });
  }, [opportunity]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!opportunity || !form || !store || saving) return;
    setSaving(true);
    try {
      const fields = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim()])
      ) as Form;
      const app = await store.createApplication({
        url: opportunity.url,
        ...parsedDetails(parsed),
        ...(fields as Partial<Application>),
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
          <header className="mb-3">
            <h2 className="font-display text-[1.2rem] font-semibold text-ink">Add to your tracker</h2>
            <p className="mt-0.5 text-[0.82rem] text-ink-soft">
              Nice, you applied. Check the details and it goes straight into your Tracker.
            </p>
          </header>
          {status.text && (
            <p className={`trk-status trk-status--${status.kind || 'plain'}`} role="status">
              {status.text}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
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
              <input
                className="portal-input"
                placeholder="e.g. $40/hr"
                value={form.salary}
                onChange={set('salary')}
              />
            </Field>
            <Field label="Applied on">
              <input className="portal-input" type="date" value={form.appliedAt} onChange={set('appliedAt')} />
            </Field>
            <Field label="Notes" wide>
              <textarea
                className="portal-input min-h-[72px] resize-y"
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
