-- ============================================================
-- Usage guardrails. Run once in the Supabase SQL editor, after
-- schema.sql. Safe to re-run.
--
-- 1. Daily per-member quotas for the server endpoints that cost money
--    or server time (/api/opportunities-search calls Claude,
--    /api/parse-job fetches other sites), plus a site-wide daily
--    ceiling on AI searches so many accounts together cannot run up
--    the bill.
-- 2. Rate limits on chat messages, forum posts and replies, and a cap
--    on tracked applications, enforced in the database so a script
--    talking to Supabase directly hits them too.
-- 3. A content filter on chat messages, forum posts and replies, and
--    display names: slurs, sexual content, threats, profanity, SSNs and
--    card numbers, and link spam. Mirrors src/lib/portal/moderation.ts,
--    which gives members the same answer instantly in the browser.
--
-- Errors meant for the member are raised with hint 'portal'; the site
-- shows those messages as is instead of a generic "did not send".
-- ============================================================

-- ------------------------------------------------------------
-- Endpoint quotas
-- ------------------------------------------------------------
create table if not exists public.api_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null,
  day      date not null,
  count    int  not null default 0,
  last_at  timestamptz not null default now(),
  primary key (user_id, kind, day)
);
create index if not exists api_usage_kind_day_idx on public.api_usage (kind, day);

-- RLS on with no policies: members cannot read or write this table
-- directly. The only way in is consume_api_quota below.
alter table public.api_usage enable row level security;

-- Counts one use of an endpoint for the calling member and says whether
-- it is within today's limits (UTC day). Limits live here, not in a
-- parameter, so a caller cannot raise their own.
create or replace function public.consume_api_quota(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  today      date := (now() at time zone 'utc')::date;
  per_member int;
  site_wide  int;
  used       int;
  total      int;
begin
  if uid is null or not public.is_portal_member() then
    return false;
  end if;

  per_member := case p_kind
    when 'ai_search' then 25   -- Claude calls, about $0.01 each
    when 'parse_job' then 60   -- job links read
    else 0
  end;
  site_wide := case p_kind
    when 'ai_search' then 1500 -- about $15/day ceiling across everyone
    else null
  end;
  if per_member = 0 then
    return false;
  end if;

  if site_wide is not null then
    select coalesce(sum(u.count), 0) into total
      from public.api_usage u
     where u.kind = p_kind and u.day = today;
    if total >= site_wide then
      return false;
    end if;
  end if;

  insert into public.api_usage as u (user_id, kind, day, count)
  values (uid, p_kind, today, 1)
  on conflict (user_id, kind, day)
    do update set count = u.count + 1, last_at = now()
  returning u.count into used;

  return used <= per_member;
end;
$$;

revoke all on function public.consume_api_quota(text) from public, anon;
grant execute on function public.consume_api_quota(text) to authenticated;

-- ------------------------------------------------------------
-- Posting rate limits
-- ------------------------------------------------------------
create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);
create index if not exists forum_posts_user_created_idx
  on public.forum_posts (user_id, created_at desc);
create index if not exists forum_replies_user_created_idx
  on public.forum_replies (user_id, created_at desc);

create or replace function public.portal_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if tg_table_name = 'messages' then
    select count(*) into n from public.messages
     where user_id = new.user_id and created_at > now() - interval '1 minute';
    if n >= 20 then
      raise exception 'Slow down: that is a lot of messages in a minute. Try again shortly.'
        using hint = 'portal';
    end if;
  elsif tg_table_name = 'forum_posts' then
    select count(*) into n from public.forum_posts
     where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 10 then
      raise exception 'You have posted 10 threads in the last hour. Try again later.'
        using hint = 'portal';
    end if;
  elsif tg_table_name = 'forum_replies' then
    select count(*) into n from public.forum_replies
     where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 40 then
      raise exception 'You have replied 40 times in the last hour. Try again later.'
        using hint = 'portal';
    end if;
  elsif tg_table_name = 'applications' then
    select count(*) into n from public.applications where user_id = new.user_id;
    if n >= 1000 then
      raise exception 'You are tracking 1000 applications, the limit. Delete some old ones first.'
        using hint = 'portal';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.portal_rate_limit();

drop trigger if exists forum_posts_rate_limit on public.forum_posts;
create trigger forum_posts_rate_limit
  before insert on public.forum_posts
  for each row execute function public.portal_rate_limit();

drop trigger if exists forum_replies_rate_limit on public.forum_replies;
create trigger forum_replies_rate_limit
  before insert on public.forum_replies
  for each row execute function public.portal_rate_limit();

drop trigger if exists applications_rate_limit on public.applications;
create trigger applications_rate_limit
  before insert on public.applications
  for each row execute function public.portal_rate_limit();

-- ------------------------------------------------------------
-- Content filter
-- ------------------------------------------------------------
-- Blocked terms. Edit rows here (or in the table editor) to change what
-- is blocked without a deploy, and mirror the change in TERMS in
-- src/lib/portal/moderation.ts. Terms are lowercase letters and spaces.
--   word  whole word, plus a plural s/es
--   stem  word start, any ending
--   any   anywhere, even inside other words
create table if not exists public.moderation_terms (
  term     text primary key check (term ~ '^[a-z]+( [a-z]+)*$'),
  category text not null check (category in ('hate', 'sexual', 'threat', 'profanity')),
  mode     text not null check (mode in ('word', 'stem', 'any'))
);

-- RLS on with no policies: members cannot read or edit the list.
alter table public.moderation_terms enable row level security;

insert into public.moderation_terms (term, category, mode)
select t, 'hate', 'any' from unnest(array[
  'nigger', 'nigga', 'faggot', 'wetback', 'towelhead', 'raghead']) t
