/**
 * Portal data layer. One interface, two backends:
 *
 *  - SupabaseStore: the real thing. RLS in supabase/schema.sql is the actual
 *    enforcement (chapter channels are readable/writable only by that
 *    school's members); this file is just the client.
 *  - DemoStore: seeded, localStorage-backed. Used for the dev-only demo
 *    session (?demo=<school>) and as a graceful fallback when the Supabase
 *    tables have not been created yet, so the portal is always navigable.
 *
 * Islands call initPortalData(user) once and render from the returned store.
 */
import { getSupabase } from '../supabase';
import { schoolForEmail, schoolBySlug, PORTAL_SCHOOLS } from '../schools';
import type { PortalSchoolSlug } from '../schools';
import type {
  Channel,
  ChatMessage,
  ForumPost,
  ForumReply,
  JobAction,
  JobActionMap,
  Opportunity,
  PortalUser,
  ResumeInfo,
} from './types';
import { channelsForSchool } from './types';

const DEMO_SESSION_KEY = 'pipeline-portal-demo';
const DEMO_DATA_KEY = 'pipeline-portal-demo-data-v2';

export interface PortalStore {
  /** True when backed by Supabase; false = demo/sample data. */
  live: boolean;
  listMessages(channel: string, limit?: number): Promise<ChatMessage[]>;
  sendMessage(channel: string, body: string): Promise<ChatMessage>;
  /** Subscribe to new messages in a channel. Returns an unsubscribe fn. */
  onMessage(channel: string, cb: (m: ChatMessage) => void): () => void;
  listPosts(): Promise<ForumPost[]>;
  listReplies(postId: string): Promise<ForumReply[]>;
  createPost(title: string, body: string, tags: string[]): Promise<ForumPost>;
  addReply(postId: string, body: string): Promise<ForumReply>;
  listOpportunities(): Promise<Opportunity[]>;
  /** The member's stored resume, or null when none is on file. */
  getResume(): Promise<ResumeInfo | null>;
  uploadResume(file: File): Promise<ResumeInfo>;
  removeResume(): Promise<void>;
  /** Saved/applied marks keyed by opportunity id. */
  listActions(): Promise<JobActionMap>;
  setAction(opportunityId: string, action: JobAction, on: boolean): Promise<void>;
}

export type PortalData = {
  store: PortalStore;
  user: PortalUser;
  channels: Channel[];
  /**
   * Set when the user is signed in for real but the portal tables are not
   * reachable yet; the UI shows sample data plus a setup notice.
   */
  notice: 'setup-required' | null;
};

/* ------------------------------ auth guard ----------------------------- */

function demoSession(): PortalUser | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!schoolBySlug(parsed.school)) return null;
    return {
      id: 'demo-user',
      email: parsed.email,
      name: parsed.name,
      school: parsed.school,
      demo: true,
    };
  } catch {
    return null;
  }
}

/** Dev-only: `?demo=uci|ucla|ucr` starts a fake session for that chapter. */
function activateDemoFromQuery(): void {
  if (!import.meta.env.DEV) return;
  const q = new URLSearchParams(location.search);
  const slug = q.get('demo');
  const school = slug ? schoolBySlug(slug) : null;
  if (!school) return;
  try {
    sessionStorage.setItem(
      DEMO_SESSION_KEY,
      JSON.stringify({
        school: school.slug,
        name: 'Demo Fellow',
        email: 'demo@' + school.domains[0],
      })
    );
  } catch {
    return; // blocked storage: fall through to the normal auth path
  }
  q.delete('demo');
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
}

/**
 * Resolve the signed-in portal user, enforcing that they belong to
 * `expected`. On any miss this redirects (returns null): signed out -> the
 * portal sign-in page; wrong school -> their own portal.
 */
