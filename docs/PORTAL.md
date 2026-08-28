# The Pipeline member portal: operator guide

Everything you need to stand up, run, and extend the portal at `/portal/`.
Written for whoever holds the Supabase project and the Vercel deployment.

## What the portal is

Three chapter portals (UCI, UCLA, UCR) sharing one template. The layout,
navigation, and features are identical everywhere; each school only swaps in
its own color variables, so every chapter feels like the same product wearing
its campus colors.

Access: members sign in with their school email (Google or magic link) at
`/portal/`. The router derives their chapter from the email and forwards them
to `/portal/<school>/`. Nobody picks a school; the email decides.

The parts:

- **Opportunities**: an AI-tracked feed of internships, new grad roles, and
  programs, refreshed daily by the scanner (section 5).
- **Forum**: national writeups, questions, and resume threads. Every chapter
  reads and posts in one shared space.
- **Chat**: the national room, one private room per chapter, and shared topic
  channels (interview-prep, job-postings, resume-review, wins).

## 1. Database setup

Run `supabase/schema.sql` once in the Supabase SQL editor (Dashboard, SQL
Editor, New query, paste the whole file, Run). It is idempotent, so re-running
it after edits is safe.

It creates:

- `profiles`: one row per auth user, school stamped server-side from the email
  by `school_for_email()`, kept fresh by a trigger on `auth.users`.
- `channels`: the chat roster, seeded (national, one chapter room per campus,
  four topic channels).
- `messages`: chat, with realtime INSERT streaming enabled.
- `forum_posts` and `forum_replies`.
- `opportunities`: read-only to members; only the service role writes it.

How school access is enforced: every table has RLS on. Chapter channels check
the caller's derived school (`my_school()`, read from their profile row, which
was stamped from their auth email). The client never chooses its school, so
even a modified client cannot read or post in another chapter's room. The
browser guard in the portal UI is just UX; RLS is the real wall.

## 2. Auth providers

### Google (already working)

Google OAuth is configured and live. If you rotate the project or client,
re-add the redirect URLs from section 3 to both Supabase and the Google Cloud
OAuth client.

### Email magic links

Authentication, Providers, Email:

1. Toggle the Email provider **enabled**.
2. Turn **"Allow new users to sign up" ON**. If this is off, every magic-link
   attempt fails with "signups not allowed".

#### Why "email me a link" was not delivering

Supabase's built-in SMTP only delivers to email addresses on the project's
team, and it is rate-limited to roughly 2 emails per hour. Every other
recipient silently gets nothing: no bounce, no error, just no email. This is
why students never received their sign-in links.

The fix is custom SMTP:

1. Authentication, SMTP settings (on some dashboards: Project Settings, Auth).
2. Configure a real sender. Resend has a free tier that covers this easily:
   - Create a Resend API key.
   - Host: `smtp.resend.com`, port `465`, user `resend`, password = the API
     key.
   - Sender: a verified address on your domain, like `login@pipelineco.org`
     (verify the domain in Resend first).
3. Then raise the send cap under Authentication, Rate limits (the default is
   sized for the built-in mailer).

The join gate and portal sign-in now surface these failures with clear
messages ("rate limit hit", "sign-ups disabled") instead of a silent nothing,
so misconfiguration shows up immediately instead of looking like flakiness.

## 3. URL configuration

Authentication, URL Configuration:

- Site URL: `https://pipelineco.org`
- Additional redirect URLs:
  - `https://pipelineco.org/*`
  - `http://localhost:4321/*`

Without the localhost entry, magic links and OAuth returns break in local dev.

## 4. Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Client + server (existing) | Supabase project URL (Project Settings, API). |
| `PUBLIC_SUPABASE_ANON_KEY` | Client + server (existing) | Supabase anon key. Safe to ship; RLS does the guarding. |
| `DISCORD_INVITE_URL` | Server only (existing) | The gated Discord invite served by `/api/discord-invite`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Lets the opportunity scanner write `opportunities` rows. Bypasses RLS; never expose to the client. |
| `ANTHROPIC_API_KEY` | Server only, optional | Enables the Hacker News AI extraction in the scanner. Without it, the HN source is skipped. |
| `CRON_SECRET` | Server only | Protects `/api/opportunities-scan`. Vercel Cron sends it automatically as a Bearer token. |

Where to set them: `.env` locally (copy from `.env.example`), and the Vercel
project's environment variables in production. Redeploy after changing any of
them.

## 5. The opportunity scanner

What it does, per run:

- **Simplify GitHub boards**: the community-maintained internship and new-grad
  README tables, parsed directly. No AI needed.
- **Hacker News "Who is hiring"**: the current month's thread, with Claude
  extracting structured roles from freeform comments. Only runs when
  `ANTHROPIC_API_KEY` is set.

New rows are upserted into `opportunities` (deduped by URL), which members see
in the Opportunities tab.

Scheduling: a daily Vercel cron defined in `vercel.json` calls the endpoint in
production; Vercel authenticates the request with `CRON_SECRET` as a Bearer
token.

Manual trigger in local dev:

```bash
curl -X POST -H "Content-Type: application/json" -H "x-scan-secret: YOUR_CRON_SECRET" http://localhost:4321/api/opportunities-scan
```

Note: the endpoint is serverless (`prerender = false`), so it needs `astro
dev` running; it does not exist in a static preview build.

## 6. Access control

Who gets a portal:

- Emails on `uci.edu`, `ucla.edu`, or `ucr.edu`, including subdomains (so
  `name@g.ucla.edu` passes).
- Founder and officer overrides for non-campus emails. These live in **two
  places that must stay in sync**: `FOUNDER_ACCESS` in `src/lib/schools.ts`
  (client routing) and the override cases in `school_for_email()` in
  `supabase/schema.sql` (the actual RLS enforcement). Add every override to
  both, then re-run the schema file.

Other UC students: they verify through `/join/` and get the Discord, but
`/portal/` shows them a "your chapter portal is on the way" state.

Non-UC visitors: blocked at both gates, pointed at the interest form.

What actually enforces this: every portal RLS policy requires
`is_portal_member()` (the caller's email derives to a live chapter), so an
account created directly against the Supabase API with a random email holds a
session but can read and write nothing. The email allowlist in the UI is UX,
not security. Optional extra hardening: a Supabase "Before user created" auth
hook that rejects non-partner emails outright, so stray accounts are never
created at all (Dashboard > Authentication > Hooks).

## 7. Local dev

```bash
npm run dev
```

- Demo sessions: open `/portal/uci/?demo=uci` (or `ucla`/`ucr`) for a fake
  signed-in member with seeded data. This works in dev builds only and is
  compiled out of production.
- Demo data lives in `localStorage`, so it survives reloads; clear site data
  to reseed.
- Real sign-in also works locally once the Supabase env vars are in `.env`
  and localhost is in the redirect URLs (section 3).

## 8. Adding a campus checklist

1. Add the school to `PORTAL_SCHOOLS` in `src/lib/schools.ts` (slug, name,
   short, mascot, email domains, colors).
2. In `supabase/schema.sql`: add the domain case to `school_for_email()`, and
   add the chapter channel row (`chapter-<slug>`) to the channels seed. Re-run
   the file in the SQL editor.
3. Add the colors: a `[data-school='<slug>']` variable block and a
   `.portal-school-tag[data-tag='<slug>']` rule in `src/styles/portal.css`.
4. Redeploy. The static build picks up the new `/portal/<slug>/` pages from
   `PORTAL_SCHOOLS` automatically.
