/**
 * Chat island: the Slack-style room at /portal/<school>/chat. Renders exactly
 * one channel, chosen by the ?channel= query param and validated against the
 * chapter's roster (unknown slugs fall back to #national). Messages come from
 * the shared portal store: an initial listMessages load, a realtime
 * onMessage subscription, and an 8 second poll merged by id so live stores
 * without realtime still update. Bottom-anchored list with day dividers and
 * 5 minute author grouping; Enter sends, Shift+Enter breaks the line.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, ChatMessage } from '../../lib/portal/types';
import { channelsForSchool } from '../../lib/portal/types';
import { waitForPortalUser, initPortalData } from '../../lib/portal/data';
import type { PortalData } from '../../lib/portal/data';
import { schoolBySlug } from '../../lib/schools';

const MAX_LEN = 4000;
const COUNTER_AT = 3500;
const POLL_MS = 8_000;
const GROUP_GAP_MS = 5 * 60_000;
const NEAR_BOTTOM_PX = 120;
const MAX_COMPOSER_PX = 152; // roughly 6 rows of text

/** Schools that get a colored tag chip in cross-campus rooms. */
const TAGGED_SCHOOLS = ['uci', 'ucla', 'ucr'];

/** Tiny relative-time formatter: "just now", "12m", "3h", "2d", then a date. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Day-divider label: "Today", "Yesterday", or a short date. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const daysApart = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (daysApart === 0) return 'Today';
  if (daysApart === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'group'; key: string; own: boolean; msgs: ChatMessage[] };

/**
 * Fold a sorted message list into day dividers plus author groups:
 * consecutive messages by the same author within 5 minutes share one header.
 */
function buildRows(messages: ChatMessage[], viewerId: string): Row[] {
  const rows: Row[] = [];
  let prev: ChatMessage | null = null;
  for (const m of messages) {
    const day = new Date(m.createdAt).toDateString();
    const sameDay = prev !== null && new Date(prev.createdAt).toDateString() === day;
    if (!sameDay) {
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.createdAt) });
    }
    const last = rows[rows.length - 1];
    const gap = prev ? new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity;
    if (
      sameDay &&
      prev !== null &&
      prev.userId === m.userId &&
      gap <= GROUP_GAP_MS &&
      last?.kind === 'group'
    ) {
      last.msgs.push(m);
    } else {
      rows.push({ kind: 'group', key: `grp-${m.id}`, own: m.userId === viewerId, msgs: [m] });
    }
    prev = m;
  }
  return rows;
}

