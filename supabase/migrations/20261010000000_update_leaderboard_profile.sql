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
