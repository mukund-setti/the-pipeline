# Setting up university verification

The Discord invite is gated: a visitor must verify a partner-university email (UC system for now) before the invite is revealed. The site builds and runs without this configured (the gate just shows "not live yet"), so wiring it up is the last step before going live.

You need a free Supabase project. Email codes work with only Supabase. Google sign-in needs an extra Google Cloud step.

## 1. Create a Supabase project

1. Go to supabase.com, create a project.
2. Project Settings, API: copy the **Project URL** and the **anon public** key.

## 2. Email codes (works out of the box)

Supabase's Email provider is on by default. One thing to check so it sends a **code** and not just a magic link:

- Authentication, Emails, edit the OTP/Magic Link template and make sure it includes the token, for example: "Your code is `{{ .Token }}`". The gate calls `verifyOtp({ type: 'email' })`, which expects the 6-digit token.
- For real volume, add your own SMTP under Authentication, Emails, so codes are not throttled by Supabase's shared limit.

## 3. Google sign-in (optional, requested)

1. Google Cloud Console: create an OAuth 2.0 Client (type: Web application).
2. Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. Supabase, Authentication, Providers, Google: paste the Client ID and Secret, enable it.

## 4. Auth URLs

Supabase, Authentication, URL Configuration:

- Site URL: your production URL (e.g. https://the-pipeline.netlify.app).
- Redirect URLs: add `https://YOUR-DOMAIN/join` and, for local dev, `http://localhost:4321/join`.

## 5. Environment variables

Local: copy `.env.example` to `.env` and fill in:

- `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (from step 1)
- `DISCORD_INVITE_URL` (already set to your invite)

Netlify: Site settings, Environment variables, add the same three.

## 6. Partner universities

The allowlist lives in [`src/lib/partners.ts`](src/lib/partners.ts), seeded with the full UC system. Subdomains pass too (so `name@g.ucla.edu` works). To add a partner school later, add one line there. That single list drives both the instant client-side message and the server-side gate.

## 7. Optional hardening

The server endpoint already refuses to hand the invite to a non-partner email, which is the real gate. If you also want to stop non-partner accounts from being created at all, add a Supabase "Before user created" auth hook (Authentication, Hooks) that rejects emails whose domain is not in the partner list.

## How the gating works

- The invite is stored only in `DISCORD_INVITE_URL` on the server. It is never shipped to the browser.
- `/api/discord-invite` validates the Supabase session server-side, checks the email domain against the partner list, and only then returns the invite. Tampering with the client cannot get the link without a verified partner email.
- The dev-only `?gate=verified|blocked|codeSent` preview (for design review) is stripped from production builds.

## Test it

`npm run dev`, open `/join`:

- Enter a `uci.edu` (or any UC) email, get the code, verify, then "Open the Discord."
- A non-UC email shows the "we're not at your campus yet" screen and never receives the invite.
