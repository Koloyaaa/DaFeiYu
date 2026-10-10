-- Run after the existing leaderboard setup. This adds a private stable identity
-- so equal nicknames belong to separate players and profile edits target one row.

alter table public.leaderboard
  add column if not exists player_id uuid;

create unique index if not exists leaderboard_player_id_uidx
  on public.leaderboard (player_id)
  where player_id is not null;

-- Keep the stable identity private; the browser receives only a per-row match flag.
revoke all on table public.leaderboard from public, anon, authenticated;
grant select (name, avatar, score) on table public.leaderboard to anon, authenticated;

create or replace function public.get_leaderboard(p_player_id uuid)
returns table(name text, avatar text, score integer, is_player boolean)
language sql
stable
security definer
set search_path = ''
as $leaderboard$
  select ranked.name, ranked.avatar, ranked.score,
         coalesce(ranked.player_id = p_player_id, false) as is_player
  from (
    select entries.id as row_id, entries.name, entries.avatar, entries.score, entries.player_id
    from public.leaderboard as entries
    order by entries.score desc, entries.id asc
    limit 20
  ) as ranked
  order by ranked.score desc, ranked.row_id asc;
$leaderboard$;

revoke all on function public.get_leaderboard(uuid) from public, anon, authenticated;
grant execute on function public.get_leaderboard(uuid) to anon, authenticated;

create or replace function public.submit_leaderboard_score(
  p_player_id uuid,
  p_previous_name text,
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
  v_previous_name text := nullif(pg_catalog.btrim(p_previous_name), '');
  v_id bigint;
  v_previous_score integer;
  v_count bigint;
  v_lowest_score integer;
  v_legacy_count bigint;
begin
  if p_player_id is null then
    raise exception 'Player identity is required';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 16
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nickname must be between 1 and 16 printable characters';
  end if;
  if v_previous_name is not null and (pg_catalog.char_length(v_previous_name) not between 1 and 16
     or v_previous_name ~ '[[:cntrl:]]') then
    raise exception 'Previous nickname must be between 1 and 16 printable characters';
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

  perform pg_catalog.pg_advisory_xact_lock(20261010, 1);

  select id, score into v_id, v_previous_score
  from public.leaderboard
  where player_id = p_player_id
  order by score desc, id asc
  limit 1
  for update;

  -- Associate an old name-based score with its browser identity once. More
  -- than one matching legacy row is ambiguous, so leave it untouched.
  if v_id is null and v_previous_name is not null then
    select pg_catalog.count(*) into v_legacy_count
    from public.leaderboard
    where player_id is null
      and pg_catalog.lower(name) = pg_catalog.lower(v_previous_name);
    if v_legacy_count > 1 then
      raise exception 'Legacy leaderboard identity is ambiguous';
    elsif v_legacy_count = 1 then
      select id, score into v_id, v_previous_score
      from public.leaderboard
      where player_id is null
        and pg_catalog.lower(name) = pg_catalog.lower(v_previous_name)
      order by score desc, id asc
      limit 1
      for update;
    end if;
  end if;

  if v_id is not null then
    if p_score <= v_previous_score then
      update public.leaderboard
      set player_id = p_player_id, name = v_name, avatar = p_avatar
      where id = v_id;
      return false;
    end if;
    update public.leaderboard
    set player_id = p_player_id, name = v_name, avatar = p_avatar, score = p_score
    where id = v_id;
  else
    select pg_catalog.count(*), pg_catalog.min(score)
      into v_count, v_lowest_score
    from public.leaderboard;
    if v_count >= 20 and p_score <= v_lowest_score then return false; end if;
    insert into public.leaderboard (player_id, name, avatar, score)
    values (p_player_id, v_name, p_avatar, p_score);
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

revoke all on function public.submit_leaderboard_score(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_leaderboard_score(uuid, text, text, text, integer) to anon, authenticated;

create or replace function public.update_leaderboard_profile(
  p_player_id uuid,
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
  v_previous_name text := nullif(pg_catalog.btrim(p_previous_name), '');
  v_name text := pg_catalog.btrim(p_name);
  v_id bigint;
  v_legacy_count bigint;
begin
  if p_player_id is null then
    raise exception 'Player identity is required';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 16
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nickname must be between 1 and 16 printable characters';
  end if;
  if v_previous_name is not null and (pg_catalog.char_length(v_previous_name) not between 1 and 16
     or v_previous_name ~ '[[:cntrl:]]') then
    raise exception 'Previous nickname must be between 1 and 16 printable characters';
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

  perform pg_catalog.pg_advisory_xact_lock(20261010, 1);

  select id into v_id
  from public.leaderboard
  where player_id = p_player_id
  order by score desc, id asc
  limit 1
  for update;

  if v_id is null and v_previous_name is not null then
    select pg_catalog.count(*) into v_legacy_count
    from public.leaderboard
    where player_id is null
      and pg_catalog.lower(name) = pg_catalog.lower(v_previous_name);
    if v_legacy_count > 1 then
      raise exception 'Legacy leaderboard identity is ambiguous';
    elsif v_legacy_count = 1 then
      select id into v_id
      from public.leaderboard
      where player_id is null
        and pg_catalog.lower(name) = pg_catalog.lower(v_previous_name)
      order by score desc, id asc
      limit 1
      for update;
    end if;
  end if;

  if v_id is null then return false; end if;

  update public.leaderboard
  set player_id = p_player_id, name = v_name, avatar = p_avatar
  where id = v_id;
  return true;
end;
$leaderboard$;

revoke all on function public.update_leaderboard_profile(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.update_leaderboard_profile(uuid, text, text, text) to anon, authenticated;

-- Disable older name-only calls so stale clients cannot merge two players again.
create or replace function public.submit_leaderboard_score(p_name text, p_avatar text, p_score integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $leaderboard$
begin
  raise exception 'This game version is out of date. Refresh the page to submit scores.';
end;
$leaderboard$;

revoke all on function public.submit_leaderboard_score(text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_leaderboard_score(text, text, integer) to anon, authenticated;

create or replace function public.update_leaderboard_profile(p_previous_name text, p_name text, p_avatar text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $leaderboard$
begin
  raise exception 'This game version is out of date. Refresh the page to update your profile.';
end;
$leaderboard$;

revoke all on function public.update_leaderboard_profile(text, text, text) from public, anon, authenticated;
grant execute on function public.update_leaderboard_profile(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
