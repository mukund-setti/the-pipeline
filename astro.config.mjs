// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// TODO: set this to the real production domain before the final deploy.
// Canonical URLs + sitemap + OG absolute URLs all derive from `site`.
const SITE = 'https://the-pipeline.vercel.app';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Static by default; only the verification API endpoint opts into on-demand
  // rendering (it carries `export const prerender = false`). The Vercel
  // adapter turns that one route into a serverless function.
  output: 'static',
  adapter: vercel(),
  // Tokens live in tailwind.config.ts; we manage base styles ourselves.
  integrations: [
    tailwind({ applyBaseStyles: false }),
    react(),
    sitemap(),
  ],
  build: {
    // Inline all CSS so the first paint has no render-blocking stylesheet
    // request. The bundle is small (latin-only fonts + purged Tailwind).
    inlineStylesheets: 'always',
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
