# Discord embed (WidgetBot)

The portal mirrors one Discord channel at `/portal/<school>/discord/` using
[WidgetBot](https://widgetbot.io). It is a read-and-write iframe onto a real
channel, not a copy of the messages.

This is separate from the custom chat at `/portal/<school>/chat/`, which stores
its own messages in Supabase. Both routes exist; see "Choosing one" below.

## Setup

1. **Turn on Developer Mode in Discord** — User Settings > Advanced > Developer
   Mode.
2. **Copy the IDs** — right-click the server icon > Copy Server ID, right-click
   the channel > Copy Channel ID.
3. **Invite the WidgetBot bot** to the server from https://widgetbot.io. The
   embed renders an error until the bot is actually in the server. This is the
   step people skip.
4. **Make the channel readable by `@everyone`.** WidgetBot shows what a
   logged-out Discord user could see. A channel locked to a role comes back
   empty.
5. **Whitelist the domains** in the WidgetBot dashboard: `pipelineco.org` and
   `localhost` for local dev.
6. **Set the env vars** in `.env` locally and in Vercel (Project Settings >
   Environment Variables):

   ```
   PUBLIC_WIDGETBOT_SERVER_ID=...
   PUBLIC_WIDGETBOT_CHANNEL_ID=...
   ```

Without the vars the page still builds and renders a "not configured" panel, so
a fork or a fresh clone is never broken by their absence.

## The access caveat, stated plainly

The embed is **not** protected by our Supabase auth. Whatever the channel shows
to a logged-out Discord user is what the iframe shows to anyone who loads the
page. `guardPortal` is client-side UX, and the page is `noindex`, but neither is
a real access control for third-party iframe content.

Two mitigations are in place:

- The iframe `src` is only set after the shell's veil lifts, so a visitor who
  fails the guard is redirected before any request reaches WidgetBot.
- The env var is documented as pointing at a channel you are comfortable
  treating as public.

**Do not point this at a private officers or admin channel.** If you need a
genuinely gated room, that is what the Supabase-backed `ChatApp` is for.

## Guest posting

WidgetBot lets unauthenticated web visitors post into the channel as guests by
default. Turn this off in the WidgetBot dashboard, or require Discord login,
unless someone is actively moderating. Anonymous posting into a student
community Discord gets abused quickly.

## Privacy

The iframe is a third-party embed and sets cookies. If a cookie banner or
privacy policy is added to the site, this needs to be listed, and ideally
gated behind consent.

## If a CSP is ever added

The site sends no `Content-Security-Policy` header today. If one is added, the
embed needs:

```
frame-src https://e.widgetbot.io
```

Without it the iframe fails silently — no console error, just an empty frame.

## Choosing one

| | `/chat` (ChatApp) | `/discord` (WidgetBot) |
|---|---|---|
| Storage | Our Supabase, RLS-protected | Discord's, public to the embed |
| Where members already are | No | Yes |
| Styling | Fully ours | WidgetBot's |
| Moderation | We build it | Discord's native tools |
| Third-party outage risk | None | Page section goes blank |

If the embed wins, removing the custom chat means deleting
`src/components/portal/ChatApp.tsx`, `src/pages/portal/[school]/chat.astro`, the
`channelsForSchool` rail block in `PortalShell.astro`, and the chat branches in
`src/lib/portal/`.
