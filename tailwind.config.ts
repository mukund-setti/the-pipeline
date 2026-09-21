import type { Config } from 'tailwindcss';

/**
 * The Pipeline: "Sprout & Lime" design tokens (Sept 2026 rebrand).
 * Bright sprout green carries the brand, lime is the accent, deep fern
 * anchors dark bands and text, and a near-white green cream carries the
 * reading sections. The old token NAMES are kept (canopy, gold, ...) so
 * every component retones without edits: `canopy` now means deep fern,
 * `gold` now means the lime/sprout accent family.
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        // ── Sprout & Lime core (legacy names) ───────────────
        canopy: {
          DEFAULT: '#143D2B', // deep grove (hero bands, footer)
          2: '#1B4E37', // lifted dark surface (cards on grove)
          3: '#236048', // hover dark surface
        },
        gold: {
          DEFAULT: '#6FCF6A', // spring accent on dark (links, marks)
          deep: '#6FCF6A', // bright accent that reads on dark
          bright: '#6FCF6A', // primary button fill (spring)
          pale: '#8CDD88', // gradient light end / button hover
        },
        // ── Legacy-named roles, retoned (low-touch aliases) ──
        bg: '#0F1411', // near-black green (dark experiment)
        surface: '#171E19', // dark cards, panels, header bar
        ink: {
          DEFAULT: '#E8F1E6', // light ink on the dark ground
          2: '#DFEEDD', // bright ink for emphasis on dark
          soft: '#9DB4A0', // muted sage body text on dark
        },
        line: {
          DEFAULT: 'rgba(223,238,221,0.14)', // hairlines on dark
          strong: 'rgba(223,238,221,0.3)', // hover border on dark
          dark: 'rgba(223,238,221,0.16)', // hairlines on grove
        },
        brand: {
          DEFAULT: '#256B3C', // pine: secondary fills, chips
          deep: '#1D5530', // hover pine
          soft: '#1C2B20', // dark tint fills, callout bg
        },
        signal: '#6FCF6A', // = gold.deep (arrival marks)
        ondark: {
          DEFAULT: '#F3F8EE', // snowdrop text on grove
          soft: '#C4DAC4', // muted sage text on grove
          link: '#6FCF6A', // links on grove (spring)
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'ui-serif', 'serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Type scale: fluid via clamp(), tuned for a serif display face.
      fontSize: {
        hero: ['clamp(2.6rem, 6.6vw, 5.4rem)', { lineHeight: '1.04', letterSpacing: '-0.015em' }],
        pagehero: ['clamp(2.3rem, 5.4vw, 4rem)', { lineHeight: '1.06', letterSpacing: '-0.015em' }],
        h2: ['clamp(1.85rem, 4vw, 2.8rem)', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        h3: ['1.2rem', { lineHeight: '1.3', letterSpacing: '0' }],
        'h3-lg': ['1.45rem', { lineHeight: '1.2', letterSpacing: '0' }],
        lede: ['clamp(1.05rem, 1.7vw, 1.28rem)', { lineHeight: '1.6' }],
        stat: ['clamp(2.2rem, 4vw, 3.1rem)', { lineHeight: '1', letterSpacing: '-0.02em' }],
        eyebrow: ['0.74rem', { letterSpacing: '0.16em', lineHeight: '1.2' }],
      },
      borderRadius: {
        card: '18px',
        panel: '26px',
        pill: '999px',
        field: '12px',
      },
      maxWidth: {
        site: '1140px',
      },
      keyframes: {
        flow: { to: { transform: 'translateX(34px)' } },
        marquee: { to: { transform: 'translateX(-50%)' } },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Company logo fading up to full opacity.
        logoFade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Soft breathing glow for the conduit arrival tip.
        glow: {
          '0%, 100%': { boxShadow: '0 0 0 6px rgba(111,207,106,0.22)' },
          '50%': { boxShadow: '0 0 0 11px rgba(111,207,106,0.09)' },
        },
      },
      animation: {
        flow: 'flow 1.4s linear infinite',
        marquee: 'marquee 34s linear infinite',
        riseIn: 'riseIn 0.7s cubic-bezier(.2,.7,.2,1) both',
        logoFade: 'logoFade 1.4s ease-out 0.25s both',
        glow: 'glow 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
