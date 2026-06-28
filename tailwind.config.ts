import type { Config } from 'tailwindcss';

/**
 * The Pipeline: "Blueprint & Signal" design tokens, raw/brutalist cut.
 * Warm paper, ink-black structure, one raw red signal.
 * Discipline rule: `brand` (ink black) = the system / structure / "get in".
 * `signal` (red) = a human win / arrival. Never use red decoratively.
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F5F3EE', // page background (warm blueprint paper)
        surface: '#FFFFFF', // cards, lifted panels
        ink: {
          DEFAULT: '#111111', // primary text + dark bands
          2: '#1A1A1A', // lifted dark surface
          soft: '#666666', // muted body text (AA-safe on warm paper)
        },
        line: {
          DEFAULT: '#111111', // raw black borders/hairlines on light
          strong: '#111111', // hover border (already black)
          dark: 'rgba(245,243,238,0.14)', // hairlines on ink
        },
        brand: {
          DEFAULT: '#111111', // the structure: primary buttons, ink
          deep: '#000000', // hover/active
          soft: '#E8E4DD', // warm tint fills, callout bg
        },
        signal: '#FF2A2A', // raw red, arrivals only (landed dots, hero underline, CTA topline)
        ondark: {
          DEFAULT: '#F5F3EE', // text on ink
          soft: '#999999', // muted text on ink
          link: '#FF2A2A', // links on ink (red)
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Type scale (§3.4): fluid via clamp(), encoded as named roles.
      fontSize: {
        hero: ['clamp(2.7rem, 7.4vw, 6rem)', { lineHeight: '0.98', letterSpacing: '-0.025em' }],
        pagehero: ['clamp(2.4rem, 6vw, 4.4rem)', { lineHeight: '1.0', letterSpacing: '-0.025em' }],
        h2: ['clamp(1.9rem, 4.2vw, 3rem)', { lineHeight: '1.04', letterSpacing: '-0.02em' }],
        h3: ['1.2rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'h3-lg': ['1.5rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        lede: ['clamp(1.05rem, 1.7vw, 1.3rem)', { lineHeight: '1.55' }],
        stat: ['clamp(2.2rem, 4vw, 3.2rem)', { lineHeight: '1', letterSpacing: '-0.03em' }],
        eyebrow: ['0.72rem', { letterSpacing: '0.18em', lineHeight: '1' }],
      },
      borderRadius: {
        // Brutalist: sharp everywhere. Tokens kept so component intent stays readable.
        card: '0px',
        panel: '0px',
        pill: '0px',
      },
      maxWidth: {
        site: '1140px',
      },
      keyframes: {
        flow: { to: { transform: 'translateX(30px)' } },
        marquee: { to: { transform: 'translateX(-50%)' } },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Company logo fading up to full opacity.
        logoFade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        flow: 'flow 1.1s linear infinite',
        marquee: 'marquee 34s linear infinite',
        riseIn: 'riseIn 0.6s cubic-bezier(.2,.7,.2,1) both',
        logoFade: 'logoFade 1.4s ease-out 0.25s both',
      },
    },
  },
  plugins: [],
} satisfies Config;
