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
          DEFAULT: '#17380E', // deep fern (hero bands, footer)
          2: '#1C4A12', // lifted dark surface (cards on fern)
          3: '#265F17', // hover dark surface
        },
        gold: {
          DEFAULT: '#A6E17A', // lime accent on dark (links, marks)
          deep: '#3E9B1F', // sprout that passes contrast on cream
          bright: '#53B72A', // primary button fill (sprout)
          pale: '#CDF0A9', // gradient light end / button hover
        },
        // ── Legacy-named roles, retoned (low-touch aliases) ──
        bg: '#F2F9EA', // pale leaf cream (reading sections)
        surface: '#FBFFF4', // cards, lifted panels, header bar
        ink: {
          DEFAULT: '#1E3315', // dark loam green: primary text on cream
          2: '#1C4A12', // = canopy.2 (fern)
          soft: '#587A4A', // muted moss body text (AA on cream)
        },
        line: {
          DEFAULT: '#DCEBCB', // soft hairlines on cream
          strong: '#A9C98F', // hover border on cream
          dark: 'rgba(230,247,214,0.16)', // hairlines on fern
        },
        brand: {
          DEFAULT: '#2E6B1C', // mid green: secondary fills, chips
          deep: '#245415', // hover green
          soft: '#E6F5D5', // lime tint fills, callout bg
        },
        signal: '#3E9B1F', // = gold.deep (arrival marks on light surfaces)
        ondark: {
          DEFAULT: '#F2FBEA', // pale cream text on fern
          soft: '#AFD49B', // muted lime-sage text on fern
          link: '#A6E17A', // links on fern (lime)
        },
      },
      fontFamily: {
        display: ['"Baloo 2"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Quicksand', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Quicksand', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
          '0%, 100%': { boxShadow: '0 0 0 6px rgba(166,225,122,0.22)' },
          '50%': { boxShadow: '0 0 0 11px rgba(166,225,122,0.09)' },
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
