-- The services planned for each date (data/services/<date>.json), the souls
-- present kept across a deploy (data/presence.json), and the study's weekly
-- snapshots and latest reading (data/insights/self-direction/).

create table public.services (
  date date primary key,
  plan jsonb not null
);

-- Set one slot of one variant of a date's plan, in one statement, so two
-- planners cannot each save a stale copy. Returns the plan as it now is.
create function public.set_service_slot(p_date date, p_variant text, p_slot text, p_entry jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
begin
  if p_variant not in ('slots', 'north', 'south') then
    raise exception 'set_service_slot: unknown variant %', p_variant using detail = 'invalid_value';
  end if;
  insert into public.services as s (date, plan)
  values (p_date, jsonb_build_object('date', p_date::text, 'slots', '{}'::jsonb, 'north', '{}'::jsonb, 'south', '{}'::jsonb))
  on conflict (date) do nothing;
  update public.services
  set plan = jsonb_set(
    case when plan ? p_variant then plan else plan || jsonb_build_object(p_variant, '{}'::jsonb) end,
    -- A slot decided to have no service is kept as JSON null; jsonb_set
    -- with an SQL null would return null for the whole plan.
    array[p_variant, p_slot], coalesce(p_entry, 'null'::jsonb), true)
  where date = p_date
  returning plan into v_plan;
  return v_plan;
end;
$$;

-- A whole plan as it was (the copy from the old files), once.
create function public.import_service(p_date date, p_plan jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.services (date, plan) values (p_date, p_plan) on conflict (date) do nothing;
$$;

create table public.presence (
  id smallint primary key default 1 check (id = 1),
  seen jsonb not null,
  saved_at timestamptz not null default now()
);

create function public.save_presence(p_seen jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.presence (id, seen, saved_at) values (1, p_seen, now())
  on conflict (id) do update set seen = excluded.seen, saved_at = excluded.saved_at;
$$;

-- One row per week and series: a change of definition starts a new series,
-- and the older series' weeks are kept beside it, read no more.
create table public.study_weeks (
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  series integer not null,
  snapshot jsonb not null,
  primary key (week, series)
);

create table public.study_latest (
  id smallint primary key default 1 check (id = 1),
  reading jsonb not null
);

create function public.save_study_week(p_week text, p_series integer, p_snapshot jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.study_weeks (week, series, snapshot) values (p_week, p_series, p_snapshot)
  on conflict (week, series) do nothing;
$$;

create function public.save_study_latest(p_reading jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.study_latest (id, reading) values (1, p_reading)
  on conflict (id) do update set reading = excluded.reading;
$$;

alter table public.services enable row level security;
alter table public.presence enable row level security;
alter table public.study_weeks enable row level security;
alter table public.study_latest enable row level security;
revoke all on table public.services, public.presence, public.study_weeks, public.study_latest from public, anon, authenticated;
revoke execute on function public.set_service_slot(date, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.import_service(date, jsonb) from public, anon, authenticated;
revoke execute on function public.save_presence(jsonb) from public, anon, authenticated;
revoke execute on function public.save_study_week(text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.save_study_latest(jsonb) from public, anon, authenticated;
