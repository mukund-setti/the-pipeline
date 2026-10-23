/**
 * First-run checklist on the portal home. A new member lands on an empty
 * portal with a feed of thousands of openings and nothing telling them where
 * to start; this walks them to the point where the product is actually
 * theirs — resume on file, openings ranked against it.
 *
 * Deliberately a card, not a modal wizard. Blocking the portal behind a flow
 * students can abandon is worse than letting them explore and come back.
 *
 * All state is derived (see lib/portal/firstRun): it reads the member's real
 * resume and applications rather than stored progress flags, so it cannot
 * drift, and it is right across devices for free. The only stored bit is the
 * dismissal, which is a per-device preference.
 */
import { useEffect, useState } from 'react';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';
import type { Application } from '../../lib/portal/types';
import {
  completedCount,
  DISMISS_KEY,
  firstRunItems,
  nextStep,
  VIEWED_MATCHES_KEY,
  type FirstRunFacts,
} from '../../lib/portal/firstRun';
import { TOUR_DONE_KEY } from '../../lib/portal/tour';

export default function FirstRunCard({ school }: { school: string }) {
  const [facts, setFacts] = useState<FirstRunFacts | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume hidden until known

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      const [resume, apps] = await Promise.all([
        portal.store.getResume().catch(() => null),
        portal.store.listApplications().catch(() => [] as Application[]),
      ]);
      let viewedMatches = false;
      try {
        viewedMatches = localStorage.getItem(VIEWED_MATCHES_KEY) === '1';
      } catch {
        /* storage blocked: step stays unticked */
      }
      if (cancelled) return;
      setFacts({ hasResume: !!resume, viewedMatches, trackedCount: apps.length });
    };

    (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
        // The guided tour owns the first visit. Two onboarding things at
        // once is noise, so the checklist waits until the tour is done or
        // skipped and then takes over the "what to do next" job.
        if (localStorage.getItem(TOUR_DONE_KEY) !== '1') return;
      } catch {
        /* storage blocked: show the card */
      }
      if (!cancelled) setDismissed(false);
      await read();
    })();

    // The resume card is a separate island on this same page, so the
    // checklist only learns about an upload if it is told. Without this the
    // step stays unticked until a reload, which reads as broken.
    const onResume = () => void read();
    window.addEventListener('portal:resume-changed', onResume);
    // Appear as soon as the tour ends, without needing a reload.
    const onTourEnd = () => {
      if (cancelled) return;
      setDismissed(false);
      void read();
    };
    window.addEventListener('portal:tour-ended', onTourEnd);
    return () => {
      cancelled = true;
      window.removeEventListener('portal:resume-changed', onResume);
      window.removeEventListener('portal:tour-ended', onTourEnd);
    };
  }, [school]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage blocked: it comes back next visit, which is acceptable */
    }
  };

  // Nothing until the facts are in: a card that appears then vanishes is
  // worse than one that appears a beat late.
  if (dismissed || !facts) return null;
  const current = nextStep(facts);
  if (!current) return null;

  const items = firstRunItems(facts);
  const done = completedCount(facts);
  const base = `/portal/${school}`;
  const hrefFor = (key: string) =>
    key === 'resume'
      ? `${base}/`
      : key === 'matches'
        ? `${base}/opportunities/?view=foryou`
        : `${base}/applications/`;

  return (
    <section
      className="portal-card mb-6 p-5 sm:p-6"
      aria-labelledby="first-run-heading"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3
          id="first-run-heading"
          className="font-display text-[1.1rem] font-semibold tracking-tight text-ink"
        >
          Set up your portal
        </h3>
        <span className="text-[0.76rem] font-semibold text-ink-soft">{done} of 3</span>
      </div>

      <ol className="flex flex-col gap-1">
        {items.map((item) => {
          const isCurrent = item.key === current;
          return (
            <li
              key={item.key}
              className={
                'flex items-start gap-3 rounded-card px-3 py-2.5 transition-colors ' +
                (isCurrent ? '' : 'opacity-70')
              }
              style={isCurrent ? { background: 'var(--school-soft)' } : undefined}
            >
              <span
                aria-hidden="true"
                className={
                  'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[0.7rem] font-bold ' +
                  (item.done ? 'border-transparent text-canopy' : 'border-line-strong text-ink-soft')
                }
                style={item.done ? { background: 'var(--school-deep)', color: '#fff' } : undefined}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                {/* --school-soft is a fixed light blue that does not flip
                    with the theme, so everything on the active row sets its
                    colour from --school-deep rather than the ink tokens,
                    which go light in dark mode and vanish here. */}
                <span
                  className={
                    'block text-[0.92rem] font-semibold ' +
                    (item.done ? 'text-ink-soft line-through' : 'text-ink')
                  }
                  style={isCurrent ? { color: 'var(--school-deep)' } : undefined}
                >
                  {item.title}
                </span>
                {isCurrent && (
                  <span
                    className="mt-0.5 block text-[0.84rem] opacity-80"
                    style={{ color: 'var(--school-deep)' }}
                  >
                    {item.body}
                  </span>
                )}
              </span>
              {isCurrent && item.key !== 'resume' && (
                <a
                  href={hrefFor(item.key)}
                  className="flex-none rounded-pill px-3.5 py-1.5 text-[0.78rem] font-semibold transition-opacity hover:opacity-85"
                  style={{ background: 'var(--school-deep)', color: '#fff' }}
                >
                  {item.cta}
                </a>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-[0.78rem] text-ink-soft">
          {current === 'resume'
            ? 'Your resume is read on your device, never uploaded to rank openings.'
            : 'Takes about a minute.'}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="flex-none text-[0.78rem] text-ink-soft underline-offset-4 hover:text-ink hover:underline"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
