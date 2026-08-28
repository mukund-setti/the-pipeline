/**
 * Forum island: the national board every chapter shares. One searchable post
 * list with an inline "New post" composer, plus a deep-linkable detail view
 * (?post=<id>) with replies. Authors from another campus get a school tag
 * chip next to their name. Data flows through the portal store (Supabase, or
 * the seeded demo fallback while the schema is not reachable yet).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { initPortalData, waitForPortalUser } from '../../lib/portal/data';
import type { PortalData } from '../../lib/portal/data';
import type { ForumPost, ForumReply } from '../../lib/portal/types';

type Props = {
  /** Slug of the chapter portal this island is mounted in. */
  school: string;
};

/** Campuses that have a colored tag style in portal.css. */
const TAGGED_SCHOOLS = new Set(['uci', 'ucla', 'ucr']);

/** Tiny relative timestamp: "just now", "12m", "3h", "2d", "3w". */
function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** "Career Fairs, Referrals!!" -> ["career-fairs", "referrals"], max 4. */
function parseTags(raw: string): string[] {
  const tags: string[] = [];
  for (const part of raw.split(',')) {
    const tag = part
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 4) break;
  }
  return tags;
}

/** Two-line preview clamp without the line-clamp plugin. */
const clampTwo: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/** Colored campus tag, shown only for cross-campus authors. */
function SchoolTag({ school, viewer }: { school: string; viewer: string }) {
  if (!school || school === viewer || !TAGGED_SCHOOLS.has(school)) return null;
  return (
    <span className="portal-school-tag" data-tag={school}>
      {school.toUpperCase()}
    </span>
  );
}

function BubbleIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="h-10 flex-1 rounded-field bg-line/60" />
        <div className="h-10 w-28 rounded-pill bg-line/60" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="portal-card p-5">
          <div className="h-4 w-2/3 rounded-pill bg-line/70" />
          <div className="mt-3 h-3 w-full rounded-pill bg-line/50" />
          <div className="mt-2 h-3 w-5/6 rounded-pill bg-line/50" />
          <div className="mt-4 h-3 w-44 rounded-pill bg-line/40" />
        </div>
      ))}
    </div>
  );
}

