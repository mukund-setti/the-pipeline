import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

/**
 * Local-dev only: the newest rows from the real opportunities table, so the
 * dev demo session (?demo=<school>) shows actual postings instead of the
 * sample rows. Reads with the service role key from .env, which never leaves
 * the dev server. Every production build answers 404.
 */
export const prerender = false;

export const GET: APIRoute = async () => {
  const notFound = new Response('Not found', { status: 404 });
  if (!import.meta.env.DEV) return notFound;
  const url = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return notFound;
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supa
    .from('opportunities')
    .select('*')
    .order('posted_at', { ascending: false })
    .limit(120);
  if (error) return notFound;
  return new Response(JSON.stringify(data ?? []), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