export async function guardPortal(expected: string): Promise<PortalUser | null> {
  activateDemoFromQuery();
  const demo = demoSession();
  if (demo) {
    if (demo.school !== expected) {
      location.replace(`/portal/${demo.school}/`);
      return null;
    }
    return publish(demo);
  }

  const supa = getSupabase();
  if (!supa) {
    location.replace('/portal/');
    return null;
  }
  const { data } = await supa.auth.getSession();
  const email = data.session?.user?.email;
  if (!email) {
    location.replace('/portal/');
    return null;
  }
  const school = schoolForEmail(email);
  if (!school) {
    // Signed in but no portal chapter; the portal index explains.
    location.replace('/portal/');
    return null;
  }
  if (school.slug !== expected) {
    location.replace(`/portal/${school.slug}/`);
    return null;
  }
  const user: PortalUser = {
    id: data.session!.user.id,
    email,
    name:
      (data.session!.user.user_metadata?.full_name as string) ||
      email.split('@')[0],
    school: school.slug,
    demo: false,
  };
  return publish(user);
}

function publish(user: PortalUser): PortalUser {
  (window as any).__portalUser = user;
  window.dispatchEvent(new CustomEvent('portal:user'));
  return user;
}

/** Islands wait here; the PortalShell guard script calls guardPortal first. */
export function waitForPortalUser(): Promise<PortalUser> {
  return new Promise((resolve) => {
    const existing = (window as any).__portalUser as PortalUser | undefined;
    if (existing) return resolve(existing);
    window.addEventListener(
      'portal:user',
      () => resolve((window as any).__portalUser as PortalUser),
      { once: true }
    );
  });
}

export async function portalSignOut(): Promise<void> {
  try {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
    const supa = getSupabase();
    if (supa) await supa.auth.signOut();
  } finally {
    location.href = '/portal/';
  }
}

/* ----------------------------- store factory --------------------------- */

export async function initPortalData(user: PortalUser): Promise<PortalData> {
  const channels = channelsForSchool(user.school);
  if (user.demo) {
    return { store: new DemoStore(user), user, channels, notice: null };
  }
  const supa = getSupabase();
  if (!supa) {
    return { store: new DemoStore(user), user, channels, notice: 'setup-required' };
  }
  // Probe once: if the schema has not been applied, fall back to sample data.
  const { error } = await supa.from('channels').select('slug').limit(1);
  if (error) {
    return { store: new DemoStore(user), user, channels, notice: 'setup-required' };
  }
  return { store: new SupabaseStore(user, supa), user, channels, notice: null };
}

/* ----------------------------- supabase store -------------------------- */

type Supa = NonNullable<ReturnType<typeof getSupabase>>;

const msgFromRow = (r: any): ChatMessage => ({
  id: r.id,
  channel: r.channel_slug,
  userId: r.user_id,
  authorName: r.author_name,
  school: r.school ?? '',
  body: r.body,
  createdAt: r.created_at,
});

const postFromRow = (r: any): ForumPost => ({
  id: r.id,
  userId: r.user_id,
  authorName: r.author_name,
  school: r.school ?? '',
  title: r.title,
  body: r.body,
  tags: r.tags ?? [],
  createdAt: r.created_at,
  replyCount: Array.isArray(r.forum_replies) ? r.forum_replies[0]?.count ?? 0 : 0,
});

const replyFromRow = (r: any): ForumReply => ({
  id: r.id,
  postId: r.post_id,
  userId: r.user_id,
  authorName: r.author_name,
  school: r.school ?? '',
  body: r.body,
  createdAt: r.created_at,
});

const oppFromRow = (r: any): Opportunity => ({
  id: r.id,
  title: r.title,
  company: r.company,
  url: r.url,
  kind: r.kind,
  source: r.source,
  tags: r.tags ?? [],
  location: r.location,
  deadline: r.deadline,
  postedAt: r.posted_at,
});

class SupabaseStore implements PortalStore {
  live = true;
  constructor(private user: PortalUser, private supa: Supa) {}

  async listMessages(channel: string, limit = 80): Promise<ChatMessage[]> {
    const { data, error } = await this.supa
      .from('messages')
      .select('*')
      .eq('channel_slug', channel)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(msgFromRow).reverse();
  }

