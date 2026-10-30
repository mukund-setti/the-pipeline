/**
 * The guided tour's overlay: a dimmed page with a cut-out spotlight on the
 * element the current step is about, plus a tooltip beside it.
 *
 * Mounted on every portal page by PortalShell. It reads the stored step on
 * load and renders only if that step belongs to this page, which is how the
 * tour survives the full page load between Home and Opportunities.
 *
 * The dim is one element using a very large box-shadow spread rather than
 * four panels around the target: it animates as a single rect, so moving
 * between targets is one smooth transition instead of four that can tear.
 */
import { useEffect, useRef, useState } from 'react';
import {
  crossesPage,
  isLastStep,
  nextIndex,
  stepOnPage,
  TOUR_DONE_KEY,
  TOUR_STEP_KEY,
  TOUR_STEPS,
  type TourPage,
  type TourStep,
} from '../../lib/portal/tour';

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the tour just will not resume */
  }
};

const TOUR_PAGES: TourPage[] = ['home', 'opportunities', 'tracker'];

/**
 * `page` is PortalShell's `active`, which also covers surfaces the tour never
 * visits (chat, forum). Narrowing here rather than casting at the call site
 * means those pages simply have no step and render nothing.
 */
export default function TourOverlay({ page, base }: { page: string; base: string }) {
  const tourPage = TOUR_PAGES.includes(page as TourPage) ? (page as TourPage) : null;
  const [index, setIndex] = useState<number | null>(null);
  const [step, setStep] = useState<TourStep | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  /** Held true while the exit animation plays, before unmounting. */
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Pick up the stored step. Nothing renders unless it belongs to this page.
  useEffect(() => {
    if (!tourPage) return;
    if (read(TOUR_DONE_KEY) === '1') return;
    const stored = Number(read(TOUR_STEP_KEY) ?? '0');
    const i = Number.isFinite(stored) && stored >= 0 ? stored : 0;
    const s = stepOnPage(i, tourPage);
    if (!s) return;
    setIndex(i);
    setStep(s);
  }, [tourPage]);

  // Measure the target, and keep measuring while the page settles: islands
  // hydrate after this mounts, so a target can move or appear late.
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        // Viewport coordinates, matching the overlay's fixed positioning.
        // Document coordinates would be wrong here: the overlay's containing
        // block is the portal pane, not the page.
        setRect({
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        });
        if (tries === 0) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (tries > 40) {
        // The target never appeared (layout changed, island failed). Skip the
        // step rather than dimming the page with nothing highlighted.
        finish();
        return;
      }
      tries++;
      if (tries < 40) frame = requestAnimationFrame(measure);
    };
    measure();
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange);
    };
  }, [step]);

  // Escape leaves the tour, the same as Skip.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (step) cardRef.current?.focus();
  }, [step]);

  function finish() {
    write(TOUR_DONE_KEY, '1');
    const end = () => {
      setStep(null);
      setIndex(null);
      setClosing(false);
      window.dispatchEvent(new CustomEvent('portal:tour-ended'));
    };
    // Someone who asked for less motion gets the end immediately rather than
    // sitting through a fade they did not want.
    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      end();
      return;
    }
    setClosing(true);
    window.setTimeout(end, 220);
  }

  function advance() {
    if (index === null) return;
    const next = nextIndex(index);
    if (next === null) {
      finish();
      return;
    }
    write(TOUR_STEP_KEY, String(next));
    if (crossesPage(index)) {
      // The next step lives on another page: navigate, and it resumes there.
      const href = step?.href?.(base);
      if (href) {
        location.href = href;
        return;
      }
    }
    const s = tourPage ? stepOnPage(next, tourPage) : null;
    if (!s) {
      finish();
      return;
    }
    setIndex(next);
    setStep(s);
  }

  if (!step || !rect || index === null) return null;

  // Place below the target, fall back to above, then clamp into the
  // viewport. The clamp is what matters: a target taller than the space
  // around it (the resume card is) would otherwise push the tooltip off
  // the top of the screen.
  const CARD_H = 190;
  const MARGIN = 16;
  let cardTop = rect.top + rect.height + 12;
  if (cardTop + CARD_H > window.innerHeight - MARGIN) cardTop = rect.top - CARD_H - 12;
  cardTop = Math.max(MARGIN, Math.min(cardTop, window.innerHeight - CARD_H - MARGIN));
  const cardLeft = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - 320 - MARGIN));

  return (
    <div
      className={'portal-tour' + (closing ? ' portal-tour--out' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Portal tour"
    >
      {/* The dim: a transparent rect whose shadow covers everything else. */}
      <div
        className="portal-tour-spot"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      {/* A second ring on the same rect, breathing, to pull the eye to the
          target. Purely decorative, so it never takes pointer events. */}
      <div
        className="portal-tour-pulse"
        aria-hidden="true"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        className="portal-tour-card"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="portal-tour-progress">
          <span className="sr-only">
            Step {index + 1} of {TOUR_STEPS.length}
          </span>
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.key}
              aria-hidden="true"
              className={
                'portal-tour-dot' +
                (i === index ? ' is-current' : '') +
                (i < index ? ' is-done' : '')
              }
            />
          ))}
        </div>
        {/* Keyed on the step so the text animates in on each change instead
            of swapping while the card is still sliding. */}
        <div key={step.key} className="portal-tour-content">
          <h3 className="portal-tour-title">{step.title}</h3>
          <p className="portal-tour-body">{step.body}</p>
        </div>
        <div className="portal-tour-actions">
          <button type="button" className="portal-tour-skip" onClick={finish}>
            Skip
          </button>
          <button type="button" className="portal-tour-next" onClick={advance}>
            {isLastStep(index) ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
