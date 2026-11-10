-- A request's own text (its path, user agent, client name) is whatever a
-- visitor sent, so no length can be promised. Each is trimmed to its column's
-- limit here, so no request is refused for its length: a refused row failed
-- its whole batch, which the server would try again and again, holding up
-- every line after it. Found copying the old log, whose 96,007 lines held one
-- request for a 330-character path.

create or replace function public.record_api_requests(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.api_requests (at, method, path, operation, query, status, duration, ip, user_agent, tool, client,
    test, error, fields, content_type, door, study, referral, timezone)
  select (r->>'timestamp')::timestamptz, left(r->>'method', 10), left(r->>'path', 500), left(r->>'operation', 200),
    coalesce(r->'query', '{}'), (r->>'status')::integer, (r->>'duration')::integer, left(r->>'ip', 100),
    left(r->>'userAgent', 500), left(r->>'tool', 100), left(r->>'client', 200), coalesce((r->>'test')::boolean, false),
    r->>'error', r->'fields', left(r->>'contentType', 200), left(r->>'door', 60), r->'study', r->'referral',
    left(r->>'timezone', 100)
  from jsonb_array_elements(p_rows) as t(r);
$$;

revoke execute on function public.record_api_requests(jsonb) from public, anon, authenticated;