  async sendMessage(channel: string, body: string): Promise<ChatMessage> {
    const { data, error } = await this.supa
      .from('messages')
      .insert({
        channel_slug: channel,
        user_id: this.user.id,
        author_name: this.user.name,
        school: this.user.school,
        body,
      })
      .select()
      .single();
    if (error) throw error;
    return msgFromRow(data);
  }

  onMessage(channel: string, cb: (m: ChatMessage) => void): () => void {
    const ch = this.supa
      .channel(`portal-msg-${channel}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_slug=eq.${channel}`,
        },
        (payload: any) => cb(msgFromRow(payload.new))
      )
      .subscribe();
    return () => {
      this.supa.removeChannel(ch);
    };
  }

  async listPosts(): Promise<ForumPost[]> {
    const { data, error } = await this.supa
      .from('forum_posts')
      .select('*, forum_replies(count)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []).map(postFromRow);
  }

  async listReplies(postId: string): Promise<ForumReply[]> {
    const { data, error } = await this.supa
      .from('forum_replies')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(replyFromRow);
  }

  async createPost(title: string, body: string, tags: string[]): Promise<ForumPost> {
    const { data, error } = await this.supa
      .from('forum_posts')
      .insert({
        user_id: this.user.id,
        author_name: this.user.name,
        school: this.user.school,
        title,
        body,
        tags,
      })
      .select()
      .single();
    if (error) throw error;
    return { ...postFromRow(data), replyCount: 0 };
  }

  async addReply(postId: string, body: string): Promise<ForumReply> {
    const { data, error } = await this.supa
      .from('forum_replies')
      .insert({
        post_id: postId,
        user_id: this.user.id,
        author_name: this.user.name,
        school: this.user.school,
        body,
      })
      .select()
      .single();
    if (error) throw error;
    return replyFromRow(data);
  }

  async listOpportunities(): Promise<Opportunity[]> {
    const { data, error } = await this.supa
      .from('opportunities')
      .select('*')
      .order('posted_at', { ascending: false })
      .limit(120);
    if (error) throw error;
    const rows = (data ?? []).map(oppFromRow);
    // An empty live table reads as "broken" to a new member; show samples
    // until the scanner has run once, but labeled and back-dated so nothing
    // fabricated wears a "New" chip or a real source name.
    return rows.length
      ? rows
      : seedOpportunities().map((o) => ({
          ...o,
          source: 'Sample data',
          postedAt: new Date(Date.parse(o.postedAt) - 10 * 86_400_000).toISOString(),
        }));
  }

  // Resume state lives ENTIRELY in storage: the file's own name and
  // timestamp are the metadata. No profiles round-trip, so the feature has
  // no dependency on profiles policies.

  async getResume(): Promise<ResumeInfo | null> {
    const { data: files, error } = await this.supa.storage
      .from('resumes')
      .list(this.user.id, { sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    const file = files?.[0];
    if (!file) return null;
    const { data: signed } = await this.supa.storage
      .from('resumes')
      .createSignedUrl(`${this.user.id}/${file.name}`, 600);
    return {
      name: file.name,
      updatedAt: (file as any).updated_at || (file as any).created_at || '',
      url: signed?.signedUrl ?? null,
    };
  }

  async uploadResume(file: File): Promise<ResumeInfo> {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) throw new Error('Use a PDF or Word file.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Keep it under 5 MB.');
    // The object key carries the display name; sanitize it for storage.
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    // One resume per member: clear the folder first so a replacement with a
    // different filename does not leave the old file behind.
    const { data: existing } = await this.supa.storage.from('resumes').list(this.user.id);
    if (existing?.length) {
      await this.supa.storage
        .from('resumes')
        .remove(existing.map((f) => `${this.user.id}/${f.name}`));
    }
    const path = `${this.user.id}/${safeName}`;
    const { error } = await this.supa.storage
      .from('resumes')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) throw error;
    const { data: signed } = await this.supa.storage.from('resumes').createSignedUrl(path, 600);
    return { name: safeName, updatedAt: new Date().toISOString(), url: signed?.signedUrl ?? null };
  }

  async removeResume(): Promise<void> {
    const { data: existing, error } = await this.supa.storage.from('resumes').list(this.user.id);
    if (error) throw error;
    if (existing?.length) {
      const { error: rmErr } = await this.supa.storage
        .from('resumes')
        .remove(existing.map((f) => `${this.user.id}/${f.name}`));
      if (rmErr) throw rmErr;
    }
  }

  async listActions(): Promise<JobActionMap> {
    const { data, error } = await this.supa.from('job_actions').select('opportunity_id, action');
    if (error) throw error;
    const map: JobActionMap = {};
    for (const row of data ?? []) {
      (map[row.opportunity_id] ??= {})[row.action as JobAction] = true;
    }
    return map;
  }

  async setAction(opportunityId: string, action: JobAction, on: boolean): Promise<void> {
    // Sample rows are not database rows; the UI hides actions on them, this
    // is just the backstop.
    if (opportunityId.startsWith('seed-')) throw new Error('Sample rows cannot be saved.');
    if (on) {
      const { error } = await this.supa.from('job_actions').upsert(
        { user_id: this.user.id, opportunity_id: opportunityId, action },
        { ignoreDuplicates: true }
      );
      if (error) throw error;
    } else {
      const { error } = await this.supa
        .from('job_actions')
        .delete()
        .match({ user_id: this.user.id, opportunity_id: opportunityId, action });
      if (error) throw error;
    }
  }
}

