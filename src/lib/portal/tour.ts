/**
 * Guided tour for a member's first visit to the portal.
 *
 * The portal is multi-page: every nav click is a full page load, so the tour
 * cannot hold its position in component state. The current step lives in
 * localStorage and each portal page picks it back up on load, which is what
 * lets a single tour walk someone from Home to Opportunities and keep going.
 *
 * Everything here is pure so the step machine can be tested without a browser.
 * The overlay that draws the spotlight is TourOverlay.tsx.
 */

/** Which portal page a step belongs to, matching PortalShell's `active`. */
export type TourPage = 'home' | 'opportunities' | 'tracker';

export type TourStep = {
  key: string;
  page: TourPage;
  /** Element the spotlight cuts out, found with querySelector. */
  target: string;
  title: string;
  body: string;
  /** Where the next step lives, when it is on another page. */
  href?: (base: string) => string;
};

/**
 * Four steps, in the order a member actually needs them: resume first because
 * matching depends on it, then the feed, then what ranks it, then where
 * applications land. Only one page change, at step 2, so the tour does not
 * bounce someone around the site.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    key: 'resume',
    page: 'home',
    target: '[data-tour="resume-card"]',
    title: 'Start with your resume',
    body: 'Drop it here once. It stays on hand for applications and powers your matches.',
  },
  {
    key: 'openings',
    page: 'home',
    target: '[data-tour="nav-opportunities"]',
    title: 'Every opening we track',
    body: 'Internships, new-grad roles and programs, refreshed daily from careers pages and job boards.',
    href: (base) => `${base}/opportunities/`,
  },
  {
    key: 'foryou',
    page: 'opportunities',
    target: '[data-tour="tier-toggle"]',
    title: 'For you ranks them against your resume',
    body: 'Top picks is the same for everyone. For you is yours, and every match shows why it matched.',
  },
  {
    key: 'applications',
    page: 'opportunities',
    target: '[data-tour="nav-applications"]',
    title: 'Everything you apply to lands here',
    body: 'Stages, notes and prep in one place, so you always know what is live.',
  },
];

export const TOUR_STEP_KEY = 'pipeline:tour-step';
export const TOUR_DONE_KEY = 'pipeline:tour-done';

/** Steps on this page, with their absolute index, in tour order. */
export function stepsForPage(page: TourPage): { step: TourStep; index: number }[] {
  return TOUR_STEPS.map((step, index) => ({ step, index })).filter(
    (s) => s.step.page === page
  );
}

/**
 * The step to show on this page, or null.
 *
 * Returns null when the stored step belongs to another page rather than
 * guessing a nearby one: a tour that silently jumps to a different step than
 * the one it promised is worse than a tour that waits.
 */
export function stepOnPage(index: number, page: TourPage): TourStep | null {
  const step = TOUR_STEPS[index];
  if (!step || step.page !== page) return null;
  return step;
}

export function isLastStep(index: number): boolean {
  return index >= TOUR_STEPS.length - 1;
}

/** Where "Next" goes: the following step's index, or null when finished. */
export function nextIndex(index: number): number | null {
  return isLastStep(index) ? null : index + 1;
}

/**
 * True when advancing from this step means loading another page, so the
 * overlay knows to navigate rather than just redraw.
 */
export function crossesPage(index: number): boolean {
  const here = TOUR_STEPS[index];
  const next = TOUR_STEPS[index + 1];
  return !!here && !!next && here.page !== next.page;
}
