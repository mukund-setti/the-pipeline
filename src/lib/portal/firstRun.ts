/**
 * First-run checklist state for the portal home.
 *
 * Nothing here is stored. Each step is derived from data the home page
 * already loads, so the checklist cannot drift out of sync with reality: it
 * reads the member's actual resume and applications rather than a flag
 * somebody remembered to set. That also means it is correct across devices
 * for free, and that deleting a resume honestly un-checks that step.
 *
 * The one piece of real state is the member's choice to dismiss it, which
 * lives in localStorage because it is a per-device preference, not a fact
 * about the member.
 */

export type FirstRunFacts = {
  hasResume: boolean;
  /** Has the member opened the "For you" view at least once? */
  viewedMatches: boolean;
  trackedCount: number;
};

export type FirstRunStep = 'resume' | 'matches' | 'track';

export type FirstRunItem = {
  key: FirstRunStep;
  title: string;
  body: string;
  /** Label for the action when this is the current step. */
  cta: string;
  done: boolean;
};

export const DISMISS_KEY = 'pipeline:first-run-dismissed';
/** Set by the Opportunities page the first time "For you" is opened. */
export const VIEWED_MATCHES_KEY = 'pipeline:viewed-matches';

/** The checklist, in order, with each step's done state resolved. */
export function firstRunItems(facts: FirstRunFacts): FirstRunItem[] {
  return [
    {
      key: 'resume',
      title: 'Add your resume',
      // No button on this step: the resume card sits directly below on the
      // same page, so pointing at it beats a link that goes nowhere new.
      body: 'Drop it in the card below. It powers your matches and is ready when you apply.',
      cta: 'Upload',
      done: facts.hasResume,
    },
    {
      key: 'matches',
      title: 'See roles matched to you',
      body: 'Openings ranked against your resume, with the reasons shown.',
      cta: 'Open For you',
      done: facts.viewedMatches,
    },
    {
      key: 'track',
      title: 'Track your first application',
      body: 'Keep stages, notes and prep in one place instead of a spreadsheet.',
      cta: 'Open Applications',
      done: facts.trackedCount > 0,
    },
  ];
}

/**
 * The step to nudge next, or null when there is nothing left to do (which is
 * also the signal to stop rendering the card).
 *
 * Steps resolve in order rather than by "first incomplete" so the card does
 * not jump backwards: someone who tracked an application before uploading a
 * resume is still asked for the resume first, since matches depend on it.
 */
export function nextStep(facts: FirstRunFacts): FirstRunStep | null {
  return firstRunItems(facts).find((i) => !i.done)?.key ?? null;
}

/** How many steps are complete, for the "2 of 3" counter. */
export function completedCount(facts: FirstRunFacts): number {
  return firstRunItems(facts).filter((i) => i.done).length;
}