export default function ForumApp({ school }: Props) {
  const [data, setData] = useState<PortalData | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [ready, setReady] = useState(false);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ForumPost | null>(null);

  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyHint, setReplyHint] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftHint, setDraftHint] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // popstate needs the latest post list without re-binding the listener.
  const postsRef = useRef<ForumPost[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // Boot: resolve the member, init the store, load posts, honor ?post= deep links.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await waitForPortalUser();
      const portal = await initPortalData(user);
      if (cancelled) return;
      if (portal.notice === 'setup-required') {
        window.dispatchEvent(new CustomEvent('portal:notice'));
      }
      setData(portal);
      const list = await portal.store.listPosts();
      if (cancelled) return;
      setPosts(list);
      setReady(true);
      const wanted = new URLSearchParams(location.search).get('post');
      if (wanted) {
        const hit = list.find((p) => p.id === wanted);
        if (hit) setSelected(hit);
        else history.replaceState(null, '', location.pathname);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Back/forward buttons drive the view from the URL.
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(location.search).get('post');
      if (!id) {
        setSelected(null);
        return;
      }
      setSelected(postsRef.current.find((p) => p.id === id) ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Load the thread whenever a post is opened.
  const selectedId = selected ? selected.id : null;
  useEffect(() => {
    setReplyBody('');
    setReplyHint(null);
    if (!data || !selectedId) {
      setReplies([]);
      return;
    }
    let cancelled = false;
    setRepliesLoading(true);
    setReplies([]);
    data.store.listReplies(selectedId).then(
      (list) => {
        if (cancelled) return;
        setReplies(list);
        setRepliesLoading(false);
      },
      () => {
        if (!cancelled) setRepliesLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [data, selectedId]);

  const viewerSchool = data ? data.user.school : school;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [posts, query]);

  const openPost = (post: ForumPost) => {
    setSelected(post);
    setComposerOpen(false);
    history.pushState(null, '', `${location.pathname}?post=${encodeURIComponent(post.id)}`);
    window.scrollTo(0, 0);
  };

  const backToList = () => {
    setSelected(null);
    history.pushState(null, '', location.pathname);
  };

  const submitPost = async (e: FormEvent) => {
    e.preventDefault();
    if (!data || posting) return;
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) {
      setDraftHint('Give your post a title and a body before publishing.');
      return;
    }
    setPosting(true);
    try {
      const post = await data.store.createPost(title, body, parseTags(draftTags));
      setPosts((list) => [post, ...list]);
      setDraftTitle('');
      setDraftBody('');
      setDraftTags('');
      setDraftHint(null);
      openPost(post);
    } catch {
      setDraftHint('Could not publish right now. Try again in a moment.');
    } finally {
      setPosting(false);
    }
  };

  const submitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!data || !selected || replying) return;
    const body = replyBody.trim();
    if (!body) {
      setReplyHint('Write something first.');
      return;
    }
    setReplying(true);
    try {
      const reply = await data.store.addReply(selected.id, body);
      setReplies((list) => [...list, reply]);
      setPosts((list) =>
        list.map((p) => (p.id === selected.id ? { ...p, replyCount: p.replyCount + 1 } : p))
      );
      setReplyBody('');
      setReplyHint(null);
    } catch {
      setReplyHint('Could not send that reply. Try again in a moment.');
    } finally {
      setReplying(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-7 sm:px-8">
      {!ready ? (
        <ListSkeleton />
      ) : selected ? (
        /* ---------------------------- detail view --------------------------- */
        <div>
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to forum
          </button>

          <article className="portal-card mt-4 p-6">
            <h2 className="font-display text-[1.45rem] font-semibold leading-tight tracking-tight text-ink">
              {selected.title}
            </h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-ink-soft">
              <span className="font-semibold text-ink">{selected.authorName}</span>
              <SchoolTag school={selected.school} viewer={viewerSchool} />
              <span aria-hidden="true">·</span>
              <span>{relTime(selected.createdAt)}</span>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
              {selected.body}
            </p>
            {selected.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {selected.tags.map((t) => (
                  <span key={t} className="portal-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </article>

          <section className="mt-6" aria-label="Replies">
            <h3 className="font-display text-[1.05rem] font-semibold text-ink">
              Replies{replies.length > 0 ? ` (${replies.length})` : ''}
            </h3>

            {repliesLoading ? (
              <div className="portal-card mt-3 animate-pulse space-y-3 p-5" aria-hidden="true">
                <div className="h-3 w-1/3 rounded-pill bg-line/60" />
                <div className="h-3 w-5/6 rounded-pill bg-line/50" />
                <div className="h-3 w-2/3 rounded-pill bg-line/40" />
              </div>
            ) : replies.length === 0 ? (
              <div className="portal-card mt-3 p-6 text-center text-[0.88rem] text-ink-soft">
                No replies yet. Start the thread.
              </div>
            ) : (
              <div className="portal-card mt-3 divide-y divide-line">
                {replies.map((r) => (
                  <div key={r.id} className="flex gap-3 p-5">
                    <span className="portal-avatar">
                      {(r.authorName[0] || '?').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78rem] text-ink-soft">
                        <span className="font-semibold text-ink">{r.authorName}</span>
                        <SchoolTag school={r.school} viewer={viewerSchool} />
                        <span aria-hidden="true">·</span>
                        <span>{relTime(r.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink">
                        {r.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitReply} className="portal-card mt-4 p-5">
              <label
                htmlFor="forum-reply"
                className="block text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink-soft"
              >
                Add a reply
              </label>
              <textarea
                id="forum-reply"
                className="portal-input mt-2 resize-y"
                rows={4}
                placeholder="Share what you know. Someone a semester behind you needs it."
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[0.82rem] font-semibold text-gold-deep">{replyHint ?? ''}</p>
                <button
                  type="submit"
                  className="portal-btn-primary flex-none"
                  disabled={replying || !replyBody.trim()}
                >
                  Reply
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : (
        /* ----------------------------- list view ---------------------------- */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="portal-chip portal-chip--gold">All chapters</span>
            <p className="text-[0.88rem] text-ink-soft">
              One shared board. Ask anything, pass down everything.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4-4" />
              </svg>
              <input
                type="search"
                className="portal-input"
                style={{ paddingLeft: '38px' }}
                placeholder="Search posts, tags, questions"
                aria-label="Search the forum"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="portal-btn-primary flex-none"
              onClick={() => setComposerOpen(true)}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New post
            </button>
          </div>

          {composerOpen && (
            <form onSubmit={submitPost} className="portal-card p-5">
              <h2 className="font-display text-[1.1rem] font-semibold tracking-tight text-ink">
                New post
              </h2>
              <div className="mt-4 flex flex-col gap-3">
                <label className="sr-only" htmlFor="forum-new-title">
                  Title
                </label>
                <input
                  id="forum-new-title"
                  className="portal-input"
                  placeholder="Title: make it easy to find later"
                  value={draftTitle}
                  autoFocus
                  onChange={(e) => {
                    setDraftTitle(e.target.value);
                    setDraftHint(null);
                  }}
                />
                <label className="sr-only" htmlFor="forum-new-body">
                  Body
                </label>
                <textarea
                  id="forum-new-body"
                  className="portal-input resize-y"
                  rows={6}
                  placeholder="Write it out. Context helps people help you."
                  value={draftBody}
                  onChange={(e) => {
                    setDraftBody(e.target.value);
                    setDraftHint(null);
                  }}
                />
                <label className="sr-only" htmlFor="forum-new-tags">
                  Tags
                </label>
                <input
                  id="forum-new-tags"
                  className="portal-input"
                  placeholder="Tags, comma separated (up to 4): interviews, resumes"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                />
              </div>
              {draftHint && (
                <p className="mt-2.5 text-[0.82rem] font-semibold text-gold-deep">{draftHint}</p>
              )}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="portal-btn-ghost"
                  onClick={() => {
                    setComposerOpen(false);
                    setDraftHint(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="portal-btn-primary" disabled={posting}>
                  {posting ? 'Posting' : 'Post'}
                </button>
              </div>
            </form>
          )}

          {filtered.length === 0 ? (
            <div className="portal-card p-10 text-center">
              <p className="font-display text-[1.05rem] font-semibold text-ink">
                {posts.length === 0 ? 'No posts yet.' : 'Nothing matches that search.'}
              </p>
              <p className="mt-1.5 text-[0.9rem] text-ink-soft">
                {posts.length === 0
                  ? 'Be the first. Ask the question you wish someone had answered for you.'
                  : 'Try a shorter keyword, or clear the search to see every post.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openPost(p)}
                  className="portal-card block w-full p-5 text-left transition hover:border-line-strong"
                >
                  <article className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-[1.05rem] font-semibold leading-snug tracking-tight text-ink">
                        {p.title}
                      </h2>
                      <p
                        className="mt-1.5 text-[0.88rem] leading-relaxed text-ink-soft"
                        style={clampTwo}
                      >
                        {p.body}
                      </p>
                      {p.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {p.tags.map((t) => (
                            <span key={t} className="portal-chip">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78rem] text-ink-soft">
                        <span className="font-semibold text-ink">{p.authorName}</span>
                        <SchoolTag school={p.school} viewer={viewerSchool} />
                        <span aria-hidden="true">·</span>
                        <span>{relTime(p.createdAt)}</span>
                      </div>
                    </div>
                    <span className="mt-0.5 inline-flex flex-none items-center gap-1.5 rounded-pill border border-line bg-bg px-2.5 py-1 text-[0.75rem] font-semibold text-ink-soft">
                      <BubbleIcon />
                      {p.replyCount}
                    </span>
                  </article>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
