# The Pipeline

A fellow-run community across the UC system moving underrepresented technologists into the rooms they were kept out of. This is the marketing site: built with Astro, Tailwind, and TypeScript, following the "Blueprint & Signal" design system in `pipelinespec.pdf`.

## Stack

- **Astro 5** (static output) with two small React islands and a progressively-enhanced verification gate.
- **Tailwind CSS 3** with all design tokens encoded in `tailwind.config.ts` (zero hardcoded hex in components).
- **TypeScript** (strict).
- **Self-hosted fonts** via `@fontsource` (Bricolage Grotesque, Inter, JetBrains Mono). No Google Fonts network call.
- **@astrojs/sitemap** for `sitemap-index.xml`.
- **Supabase Auth** + a single on-demand endpoint (via the **@astrojs/vercel** adapter) for the university verification gate. Every other page is fully static.

## University verification

The Discord invite is gated: a student verifies a partner-university email (UC system for now) with Google or a one-time code, and only then does the server hand back the invite. The invite is never shipped to the browser. This is the only dynamic part of the site. See **[SETUP-VERIFICATION.md](SETUP-VERIFICATION.md)** to turn it on (a free Supabase project). Until configured, the gate renders but stays inert. Edit the partner list in [`src/lib/partners.ts`](src/lib/partners.ts).

## Commands

```bash
npm install        # install dependencies
npm run dev        # local dev server at http://localhost:4321
npm run build      # production build to dist/
npm run preview    # serve the production build locally
npx astro check    # type-check (currently 0 errors)
```

## Where the content lives

**All copy and data is in one file: [`src/data/site.ts`](src/data/site.ts).** Edit it once and every page updates. It holds: nav, external links, placements, stats, the three stages, the feature grid, the FAQ, the About story, the checklists, the join steps, and the verbatim voice lines.

### Before you publish

1. **Turn on verification.** Follow [SETUP-VERIFICATION.md](SETUP-VERIFICATION.md) (create a Supabase project, set the env vars). The Discord invite lives in `DISCORD_INVITE_URL`, not in `site.ts`.
2. **Real links.** Replace the remaining placeholders in `links` (`form` and `contact`).
3. **Verify placements.** Confirm every entry in `placements` is accurate and approved. Do not invent placements.

### Set the production domain

Canonical URLs, the sitemap, and absolute OG image URLs all derive from `site` in [`astro.config.mjs`](astro.config.mjs). It is currently set to a placeholder (`https://the-pipeline.vercel.app`). Update it to the real domain, and update the `Sitemap:` line in [`public/robots.txt`](public/robots.txt) to match.

## Project structure

```
src/
  components/
    Layout.astro        <head>, SEO, fonts, skip link, header + footer wrappers
    Header.astro        sticky nav, active-link aware
    Footer.astro
    ui/                 the component library (Button, Eyebrow, SectionHead,
                        Conduit, DropFeed island, StatGrid/Stat, StageCard,
                        FeatureCard, OutcomeCard, StepRow, Checklist, Callout,
                        CtaBand, JoinCard, Faq/FaqItem, PageHero, Icon, Mark,
                        ScrollReveal island)
  pages/                index, how, outcomes, about, join, 404
    api/discord-invite.ts  on-demand endpoint that gates the invite (the only non-static route)
  lib/                  partners.ts (university allowlist), supabase.ts (browser client)
  data/site.ts          single source of truth for copy + data
  styles/global.css     @tailwind + base + grain/light effects + reduced-motion
public/                 favicon.svg, og-canopy.png, robots.txt
scripts/                make-og.mjs (OG image), shoot.mjs/verify.mjs (QA screenshots)
prototype/              the original hand-built HTML/CSS reference (not deployed)
```

## Design system notes

- "Canopy & Light": deep forest canopy (`#0F1912`) frames the site (header, hero, bands, footer), warm daylight parchment (`#F1EEE2`) carries the reading sections, and one sunlit gold (`#D9A84C`) is the only accent. Fraunces serif display, Instrument Sans body, rounded corners, soft paper grain, and a sprout-in-conduit logo.
- Tokens are in `tailwind.config.ts`. Use them (`text-ink`, `bg-canopy`, `text-gold`, `border-line`, `font-display`, `animate-flow`, etc). The only literal colors in the codebase are the brand logo SVG (`Mark.astro`), the Google "G" in the verify gate, and a few rgba/gradient values in `global.css`.
- **Discipline rule:** green holds structure; `gold` is warmth, arrival, and the primary action (landed markers, the hero's gradient word, CTAs, the conduit tip). Nothing else gets to be loud.
- Photos live in `public/img/` (optimized WebP). Regenerate from `LovableUI`/`images` sources if needed.
- **Motion** is choreographed and fully reduced-motion-safe: the conduit current, the drop-feed marquee, page-load rise, and scroll reveals all stop under `prefers-reduced-motion: reduce`, and the marquee becomes horizontally scrollable so nothing is lost.

## Regenerating the OG image

`public/og-canopy.png` (1200x630) is rendered in headless Chrome from the brand fonts:

```bash
node scripts/make-og.mjs
```

## Deploy

The build is static, so it hosts anywhere.

- **Vercel (current setup):** import the GitHub repo at vercel.com. Astro is auto-detected and the `@astrojs/vercel` adapter turns the verification endpoint into a serverless function. Add the three environment variables from [SETUP-VERIFICATION.md](SETUP-VERIFICATION.md) under Project Settings, Environment Variables.
- **Other hosts:** the verification endpoint needs a server runtime, so swap the adapter (e.g. `@astrojs/netlify`) if you move off Vercel. Everything else is static.

After deploying, set the real domain in `astro.config.mjs` (`site`) and `public/robots.txt`, then confirm every internal link and the Join buttons resolve, and that Lighthouse is >=95.
