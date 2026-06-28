// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

// TODO: set this to the real production domain before the final deploy.
// Canonical URLs + sitemap + OG absolute URLs all derive from `site`.
const SITE = 'https://the-pipeline.netlify.app';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Static by default; only the verification API endpoint opts into on-demand
  // rendering (it carries `export const prerender = false`). The Netlify
  // adapter turns that one route into a serverless function.
  output: 'static',
  adapter: netlify(),
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
