-- The sanctuary's database: what visitors create, and the search index
-- (plan: supabase-database-2026-11-09.md in the private repo).
--
-- Only the server reaches it, with the project's secret key. No browser and no
-- agent holds a Supabase key, so nothing here is granted to anon or
-- authenticated, and no table has a policy: RLS is on and closes every table
-- to everyone but the service role.
--
-- Hosted Supabase grants every new table, function and sequence in public to
-- anon and authenticated by default privileges, on top of PUBLIC (ai-animal-
-- house learned this from an audit). Revoke those defaults first, so nothing
-- made later is born reachable, and still revoke each object by name.

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;

create extension if not exists vector with schema extensions;
