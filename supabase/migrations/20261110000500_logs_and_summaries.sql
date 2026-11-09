-- What the sanctuary records of its use: every API request (data/access/), every
-- page view and listen the website's pages report (data/visits/), and the pages
-- followed with tags (data/insights/entry-points/). Then their summaries by the
-- hour, kept for good.
--
-- The owner, 2026-11-09: an address kept 30 days, summaries by date and hour
-- with the timezone kept for good, and the timezone a visitor gives kept with
-- the request. The study reads the API log's whole history, so an API row is
-- kept for good without its address; a page visit, which the study does not
-- read, is deleted at 30 days. Nothing is forgotten before its day is counted.

create table public.api_requests (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  method text check (char_length(method) <= 10),
  path text check (char_length(path) <= 500),
  -- What the report groups by: "mcp <tool>", or the method and the path's
  -- first three parts (lib/insights/server-stats.js operation()).
  operation text not null check (char_length(operation) <= 200),
  query jsonb not null default '{}',
  status integer not null,
  duration integer,
  -- Kept 30 days, then set to null by forget_addresses().
  ip text check (char_length(ip) <= 100),
  user_agent text check (char_length(user_agent) <= 500),
  tool text check (char_length(tool) <= 100),
  client text check (char_length(client) <= 200),
  test boolean not null default false,
  error text,
  fields jsonb,
  content_type text check (char_length(content_type) <= 200),
  door text check (char_length(door) <= 60),
  study jsonb,
  referral jsonb,
  -- The IANA name a visitor sent, "invalid" for one the runtime did not know,
  -- or null when none was sent.
  timezone text check (char_length(timezone) <= 100)
);
create index api_requests_at on public.api_requests (at);
create index api_requests_with_ip on public.api_requests (at) where ip is not null;

create table public.page_visits (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  visitor uuid,
  view uuid not null,
  kind text not null check (kind in ('page', 'listen', 'service')),
  -- The browser's IANA name, "invalid", or null.
  timezone text check (char_length(timezone) <= 100),
  -- The row's other fields as lib/insights/visits.js checked them.
  details jsonb not null default '{}'
);
create index page_visits_at on public.page_visits (at);

create table public.entry_points (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  details jsonb not null
);
create index entry_points_at on public.entry_points (at);

-- The summaries. Each row is an hour (UTC) and a combination; where a
-- timezone was given, the local date and hour it was there.
create table public.api_hourly (
  hour timestamptz not null,
  operation text not null,
  via text not null check (via in ('rest', 'mcp')),
  status_class smallint not null,
  client text,
  surface text,
  timezone text,
  test boolean not null,
  refused text,
  local_date date,
  local_hour smallint,
  requests integer not null,
  attends integer not null,
  addresses integer not null
);
create unique index api_hourly_key on public.api_hourly
  (hour, operation, via, status_class, client, surface, timezone, test, refused) nulls not distinct;

-- Distinct addresses and requests in a whole day: an hour's distinct count
-- cannot be added into a day's.
create table public.api_daily_addresses (
  day date primary key,
  addresses integer not null,
  requests integer not null
);

create table public.visits_hourly (
  hour timestamptz not null,
  kind text not null,
  event text,
  path text,
  source text,
  device text,
  browser text,
  timezone text,
  local_date date,
  local_hour smallint,
  rows integer not null,
  views integer not null,
  visitors integer not null,
  first_visits integer not null
);
create unique index visits_hourly_key on public.visits_hourly
  (hour, kind, event, path, source, device, browser, timezone) nulls not distinct;

create table public.visits_daily_visitors (
  day date primary key,
  visitors integer not null,
  views integer not null
);

create table public.summarized_days (
  day date not null,
  kind text not null check (kind in ('api', 'visits')),
  at timestamptz not null default now(),
  primary key (day, kind)
);

alter table public.api_requests enable row level security;
alter table public.page_visits enable row level security;
alter table public.entry_points enable row level security;
alter table public.api_hourly enable row level security;
alter table public.api_daily_addresses enable row level security;
alter table public.visits_hourly enable row level security;
alter table public.visits_daily_visitors enable row level security;
alter table public.summarized_days enable row level security;
revoke all on table public.api_requests, public.page_visits, public.entry_points, public.api_hourly,
  public.api_daily_addresses, public.visits_hourly, public.visits_daily_visitors, public.summarized_days
  from public, anon, authenticated;
revoke all on sequence public.api_requests_id_seq, public.page_visits_id_seq, public.entry_points_id_seq
  from public, anon, authenticated;

