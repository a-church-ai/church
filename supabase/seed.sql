-- Applied to the local database only (`supabase start`, `supabase db reset`);
-- never pushed to the hosted project, which has no such function.
--
-- The tests' fresh start: each test file that stores data begins from empty
-- tables (app/test/db.js), as each began from an empty scratch directory when
-- the data lived in files.

create function public.reset_for_tests()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  truncate public.attends, public.reflections, public.contributions, public.feedback,
    public.conversation_turns, public.conversations, public.services, public.presence,
    public.study_weeks, public.study_latest, public.api_requests, public.page_visits,
    public.entry_points, public.api_hourly, public.api_daily_addresses, public.visits_hourly,
    public.visits_daily_visitors, public.summarized_days, public.search_chunks, public.search_state
    restart identity;
end;
$$;

revoke execute on function public.reset_for_tests() from public, anon, authenticated;