/* ------------------------------ demo store ----------------------------- */

type DemoData = {
  messages: ChatMessage[];
  posts: ForumPost[];
  replies: ForumReply[];
  /** Demo resume keeps metadata only; no file is stored. */
  resume?: { name: string; updatedAt: string } | null;
  actions?: JobActionMap;
};

function uid(): string {
  return 'demo-' + Math.random().toString(36).slice(2, 10);
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

class DemoStore implements PortalStore {
  live = false;
  private data: DemoData;

  constructor(private user: PortalUser) {
    this.data = this.load();
  }

  private load(): DemoData {
    try {
      const raw = localStorage.getItem(DEMO_DATA_KEY + '-' + this.user.school);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Shape-check before trusting: a corrupt or drifted blob would
        // otherwise brick every island with no way to recover.
        if (
          parsed &&
          Array.isArray(parsed.messages) &&
          Array.isArray(parsed.posts) &&
          Array.isArray(parsed.replies)
        ) {
          return parsed;
        }
      }
    } catch {
      /* reseed below */
    }
    const seeded = seedDemoData(this.user.school);
    this.save(seeded);
    return seeded;
  }

  private save(d: DemoData): void {
    try {
      localStorage.setItem(DEMO_DATA_KEY + '-' + this.user.school, JSON.stringify(d));
    } catch {
      /* storage full/blocked: keep in memory */
    }
  }

  async listMessages(channel: string, limit = 80): Promise<ChatMessage[]> {
    return this.data.messages.filter((m) => m.channel === channel).slice(-limit);
  }

  async sendMessage(channel: string, body: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: uid(),
      channel,
      userId: this.user.id,
      authorName: this.user.name,
      school: this.user.school,
      body,
      createdAt: new Date().toISOString(),
    };
    this.data.messages.push(msg);
    this.save(this.data);
    window.dispatchEvent(new CustomEvent('portal-demo-message', { detail: msg }));
    return msg;
  }

  onMessage(channel: string, cb: (m: ChatMessage) => void): () => void {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<ChatMessage>).detail;
      if (msg.channel === channel && msg.userId !== this.user.id) cb(msg);
    };
    window.addEventListener('portal-demo-message', handler);
    return () => window.removeEventListener('portal-demo-message', handler);
  }

  async listPosts(): Promise<ForumPost[]> {
    // Copies, not references: the store mutates its own post objects (reply
    // counts), and aliasing them into React state would double-count.
    return [...this.data.posts]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ ...p }));
  }

  async listReplies(postId: string): Promise<ForumReply[]> {
    return this.data.replies
      .filter((r) => r.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createPost(title: string, body: string, tags: string[]): Promise<ForumPost> {
    const post: ForumPost = {
      id: uid(),
      userId: this.user.id,
      authorName: this.user.name,
      school: this.user.school,
      title,
      body,
      tags,
      createdAt: new Date().toISOString(),
      replyCount: 0,
    };
    this.data.posts.push(post);
    this.save(this.data);
    return post;
  }

  async addReply(postId: string, body: string): Promise<ForumReply> {
    const reply: ForumReply = {
      id: uid(),
      postId,
      userId: this.user.id,
      authorName: this.user.name,
      school: this.user.school,
      body,
      createdAt: new Date().toISOString(),
    };
    this.data.replies.push(reply);
    const post = this.data.posts.find((p) => p.id === postId);
    if (post) post.replyCount += 1;
    this.save(this.data);
    return reply;
  }

  async listOpportunities(): Promise<Opportunity[]> {
    return seedOpportunities();
  }

  async getResume(): Promise<ResumeInfo | null> {
    const r = this.data.resume;
    return r ? { ...r, url: null } : null;
  }

  async uploadResume(file: File): Promise<ResumeInfo> {
    const info = { name: file.name, updatedAt: new Date().toISOString() };
    this.data.resume = info;
    this.save(this.data);
    return { ...info, url: null };
  }

  async removeResume(): Promise<void> {
    this.data.resume = null;
    this.save(this.data);
  }

  async listActions(): Promise<JobActionMap> {
    return { ...(this.data.actions ?? {}) };
  }

  async setAction(opportunityId: string, action: JobAction, on: boolean): Promise<void> {
    const actions = (this.data.actions ??= {});
    const entry = (actions[opportunityId] ??= {});
    if (on) entry[action] = true;
    else delete entry[action];
    if (!entry.saved && !entry.applied) delete actions[opportunityId];
    this.save(this.data);
  }
}

/* ------------------------------- seed data ----------------------------- */

function seedDemoData(school: PortalSchoolSlug): DemoData {
  const other = PORTAL_SCHOOLS.filter((s) => s.slug !== school);
  const mine = schoolBySlug(school)!;
  const messages: ChatMessage[] = [];
  const say = (
    channel: string,
    authorName: string,
    authorSchool: string,
    body: string,
    mins: number
  ) =>
    messages.push({
      id: uid(),
      channel,
      userId: 'seed-' + authorName.replace(/\s/g, ''),
      authorName,
      school: authorSchool,
      body,
      createdAt: minsAgo(mins),
    });

  say('national', 'Priya N.', other[0].slug, 'Morning pipeline 🌱 who else is grinding apps this week?', 470);
  say('national', 'Marcus J.', other[1].slug, 'Me. 14 apps out since Monday. The tracker in #job-postings is carrying', 465);
  say('national', 'Sofia R.', school, 'Reminder that office hours are Thursday 6pm. Bring your questions, fellows from all three campuses will be on', 220);
  say('national', 'Devon K.', other[0].slug, 'Just passed my Capital One phone screen!! writeup coming to the forum tonight', 90);
  say('national', 'Priya N.', other[0].slug, 'LETS GO 🔥 drop it in #wins too', 84);

  say(`chapter-${school}`, 'Sofia R.', school, `Welcome new ${mine.mascot}! Intro yourself when you land 👋`, 300);
  say(`chapter-${school}`, 'Alex T.', school, 'Study room booked for Saturday 1-4pm, science library. Mock interview round-robin, bring a friend', 240);
  say(`chapter-${school}`, 'Jordan M.', school, 'Anyone else taking the algorithms midterm this week? Making a shared prep doc', 130);
  say(`chapter-${school}`, 'Sofia R.', school, 'Pinned: chapter interest form for fall mentor matching closes Friday', 45);

  say('interview-prep', 'Marcus J.', other[1].slug, 'Daily LC thread: today is graphs. Number of Islands, then Course Schedule if you have time', 400);
  say('interview-prep', 'Devon K.', other[0].slug, 'Tip from my screen today: talk through brute force FIRST. Interviewer literally thanked me for narrating', 88);
  say('interview-prep', 'Alex T.', school, 'Can someone run a behavioral mock with me tomorrow? 30 min, I have the Amazon LP list', 60);

  say('job-postings', 'Sofia R.', school, 'DROP: Capital One TIP applications are open. Referral available, DM me your resume first', 350);
  say('job-postings', 'Priya N.', other[0].slug, 'Break Through Tech AI is taking apps for the spring cohort. First-gen friendly, no experience needed', 200);
  say('job-postings', 'Marcus J.', other[1].slug, 'The opportunities tab just picked up ~30 new internship rows from the overnight scan, filter by New', 55);

  say('resume-review', 'Devon K.', other[0].slug, 'Dropped v3 of my resume in the drive folder. Tore out the objective section like you all said 🙏', 320);
  say('resume-review', 'Sofia R.', school, 'Rule of thumb: every bullet = what you did + how + the number. Post yours and we will rewrite one together', 150);

  say('wins', 'Jordan M.', school, 'Passed my first ever technical screen today. Six months ago I could not write a for loop. This community man 🥹', 100);
  say('wins', 'Devon K.', other[0].slug, 'CAPITAL ONE PHONE SCREEN ✅✅', 82);
  say('wins', 'Priya N.', other[0].slug, 'Little win: recruiter replied to my cold email. It works, send them', 30);

  const posts: ForumPost[] = [];
  const replies: ForumReply[] = [];
  const post = (
    authorName: string,
    authorSchool: string,
    title: string,
    body: string,
    tags: string[],
    mins: number
  ): ForumPost => {
    const p: ForumPost = {
      id: uid(),
      userId: 'seed-' + authorName.replace(/\s/g, ''),
      authorName,
      school: authorSchool,
      title,
      body,
      tags,
      createdAt: minsAgo(mins),
      replyCount: 0,
    };
    posts.push(p);
    return p;
  };
  const reply = (
    p: ForumPost,
    authorName: string,
    authorSchool: string,
    body: string,
    mins: number
  ) => {
    replies.push({
      id: uid(),
      postId: p.id,
      userId: 'seed-' + authorName.replace(/\s/g, ''),
      authorName,
      school: authorSchool,
      body,
      createdAt: minsAgo(mins),
    });
    p.replyCount += 1;
  };

  const p1 = post(
    'Devon K.',
    other[0].slug,
    'How I got past the Capital One phone screen (full writeup)',
    'Everything I was asked, how I prepped, and what I would do differently. TLDR: two weeks of focused arrays/strings practice beats three months of random grinding. Full question list inside.',
    ['interviews', 'capital-one'],
    2600
  );
  reply(p1, 'Priya N.', other[0].slug, 'This is gold. Bookmarking for my screen next week.', 2400);
  reply(p1, 'Alex T.', school, 'The narrate-your-brute-force tip already paid off for me today. Thank you!!', 2200);

  const p2 = post(
    'Sofia R.',
    school,
    'Resume bullets: post one, we rewrite it together',
    'Ongoing thread. Drop your weakest bullet and the community rewrites it with you. No judgment, that is the point.',
    ['resumes'],
    4000
  );
  reply(p2, 'Jordan M.', school, '"Worked on the club website"... I know it is bad, help', 3800);
  reply(
    p2,
    'Sofia R.',
    school,
    'Try: "Rebuilt club site in Astro, cutting load time 40% and doubling weekly signups (120 to 250)." Tool, number, outcome.',
    3700
  );

  const p3 = post(
    'Marcus J.',
    other[1].slug,
    'First-gen and lost about return offers. What are my actual options?',
    'My internship ends in three weeks and nobody in my family has been through this. When do return offers usually land? Is it rude to ask my manager directly? What if I want to re-recruit anyway?',
    ['advice', 'first-gen'],
    5200
  );
  reply(
    p3,
    'Sofia R.',
    school,
    'Not rude at all. Ask your manager in your next 1:1, framed as "what does the timeline look like". Companies expect it.',
    5100
  );

  post(
    'Alex T.',
    school,
    `${mine.short} study group for fall recruiting: who is in?`,
    'Thinking Tuesdays in the library, alternating between LC sets and application sprints. Reply with your availability.',
    ['chapter', 'study-group'],
    900
  );

  return { messages, posts, replies };
}

export function seedOpportunities(): Opportunity[] {
  const day = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
  const mk = (
    title: string,
    company: string,
    url: string,
    kind: Opportunity['kind'],
    source: string,
    tags: string[],
    location: string | null,
    daysAgo: number
  ): Opportunity => ({
    id: 'seed-' + company.toLowerCase().replace(/\W+/g, '-') + '-' + kind,
    title,
    company,
    url,
    kind,
    source,
    tags,
    location,
    deadline: null,
    postedAt: ago(daysAgo),
  });

  return [
    mk('Software Engineer Intern, Summer 2027', 'Amazon', 'https://www.amazon.jobs/en/teams/internships-for-students', 'internship', 'Simplify · GitHub', ['swe', 'big-tech'], 'Seattle, WA', 0),
    mk('Technology Internship Program (TIP)', 'Capital One', 'https://www.capitalonecareers.com/students-and-grads', 'internship', 'Simplify · GitHub', ['swe', 'fintech', 'referral-available'], 'McLean, VA', 1),
    mk('STEP Intern, First & Second Year Students', 'Google', 'https://buildyourfuture.withgoogle.com/programs/step', 'internship', 'Simplify · GitHub', ['swe', 'underclassmen'], 'Mountain View, CA', 1),
    mk('Explore Program (First/Second Year)', 'Microsoft', 'https://careers.microsoft.com/v2/global/en/exploremicrosoft', 'internship', 'Simplify · GitHub', ['swe', 'underclassmen'], 'Redmond, WA', 2),
    mk('AI Program, Spring Cohort', 'Break Through Tech', 'https://www.breakthroughtech.org/programs/the-ai-program/', 'program', 'Community drop', ['ai-ml', 'first-gen-friendly', 'no-experience-ok'], 'Remote', 2),
    mk('Career Prep Fellowship', 'MLT', 'https://mlt.org/career-prep/', 'program', 'Community drop', ['fellowship', 'underrepresented'], 'Remote', 3),
    mk('Software Engineer Intern, Summer 2027', 'Bloomberg', 'https://www.bloomberg.com/careers/early-career/', 'internship', 'Simplify · GitHub', ['swe', 'nyc'], 'New York, NY', 4),
    mk('Software Engineering Intern', 'NVIDIA', 'https://www.nvidia.com/en-us/about-nvidia/careers/university-recruiting/', 'internship', 'Simplify · GitHub', ['swe', 'hardware', 'ai-ml'], 'Santa Clara, CA', 5),
    mk('Software Engineer, New Grad 2027', 'Uber', 'https://www.uber.com/us/en/careers/teams/university/', 'new-grad', 'Simplify · GitHub', ['swe', 'new-grad'], 'San Francisco, CA', 6),
    mk('Tech Fellowship, Intro Track', 'CodePath', 'https://www.codepath.org/courses', 'program', 'Community drop', ['courses', 'free', 'no-experience-ok'], 'Remote', 7),
    mk('Software Engineer, New Grad', 'Datadog', 'https://careers.datadoghq.com/early-career/', 'new-grad', 'Hacker News · Who is hiring', ['swe', 'new-grad', 'nyc'], 'New York, NY', 8),
    mk('Firmware Intern, Summer 2027', 'SpaceX', 'https://www.spacex.com/careers/', 'internship', 'Hacker News · Who is hiring', ['embedded', 'hardware'], 'Hawthorne, CA', 9),
  ];
}