union all
select t, 'hate', 'word' from unnest(array[
  'fag', 'retard', 'retarded', 'tranny', 'kike', 'spic', 'gook', 'beaner', 'paki']) t
union all
select t, 'sexual', 'any' from unnest(array[
  'blowjob', 'handjob', 'onlyfans', 'send nudes']) t
union all
select t, 'sexual', 'stem' from unnest(array['porn', 'dildo', 'hentai']) t
union all
select t, 'sexual', 'word' from unnest(array['nude', 'horny', 'nsfw', 'titties']) t
union all
select t, 'threat', 'word' from unnest(array[
  'kys', 'kill yourself', 'kill urself', 'kill ur self', 'neck yourself',
  'hang yourself', 'go die', 'hope you die', 'i will kill you', 'ill kill you',
  'gonna kill you', 'going to kill you']) t
union all
select t, 'profanity', 'any' from unnest(array['fuck', 'motherfucker', 'asshole']) t
union all
select t, 'profanity', 'stem' from unnest(array['bitch', 'cunt', 'whore', 'slut']) t
union all
select t, 'profanity', 'word' from unnest(array[
  'shit', 'shitty', 'bullshit', 'shithead', 'cock', 'pussy', 'bastard', 'wtf', 'stfu']) t
on conflict (term) do update
  set category = excluded.category, mode = excluded.mode;

-- Same normalization as normalizeForModeration() in moderation.ts:
-- strip accents, lowercase, undo letter swaps that lead into a letter
-- ("sh!t", "a$$hole"), punctuation to spaces, and join letters spaced out
-- one at a time ("f u c k").
create or replace function public.portal_normalize(t text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  n   text := lower(regexp_replace(normalize(coalesce(t, ''), NFKD), '[̀-ͯ]', '', 'g'));
  src text[] := array['0', '1', '3', '4', '5', '7', '8', '@', '$', '!', '|', '+'];
  dst text[] := array['o', 'i', 'e', 'a', 's', 't', 'b', 'a', 's', 'i', 'i', 't'];
begin
  for i in 1 .. array_length(src, 1) loop
    n := regexp_replace(n, '[' || src[i] || '](?=[0134578@$!|+]*[a-z])', dst[i], 'g');
  end loop;
  n := btrim(regexp_replace(n, '[^a-z]+', ' ', 'g'));
  return regexp_replace(n, '\m([a-z]) (?=[a-z]\M)', '\1', 'g');
end;
$$;

-- The reason these fields cannot be posted, written for the member, or
-- null when they are fine. Messages match MESSAGES in moderation.ts.
create or replace function public.portal_moderation_reason(variadic fields text[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw   text := array_to_string(fields, E'\n');
  norm  text;
  core  text;
  pat   text;
  r     record;
begin
  if raw ~ '\m\d{3}-\d{2}-\d{4}\M' or raw ~ '\m(\d[ -]?){12,18}\d\M' then
    return 'That looks like a Social Security or card number. Never post those, even in a chapter channel.';
  end if;
  if (select count(*) from regexp_matches(raw, 'https?://', 'gi')) > 5 then
    return 'That has a lot of links. Keep it to a few so it does not read as spam.';
  end if;

  norm := public.portal_normalize(raw);
  for r in
    select term, category, mode from public.moderation_terms
     order by array_position(array['hate', 'sexual', 'threat', 'profanity'], category)
  loop
    -- Each letter may repeat ("fuuuck"); a space in a phrase is optional.
    core := replace(regexp_replace(r.term, '([a-z])', '\1+', 'g'), ' ', '\s*');
    pat := case r.mode
      when 'word' then '\m' || core || '(e?s)?\M'
      when 'stem' then '\m' || core
      else core
    end;
    if norm ~ pat then
      return case r.category
        when 'hate' then 'That includes a slur or hateful language. The Pipeline is for everyone, so it cannot be posted.'
        when 'sexual' then 'That includes sexual content, which is not allowed in the portal.'
        when 'threat' then 'That reads as a threat or tells someone to hurt themselves. It cannot be posted.'
        else 'Keep it professional: that includes profanity. Reword it and try again.'
      end;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.portal_moderation_reason(text[]) from public, anon;
grant execute on function public.portal_moderation_reason(text[]) to authenticated;

create or replace function public.portal_moderate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reason text;
begin
  if tg_table_name = 'forum_posts' then
    reason := public.portal_moderation_reason(new.title, new.body, array_to_string(new.tags, ' '));
  else
    reason := public.portal_moderation_reason(new.body);
  end if;
  if reason is not null then
    raise exception '%', reason using hint = 'portal';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_moderate on public.messages;
create trigger messages_moderate
  before insert or update of body on public.messages
  for each row execute function public.portal_moderate();

drop trigger if exists forum_posts_moderate on public.forum_posts;
create trigger forum_posts_moderate
  before insert or update of title, body, tags on public.forum_posts
  for each row execute function public.portal_moderate();

drop trigger if exists forum_replies_moderate on public.forum_replies;
create trigger forum_replies_moderate
  before insert or update of body on public.forum_replies
  for each row execute function public.portal_moderate();

-- Display names are stamped onto every post, so they get the same check.
-- At sign-up a bad name is dropped (posts fall back to the email name)
-- rather than failing the sign-up; a later rename is refused.
create or replace function public.portal_moderate_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is not null and public.portal_moderation_reason(new.full_name) is not null then
    if tg_op = 'INSERT' then
      new.full_name := null;
    else
      raise exception 'That name cannot be used. Pick the name you go by professionally.'
        using hint = 'portal';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_moderate_name on public.profiles;
create trigger profiles_moderate_name
  before insert or update of full_name on public.profiles
  for each row execute function public.portal_moderate_name();

notify pgrst, 'reload schema';
