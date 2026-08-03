import type { Config } from 'tailwindcss';

/**
 * The Pipeline: "Canopy & Light" design tokens.
 * Deep forest canopy frames the site (header, hero, bands, footer); warm
 * daylight parchment carries the reading sections; one sunlit gold accent.
 * Discipline rule: `gold` = warmth, arrival, and the primary action. Green
 * holds structure. Nothing else gets to be loud.
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        // ── Canopy & Light core ─────────────────────────────
        canopy: {
          DEFAULT: '#0F1912', // deepest forest (hero, footer, bands)
          2: '#16241A', // lifted dark surface (cards on canopy)
          3: '#1E3024', // hover dark surface
        },
        gold: {
          DEFAULT: '#D9A84C', // sunlight gold on dark (accents, links on canopy)
          deep: '#A9781F', // gold that passes contrast on daylight
          bright: '#E8BE6A', // primary button fill / gradient high end
          pale: '#F2DCA4', // gradient light end ("Together." shimmer)
        },
        // ── Legacy-named roles, retoned (low-touch aliases) ──
        bg: '#F1EEE2', // daylight parchment (reading sections)
        surface: '#FAF7EC', // cards, lifted panels on daylight
        ink: {
          DEFAULT: '#222B20', // loam: primary text on daylight
          2: '#16241A', // = canopy.2
          soft: '#5C6553', // moss grey: muted body text (AA on parchment)
        },
        line: {
          DEFAULT: '#DCD6C2', // soft hairlines on daylight
          strong: '#A9AE97', // hover border on daylight
          dark: 'rgba(242,236,218,0.14)', // hairlines on canopy
        },
        brand: {
          DEFAULT: '#2C4434', // pine: secondary fills, chips
          deep: '#22362A', // hover pine
          soft: '#E6E4D0', // sage tint fills, callout bg
        },
        signal: '#A9781F', // = gold.deep (arrival marks on light surfaces)
        ondark: {
          DEFAULT: '#F3EEDC', // warm cream text on canopy
          soft: '#A8B29A', // muted sage text on canopy
          link: '#D9A84C', // links on canopy (gold)
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
          '0%, 100%': { boxShadow: '0 0 0 6px rgba(217,168,76,0.18)' },
          '50%': { boxShadow: '0 0 0 11px rgba(217,168,76,0.07)' },
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