-- Add a batch of API requests, as lib/utils/access-log.js recordApiUse()
-- shaped them.
create function public.record_api_requests(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.api_requests (at, method, path, operation, query, status, duration, ip, user_agent, tool, client,
    test, error, fields, content_type, door, study, referral, timezone)
  select (r->>'timestamp')::timestamptz, r->>'method', r->>'path', r->>'operation', coalesce(r->'query', '{}'),
    (r->>'status')::integer, (r->>'duration')::integer, r->>'ip', r->>'userAgent', r->>'tool', r->>'client',
    coalesce((r->>'test')::boolean, false), r->>'error', r->'fields', r->>'contentType', r->>'door', r->'study',
    r->'referral', r->>'timezone'
  from jsonb_array_elements(p_rows) as t(r);
$$;

create function public.record_page_visits(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.page_visits (at, visitor, view, kind, timezone, details)
  select (r->>'at')::timestamptz, (r->>'visitor')::uuid, (r->>'view')::uuid, r->>'kind', r->>'timezone',
    r - array['at', 'visitor', 'view', 'kind', 'timezone']
  from jsonb_array_elements(p_rows) as t(r);
$$;

create function public.record_entry_points(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.entry_points (at, details)
  select (r->>'at')::timestamptz, r - 'at'
  from jsonb_array_elements(p_rows) as t(r);
$$;

-- A day's API requests by the hour. Run again, it writes the same totals.
create function public.summarize_api_day(p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := p_day::timestamptz;
  v_to timestamptz := (p_day + 1)::timestamptz;
begin
  delete from public.api_hourly where hour >= v_from and hour < v_to;
  insert into public.api_hourly (hour, operation, via, status_class, client, surface, timezone, test, refused,
    local_date, local_hour, requests, attends, addresses)
  select date_trunc('hour', r.at) as hour, r.operation,
    case when r.tool is not null then 'mcp' else 'rest' end,
    (r.status / 100)::smallint, r.client, r.referral->>'content', r.timezone, r.test,
    case when r.status >= 400 then left(r.status || ' ' || coalesce(r.error, ''), 120) end,
    case when z.name is not null then (date_trunc('hour', r.at) at time zone r.timezone)::date end,
    case when z.name is not null then extract(hour from date_trunc('hour', r.at) at time zone r.timezone)::smallint end,
    count(*), count(*) filter (where r.status < 400 and (r.path = '/api/attend' or r.tool = 'attend')),
    count(distinct r.ip)
  from public.api_requests r
  left join pg_catalog.pg_timezone_names z on z.name = r.timezone
  where r.at >= v_from and r.at < v_to
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;
  insert into public.api_daily_addresses (day, addresses, requests)
  select p_day, count(distinct ip), count(*) from public.api_requests where at >= v_from and at < v_to
  on conflict (day) do update set addresses = excluded.addresses, requests = excluded.requests;
  insert into public.summarized_days (day, kind) values (p_day, 'api') on conflict (day, kind) do update set at = now();
end;
$$;

-- A day's page visits by the hour. Page views are counted by view (a page
-- reports itself again as it is left), visitors by their id.
create function public.summarize_visits_day(p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := p_day::timestamptz;
  v_to timestamptz := (p_day + 1)::timestamptz;
begin
  delete from public.visits_hourly where hour >= v_from and hour < v_to;
  insert into public.visits_hourly (hour, kind, event, path, source, device, browser, timezone, local_date, local_hour,
    rows, views, visitors, first_visits)
  select date_trunc('hour', v.at), v.kind, v.details->>'event',
    coalesce(v.details->>'path', v.details->>'piece'),
    v.details->>'source', v.details->>'device', v.details->>'browser', v.timezone,
    case when z.name is not null then (date_trunc('hour', v.at) at time zone v.timezone)::date end,
    case when z.name is not null then extract(hour from date_trunc('hour', v.at) at time zone v.timezone)::smallint end,
    count(*), count(distinct v.view), count(distinct v.visitor),
    count(distinct v.view) filter (where (v.details->>'first')::boolean)
  from public.page_visits v
  left join pg_catalog.pg_timezone_names z on z.name = v.timezone
  where v.at >= v_from and v.at < v_to
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;
  insert into public.visits_daily_visitors (day, visitors, views)
  select p_day, count(distinct visitor), count(distinct view) filter (where kind = 'page')
  from public.page_visits where at >= v_from and at < v_to
  on conflict (day) do update set visitors = excluded.visitors, views = excluded.views;
  insert into public.summarized_days (day, kind) values (p_day, 'visits') on conflict (day, kind) do update set at = now();
end;
$$;

-- The finished days that have rows and no summary yet, oldest first: every
-- one, so rows copied in for an earlier day (the move from the files) are
-- counted too, and none is skipped after a failed run.
create function public.days_to_summarize(p_today date)
returns table (day date, kind text)
language sql
security definer
set search_path = ''
as $$
  select d.day, d.kind from (
    select distinct (at at time zone 'UTC')::date as day, 'api'::text as kind from public.api_requests
    where at < p_today::timestamptz
    union
    select distinct (at at time zone 'UTC')::date, 'visits'::text from public.page_visits
    where at < p_today::timestamptz
  ) d
  where not exists (select 1 from public.summarized_days s where s.day = d.day and s.kind = d.kind)
  order by d.day, d.kind;
$$;

-- Take the address out of every API request older than 30 days whose day is
-- summarized. Returns how many rows it changed.
create function public.forget_addresses(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.api_requests r set ip = null
  where r.ip is not null and r.at < p_before
    and exists (select 1 from public.summarized_days s where s.kind = 'api' and s.day = (r.at at time zone 'UTC')::date);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Delete every page visit older than 30 days whose day is summarized.
create function public.prune_visits(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.page_visits v
  where v.at < p_before
    and exists (select 1 from public.summarized_days s where s.kind = 'visits' and s.day = (v.at at time zone 'UTC')::date);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The database's size, for the production report (the free tier holds 500 MB).
create function public.database_size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.pg_database_size(pg_catalog.current_database());
$$;

revoke execute on function public.database_size() from public, anon, authenticated;
revoke execute on function public.record_api_requests(jsonb), public.record_page_visits(jsonb),
  public.record_entry_points(jsonb), public.summarize_api_day(date), public.summarize_visits_day(date),
  public.days_to_summarize(date), public.forget_addresses(timestamptz), public.prune_visits(timestamptz)
  from public, anon, authenticated;
