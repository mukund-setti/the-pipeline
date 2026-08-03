import { useEffect, useState } from 'react';
import type { Placement } from '../../data/site';

/**
 * The placements marquee (island). A continuous brand-paced scroll of where
 * fellows have landed, paused on hover. Under reduced motion the animation is
 * killed (global CSS) and the rail becomes horizontally scrollable, so every
 * placement stays reachable.
 *
 * SSR renders the doubled, animated track so the effect works even before
 * hydration and with JS disabled. On mount we only collapse to a single,
 * static list when the user prefers reduced motion.
 */
export default function DropFeed({ placements }: { placements: Placement[] }) {
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) setAnimate(false);
  }, []);

  const List = ({ hidden = false }: { hidden?: boolean }) => (
    <>
      {placements.map((p, i) => (
        <span key={`${hidden ? 'b' : 'a'}-${i}`} className="inline-flex items-center gap-9" aria-hidden={hidden || undefined}>
          <span className="inline-flex items-baseline gap-3">
            <span className="h-2 w-2 flex-none translate-y-[-1px] rounded-full bg-gold" />
            <span className="font-display text-[1.18rem] font-semibold tracking-tight text-ondark">{p.org}</span>
            <span className="label text-[0.66rem] text-ondark-soft">{p.role}</span>
          </span>
          <span className="text-base text-ondark-soft/40" aria-hidden="true">·</span>
        </span>
      ))}
    </>
  );

  return (
    <div
      data-marquee
      className="marquee-fade relative overflow-hidden border-y border-line-dark py-[18px]"
    >
      <div
        className={
          'inline-flex w-max items-center gap-9 whitespace-nowrap will-change-transform' +
          (animate ? ' animate-marquee hover:[animation-play-state:paused]' : '')
        }
      >
        <List />
        {animate && <List hidden />}
      </div>
    </div>
  );
}
