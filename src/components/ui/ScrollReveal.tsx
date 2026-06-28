import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * IntersectionObserver reveal wrapper (island). Children fade + rise ~12px on
 * enter. With `stagger`, direct children animate in sequence (for grids).
 *
 * Content is rendered visible on the server, so no-JS users see everything.
 * On mount we hide the targets and reveal them on intersection. Under reduced
 * motion (or without IntersectionObserver) we leave content untouched.
 */
interface Props {
  children?: ReactNode;
  stagger?: boolean;
  className?: string;
}

export default function ScrollReveal({ children, stagger = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;

    // Already in view at mount (above the fold): leave the server-rendered
    // visible state untouched so there is no hide-then-reveal flash.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    const targets: HTMLElement[] = stagger
      ? (Array.from(el.children) as HTMLElement[])
      : [el];

    const ease = 'cubic-bezier(.2,.7,.2,1)';
    targets.forEach((t, i) => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(12px)';
      t.style.transition = `opacity .55s ${ease} ${i * 70}ms, transform .55s ${ease} ${i * 70}ms`;
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            targets.forEach((t) => {
              t.style.opacity = '1';
              t.style.transform = 'none';
            });
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stagger]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
