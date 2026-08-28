-- ============================================================
-- THE PIPELINE PORTAL: Supabase schema
-- Run this whole file once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to re-run: it is written to be idempotent.
--
-- Security model
--   * Every table has RLS on. The browser only ever holds the anon key
--     plus the member's JWT.
--   * A member's school is derived server-side from their auth email by
--     school_for_email(); the client never gets to pick it.
--   * Chapter channels are readable/writable ONLY by members whose
--     derived school matches. This is the real enforcement behind
--     "you can only access your own school's portal".
--   * opportunities is read-only to members; only the service-role
--     scanner endpoint writes it.
-- ============================================================

-- ------------------------------------------------------------
-- School mapping (mirror of src/lib/schools.ts, keep in sync)
-- ------------------------------------------------------------
create or replace function public.school_for_email(email text)
returns text
language sql
immutable
as $$
  select case
    -- Founder / officer overrides (non-campus emails). Mirror of
    -- FOUNDER_ACCESS in src/lib/schools.ts.
    when lower(email) = 'mukund.setti@gmail.com' then 'uci'
    when lower(email) ~ '@([a-z0-9-]+\.)*uci\.edu$'  then 'uci'
    when lower(email) ~ '@([a-z0-9-]+\.)*ucla\.edu$' then 'ucla'
    when lower(email) ~ '@([a-z0-9-]+\.)*ucr\.edu$'  then 'ucr'
    else null
  end;
$$;

-- ------------------------------------------------------------
-- Profiles: one row per auth user, school stamped from the email
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  school     text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles: update own name" on public.profiles;
create policy "profiles: update own name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    -- school/email are server-derived; members can only edit their name
    and email = (select p.email from public.profiles p where p.id = (select auth.uid()))
    and school is not distinct from public.school_for_email(email)
  );

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, school)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    public.school_for_email(coalesce(new.email, ''))
  )
  on conflict (id) do update
    set email  = excluded.email,
        school = public.school_for_email(excluded.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Re-derive the school if a user ever changes their auth email, so access
-- always tracks the CURRENT verified address (someone who leaves a campus
-- address behind loses that chapter's access).
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed up before this schema existed.
insert into public.profiles (id, email, full_name, school)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1)),
  public.school_for_email(coalesce(u.email, ''))
from auth.users u
on conflict (id) do nothing;

-- The caller's school, used by every chapter policy below.
-- SECURITY DEFINER so it can read profiles regardless of RLS; it only ever
-- returns the CALLER's own row.
create or replace function public.my_school()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select school from public.profiles where id = (select auth.uid());
$$;

-- True when the caller is an actual portal member (their email derives to a
-- live chapter). Plain `authenticated` is NOT enough anywhere below: anyone
-- can create a Supabase auth user directly against the anon key with any
-- email, so every portal policy requires membership, not just a session.
create or replace function public.is_portal_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_school() is not null;
$$;

-- Stamp author identity server-side on user-generated rows. The client sends
-- author_name/school for convenience, but they are overwritten from the
-- caller's profile here, so members cannot impersonate each other.
create or replace function public.portal_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if found then
    new.author_name := coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1));
    new.school := p.school;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Channels
-- ------------------------------------------------------------
create table if not exists public.channels (
  slug        text primary key,
  name        text not null,
  scope       text not null check (scope in ('national', 'chapter', 'topic')),
  school      text,
  description text not null default '',
  sort        int  not null default 100,
  check ((scope = 'chapter') = (school is not null))
);

alter table public.channels enable row level security;

drop policy if exists "channels: members read" on public.channels;
create policy "channels: members read"
  on public.channels for select
  to authenticated
  using (public.is_portal_member());

insert into public.channels (slug, name, scope, school, description, sort) values
  ('national',       'national',       'national', null,   'Every chapter, one room.',                         10),
  ('chapter-uci',    'uci-chapter',    'chapter',  'uci',  'UC Irvine chapter room.',                          20),
  ('chapter-ucla',   'ucla-chapter',   'chapter',  'ucla', 'UCLA chapter room.',                               21),
  ('chapter-ucr',    'ucr-chapter',    'chapter',  'ucr',  'UC Riverside chapter room.',                       22),
  ('interview-prep', 'interview-prep', 'topic',    null,   'Mock interviews, DSA grind, behavioral prep.',     30),
  ('job-postings',   'job-postings',   'topic',    null,   'Member-shared roles and referrals.',               31),
  ('resume-review',  'resume-review',  'topic',    null,   'Line-by-line resume edits from fellows.',          32),
  ('wins',           'wins',           'topic',    null,   'Offers, interviews, breakthroughs.',               33)
on conflict (slug) do update
  set name = excluded.name,
      scope = excluded.scope,
      school = excluded.school,
      description = excluded.description,
      sort = excluded.sort;

-- True when the caller may see/post in the channel.
create or replace function public.can_access_channel(channel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.slug = channel
      and (c.scope <> 'chapter' or c.school = public.my_school())
  );
$$;

-- ------------------------------------------------------------
-- Chat messages
-- ------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  channel_slug text not null references public.channels (slug) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  author_name  text not null check (char_length(author_name) between 1 and 80),
  school       text,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);