function sortByTime(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** One author group: avatar, header (name, school tag, time), then bodies. */
function MessageGroup({
  msgs,
  own,
  viewerSchool,
}: {
  msgs: ChatMessage[];
  own: boolean;
  viewerSchool: string;
}) {
  const first = msgs[0];
  const showTag = first.school !== viewerSchool && TAGGED_SCHOOLS.includes(first.school);
  return (
    <div
      className={own ? 'flex gap-3 py-2 pl-[17px] pr-5' : 'flex gap-3 px-5 py-2'}
      style={
        own
          ? {
              borderLeft: '3px solid var(--school-soft)',
              background: 'color-mix(in srgb, var(--school-soft) 26%, transparent)',
            }
          : undefined
      }
    >
      <span className="portal-avatar mt-0.5" aria-hidden="true">
        {(first.authorName[0] || '?').toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[0.92rem] font-semibold text-ink">{first.authorName}</span>
          {showTag && (
            <span className="portal-school-tag" data-tag={first.school}>
              {first.school.toUpperCase()}
            </span>
          )}
          <span className="text-[0.72rem] text-ink-soft">{relativeTime(first.createdAt)}</span>
        </div>
        {msgs.map((m) => (
          <p
            key={m.id}
            className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-ink"
          >
            {m.body}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Loading placeholder: header bar plus three pulsing message groups. */
function ChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
      <div className="border-b border-line bg-surface px-5 py-3">
        <div className="h-5 w-44 animate-pulse rounded-pill bg-line/50" />
      </div>
      <div className="flex-1 space-y-7 overflow-hidden px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <span className="h-[34px] w-[34px] flex-none rounded-xl bg-line/50" />
            <span className="min-w-0 flex-1 space-y-2 pt-0.5">
              <span className="block h-3 w-36 rounded-pill bg-line/50" />
              <span className="block h-3 w-3/4 rounded-pill bg-line/50" />
              <span className="block h-3 w-1/2 rounded-pill bg-line/50" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatApp({ school }: { school: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [tick, setTick] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** True while the viewer is at (or near) the bottom of the list. */
  const stickRef = useRef(true);
  const countRef = useRef(0);

  const short = useMemo(() => schoolBySlug(school)?.short ?? school.toUpperCase(), [school]);

  /** Merge incoming messages by id; keep the same array when nothing is new. */
  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const base = prev ?? [];
      const byId = new Map(base.map((m) => [m.id, m]));
      let changed = prev === null;
      for (const m of incoming) {
        if (!byId.has(m.id)) {
          byId.set(m.id, m);
          changed = true;
        }
      }
      if (!changed) return prev;
      return [...byId.values()].sort(sortByTime);
    });
  }, []);

  // Resolve the member, pick the channel from the URL, then load + subscribe
  // + poll. The sidebar switches channels via full page loads, so this runs
  // exactly once per mount.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: number | null = null;
    (async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      if (portal.notice === 'setup-required') {
        window.dispatchEvent(new CustomEvent('portal:notice'));
      }
      const roster = channelsForSchool(user.school);
      const requested = new URLSearchParams(location.search).get('channel') || 'national';
      const active =
        roster.find((c) => c.slug === requested) ?? roster.find((c) => c.slug === 'national')!;
      setData(portal);
      setChannel(active);

      const initial = await portal.store.listMessages(active.slug);
      if (cancelled) return;
      merge(initial);

      unsubscribe = portal.store.onMessage(active.slug, (m) => merge([m]));
      timer = window.setInterval(async () => {
        try {
          const rows = await portal.store.listMessages(active.slug);
          if (!cancelled) merge(rows);
        } catch {
          /* transient fetch error: the next poll retries */
        }
      }, POLL_MS);
    })();
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [school, merge]);

  // Keep relative times and day labels fresh.
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Bottom anchoring: follow new messages when already near the bottom,
  // otherwise offer a jump pill instead of yanking the scroll position.
  useEffect(() => {
    if (!messages) return;
    const el = listRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else if (messages.length > countRef.current) {
      setShowJump(true);
    }
    countRef.current = messages.length;
  }, [messages]);

  // Auto-grow the composer up to ~6 rows.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [draft, channel]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickRef.current = near;
    if (near) setShowJump(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickRef.current = true;
    setShowJump(false);
  }, []);

  const handleSend = useCallback(async () => {
    if (!data || !channel || sending) return;
    const body = draft.trim();
    if (!body) return;
    setSendError(null);
    setSending(true);
    const restore = draft;
    setDraft('');
    try {
      const sent = await data.store.sendMessage(channel.slug, body);
      stickRef.current = true;
      merge([sent]);
      // Scroll explicitly: if realtime already delivered our own message,
      // merge() is a no-op and the effect keyed on [messages] never fires.
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setShowJump(false);
      });
    } catch {
      setSendError('Your message did not send. Check your connection and try again.');
      setDraft(restore);
    } finally {
      setSending(false);
    }
  }, [data, channel, draft, sending, merge]);

  // tick is a dependency on purpose: it re-labels "just now" / "Today" rows.
  const rows = useMemo(
    () => (messages && data ? buildRows(messages, data.user.id) : []),
    [messages, data, tick]
  );

  if (!data || !channel || !messages) return <ChatSkeleton />;

  const scopeLabel = channel.scope === 'chapter' ? `${short} only` : 'All chapters';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Channel header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-5 py-3">
        <h2 className="font-display text-[1.05rem] font-semibold tracking-tight text-ink">
          <span aria-hidden="true" className="mr-0.5 font-sans font-semibold text-ink-soft">
            #
          </span>
          {channel.name}
        </h2>
        <span className={channel.scope === 'chapter' ? 'portal-chip' : 'portal-chip portal-chip--gold'}>
          {scopeLabel}
        </span>
        <p className="w-full truncate text-[0.82rem] text-ink-soft md:w-auto md:flex-1">
          {channel.description}
        </p>
      </div>

      {/* Message list */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto pb-4 pt-2"
          role="log"
          aria-live="polite"
          aria-label={`Messages in #${channel.name}`}
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-card bg-brand-soft font-display text-xl font-semibold text-brand">
                #
              </span>
              <p className="font-display text-[1.05rem] font-semibold text-ink">
                Welcome to <span className="text-ink-soft">#</span>
                {channel.name}
              </p>
              <p className="max-w-[40ch] text-[0.88rem] leading-relaxed text-ink-soft">
                Nobody has posted here yet. Say hello and get the conversation going.
              </p>
            </div>
          ) : (
            rows.map((row) =>
              row.kind === 'day' ? (
                <div key={row.key} className="flex items-center gap-3 px-5 pb-1 pt-4">
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                  <span className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
                    {row.label}
                  </span>
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                </div>
              ) : (
                <MessageGroup
                  key={row.key}
                  msgs={row.msgs}
                  own={row.own}
                  viewerSchool={data.user.school}
                />
              )
            )
          )}
        </div>

        {showJump && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="portal-btn-ghost absolute bottom-4 left-1/2 -translate-x-1/2 bg-surface px-3.5 py-1 text-[0.78rem] shadow-lg"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            New messages
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 border-t border-line bg-bg px-4 pb-4 pt-3">
        {sendError && (
          <p className="mb-2 px-1 text-[0.8rem] font-medium text-gold-deep" role="alert">
            {sendError}
          </p>
        )}
        <form
          className="portal-card flex items-end gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={(e) => {
              // isComposing: Enter that confirms an IME candidate must not send.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            maxLength={MAX_LEN}
            placeholder={`Message #${channel.name}`}
            aria-label={`Message #${channel.name}`}
            className="max-h-[152px] min-h-[38px] w-full resize-none bg-transparent px-2.5 py-1.5 font-sans text-[0.95rem] leading-relaxed text-ink outline-none placeholder:text-ink-soft/60"
          />
          <div className="flex flex-none items-center gap-2.5 pb-0.5">
            {draft.length > COUNTER_AT && (
              <span className="text-[0.7rem] tabular-nums text-ink-soft">
                {MAX_LEN - draft.length} left
              </span>
            )}
            <button
              type="submit"
              className="portal-btn-primary"
              disabled={sending || draft.trim().length === 0}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4z" />
              </svg>
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
