-- Run this file once in Supabase Dashboard > SQL Editor.
-- The public leaderboard contains no user accounts and is capped at 20 rows.

create table if not exists public.leaderboard (
  id bigint generated always as identity primary key,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 16
    and name !~ '[[:cntrl:]]'
  ),
  avatar text not null check (avatar in (
    'Assets/processed/豆包.webp?v=2',
    'Assets/processed/Mistral.webp?v=2',
    'Assets/processed/Gemini.webp?v=2',
    'Assets/processed/MuseSpark.webp?v=2',
    'Assets/processed/GLM.webp?v=2',
    'Assets/processed/Qwen.webp?v=2',
    'Assets/processed/Kimi.webp?v=2',
    'Assets/processed/Grok.webp?v=2',
    'Assets/processed/Claude.webp?v=2',
    'Assets/processed/ChatGPT.webp?v=2',
    'Assets/processed/DeepSeek.webp?v=2'
  )),
  score integer not null check (score >= 0)
);

alter table public.leaderboard enable row level security;

drop policy if exists "Anyone can read leaderboard" on public.leaderboard;
create policy "Anyone can read leaderboard"
  on public.leaderboard for select
  to anon, authenticated
  using (true);

revoke all on table public.leaderboard from public, anon, authenticated;
grant select on table public.leaderboard to anon, authenticated;

create or replace function public.submit_leaderboard_score(
  p_name text,
  p_avatar text,
  p_score integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $leaderboard$
declare
  v_name text := pg_catalog.btrim(p_name);
  v_id bigint;
  v_previous_score integer;
  v_count bigint;
  v_lowest_score integer;
begin
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 16
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nickname must be between 1 and 16 printable characters';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Score must be a non-negative integer';
  end if;
  if p_avatar is null or p_avatar not in (
    'Assets/processed/豆包.webp?v=2',
    'Assets/processed/Mistral.webp?v=2',
    'Assets/processed/Gemini.webp?v=2',
    'Assets/processed/MuseSpark.webp?v=2',
    'Assets/processed/GLM.webp?v=2',
    'Assets/processed/Qwen.webp?v=2',
    'Assets/processed/Kimi.webp?v=2',
    'Assets/processed/Grok.webp?v=2',
    'Assets/processed/Claude.webp?v=2',
    'Assets/processed/ChatGPT.webp?v=2',
    'Assets/processed/DeepSeek.webp?v=2'
  ) then
    raise exception 'Unsupported avatar';
  end if;

  -- Serialize submissions so concurrent games cannot leave more than 20 rows.
  perform pg_catalog.pg_advisory_xact_lock(20261010, 1);

  select id, score into v_id, v_previous_score
  from public.leaderboard
  where pg_catalog.lower(name) = pg_catalog.lower(v_name)
  order by score desc, id asc
  limit 1;

  if found then
    if p_score <= v_previous_score then return false; end if;
    update public.leaderboard
    set name = v_name, avatar = p_avatar, score = p_score
    where id = v_id;
  else
    select pg_catalog.count(*), pg_catalog.min(score)
      into v_count, v_lowest_score
    from public.leaderboard;
    if v_count >= 20 and p_score <= v_lowest_score then return false; end if;
    insert into public.leaderboard (name, avatar, score)
    values (v_name, p_avatar, p_score);
  end if;

  delete from public.leaderboard as ranked
  where ranked.id not in (
    select id from public.leaderboard
    order by score desc, id asc
    limit 20
  );

  return true;
end;
$leaderboard$;

revoke all on function public.submit_leaderboard_score(text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_leaderboard_score(text, text, integer) to anon, authenticated;

create or replace function public.update_leaderboard_profile(
  p_previous_name text,
  p_name text,
  p_avatar text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $leaderboard$
declare
  v_previous_name text := pg_catalog.btrim(p_previous_name);
  v_name text := pg_catalog.btrim(p_name);
  v_id bigint;
  v_conflict_id bigint;
begin
  if v_previous_name is null or pg_catalog.char_length(v_previous_name) not between 1 and 16
     or v_previous_name ~ '[[:cntrl:]]' then
    raise exception 'Previous nickname must be between 1 and 16 printable characters';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 16
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nickname must be between 1 and 16 printable characters';
  end if;
  if p_avatar is null or p_avatar not in (
    'Assets/processed/豆包.webp?v=2',
    'Assets/processed/Mistral.webp?v=2',
    'Assets/processed/Gemini.webp?v=2',
    'Assets/processed/MuseSpark.webp?v=2',
    'Assets/processed/GLM.webp?v=2',
    'Assets/processed/Qwen.webp?v=2',
    'Assets/processed/Kimi.webp?v=2',
    'Assets/processed/Grok.webp?v=2',
    'Assets/processed/Claude.webp?v=2',
    'Assets/processed/ChatGPT.webp?v=2',
    'Assets/processed/DeepSeek.webp?v=2'
  ) then
    raise exception 'Unsupported avatar';
  end if;

  -- Keep profile edits serialized with score submissions.
  perform pg_catalog.pg_advisory_xact_lock(20261010, 1);

  select id into v_id
  from public.leaderboard
  where pg_catalog.lower(name) = pg_catalog.lower(v_previous_name)
  order by score desc, id asc
  limit 1;
  if v_id is null then return false; end if;

  select id into v_conflict_id
  from public.leaderboard
  where pg_catalog.lower(name) = pg_catalog.lower(v_name)
    and id <> v_id
  limit 1;
  if v_conflict_id is not null then
    raise exception 'Nickname is already used by another leaderboard player';
  end if;

  update public.leaderboard
  set name = v_name, avatar = p_avatar
  where id = v_id;
  return true;
end;
$leaderboard$;

revoke all on function public.update_leaderboard_profile(text, text, text) from public, anon, authenticated;
grant execute on function public.update_leaderboard_profile(text, text, text) to anon, authenticated;