create index if not exists messages_channel_created_idx
  on public.messages (channel_slug, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages: read accessible channels" on public.messages;
create policy "messages: read accessible channels"
  on public.messages for select
  to authenticated
  using (public.is_portal_member() and public.can_access_channel(channel_slug));

drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self"
  on public.messages for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_portal_member()
    and public.can_access_channel(channel_slug)
    and school is not distinct from public.my_school()
  );

drop policy if exists "messages: delete own" on public.messages;
create policy "messages: delete own"
  on public.messages for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Live chat: stream INSERTs to subscribed clients (RLS still applies).
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;

-- Server-side identity stamp (see portal_stamp_author above).
drop trigger if exists messages_stamp_author on public.messages;
create trigger messages_stamp_author
  before insert on public.messages
  for each row execute function public.portal_stamp_author();

-- ------------------------------------------------------------
-- Forum
-- ------------------------------------------------------------
create table if not exists public.forum_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  school      text,
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 20000),
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.forum_replies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.forum_posts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  school      text,
  body        text not null check (char_length(body) between 1 and 10000),
  created_at  timestamptz not null default now()
);

create index if not exists forum_replies_post_idx on public.forum_replies (post_id, created_at);

alter table public.forum_posts   enable row level security;
alter table public.forum_replies enable row level security;

drop trigger if exists forum_posts_stamp_author on public.forum_posts;
create trigger forum_posts_stamp_author
  before insert on public.forum_posts
  for each row execute function public.portal_stamp_author();

drop trigger if exists forum_replies_stamp_author on public.forum_replies;
create trigger forum_replies_stamp_author
  before insert on public.forum_replies
  for each row execute function public.portal_stamp_author();

-- The forum is national: any member reads, writes as themself.
drop policy if exists "posts: members read" on public.forum_posts;
create policy "posts: members read"
  on public.forum_posts for select to authenticated
  using (public.is_portal_member());

drop policy if exists "posts: create as self" on public.forum_posts;
create policy "posts: create as self"
  on public.forum_posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_portal_member()
    and school is not distinct from public.my_school()
  );

drop policy if exists "posts: delete own" on public.forum_posts;
create policy "posts: delete own"
  on public.forum_posts for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "replies: members read" on public.forum_replies;
create policy "replies: members read"
  on public.forum_replies for select to authenticated
  using (public.is_portal_member());

drop policy if exists "replies: create as self" on public.forum_replies;
create policy "replies: create as self"
  on public.forum_replies for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_portal_member()
    and school is not distinct from public.my_school()
  );

drop policy if exists "replies: delete own" on public.forum_replies;
create policy "replies: delete own"
  on public.forum_replies for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Opportunities (written only by the scanner via service role)
-- ------------------------------------------------------------
create table if not exists public.opportunities (
  id        uuid primary key default gen_random_uuid(),
  title     text not null,
  company   text not null,
  url       text not null unique,
  kind      text not null check (kind in ('internship', 'new-grad', 'program')),
  source    text not null default '',
  tags      text[] not null default '{}',
  location  text,
  deadline  date,
  posted_at timestamptz not null default now()
);

create index if not exists opportunities_posted_idx on public.opportunities (posted_at desc);

alter table public.opportunities enable row level security;

drop policy if exists "opportunities: members read" on public.opportunities;
create policy "opportunities: members read"
  on public.opportunities for select to authenticated
  using (public.is_portal_member());
-- No insert/update/delete policies: only the service role key (used by
-- /api/opportunities-scan) can write, because service role bypasses RLS.

-- ------------------------------------------------------------
-- Resumes (private storage; each member sees only their own)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 5242880,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live at <user_id>/resume.<ext>; the first path segment must be the
-- caller's own id, so nobody can read or write anyone else's resume.
drop policy if exists "resumes: read own" on storage.objects;
create policy "resumes: read own"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "resumes: upload own" on storage.objects;
create policy "resumes: upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and public.is_portal_member()
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "resumes: replace own" on storage.objects;
create policy "resumes: replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "resumes: delete own" on storage.objects;
create policy "resumes: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Display metadata (original filename) lives on the profile.
alter table public.profiles add column if not exists resume_name text;
alter table public.profiles add column if not exists resume_updated_at timestamptz;

-- ------------------------------------------------------------
-- Job actions: per-member saved (flagged) and applied marks
-- ------------------------------------------------------------
create table if not exists public.job_actions (
  user_id        uuid not null references auth.users (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  action         text not null check (action in ('saved', 'applied')),
  created_at     timestamptz not null default now(),
  primary key (user_id, opportunity_id, action)
);

alter table public.job_actions enable row level security;

drop policy if exists "job_actions: read own" on public.job_actions;
create policy "job_actions: read own"
  on public.job_actions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "job_actions: create own" on public.job_actions;
create policy "job_actions: create own"
  on public.job_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_portal_member());

drop policy if exists "job_actions: delete own" on public.job_actions;
create policy "job_actions: delete own"
  on public.job_actions for delete to authenticated
  using (user_id = (select auth.uid()));
