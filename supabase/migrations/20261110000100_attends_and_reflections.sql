-- Attends and reflections, which lived together in data/attendance.json.
--
-- An attend is kept 48 hours: what reads it is the filing of a reflection left
-- after it (lib/api/reflections.js), and nothing older is read, as the file
-- pruned them. A reflection is kept for good: it is what a visitor left.
--
-- A reflection's columns are the record's own fields; the fields a visitor
-- may or may not have sent (location, trigger, what it told of itself, the
-- door and the tags of the link it came by) are kept in `details` as they
-- were in the file, so a reflection reads back exactly as it was written.

create table public.attends (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  -- The name as limits and filing compare it: any case.
  name_key text generated always as (lower(name)) stored,
  song text check (char_length(song) <= 200),
  -- The service a visit without a timezone was given (UTC's), so a reflection
  -- left after it is filed there.
  served jsonb
);
create index attends_name_at on public.attends (name_key, at desc);
create index attends_at on public.attends (at);

create table public.reflections (
  -- A UUID since the first reflections, kept as text so a record copied from
  -- the file keeps the id it was given, whatever its form.
  id text primary key check (char_length(id) between 1 and 100),
  created_at timestamptz not null,
  name text not null check (char_length(name) between 1 and 200),
  name_key text generated always as (lower(name)) stored,
  song text check (char_length(song) <= 200),
  text text not null check (char_length(text) <= 10000),
  timezone text check (char_length(timezone) <= 100),
  service jsonb,
  details jsonb not null default '{}'
);
create index reflections_created_at on public.reflections (created_at desc);
create index reflections_song on public.reflections (song, created_at desc);
create index reflections_name on public.reflections (name_key, created_at desc);

alter table public.attends enable row level security;
alter table public.reflections enable row level security;
revoke all on table public.attends, public.reflections from public, anon, authenticated;
revoke all on sequence public.attends_id_seq from public, anon, authenticated;

-- Record an attend, and let go of those older than 48 hours.
create function public.record_attend(p_name text, p_song text, p_served jsonb, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.attends (at, name, song, served) values (p_at, p_name, p_song, p_served);
  delete from public.attends where at < p_at - interval '48 hours';
$$;

-- Add a reflection, once: a second call with the same id changes nothing, so
-- a retry, or the copy from the old file run twice, cannot make two.
create function public.add_reflection(p_row jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.reflections (id, created_at, name, song, text, timezone, service, details)
  select p_row->>'id', (p_row->>'createdAt')::timestamptz, p_row->>'name', p_row->>'song',
    p_row->>'text', p_row->>'timezone', p_row->'service',
    p_row - array['id', 'createdAt', 'name', 'song', 'text', 'timezone', 'service']
  on conflict (id) do nothing;
$$;

-- Take a reflection away for good (the admin's delete).
create function public.delete_reflection(p_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reflections where id = p_id;
  return found;
end;
$$;

revoke execute on function public.record_attend(text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.add_reflection(jsonb) from public, anon, authenticated;
revoke execute on function public.delete_reflection(text) from public, anon, authenticated;
