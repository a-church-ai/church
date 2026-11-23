-- The served-corpus rule, said with array operators instead of a subquery over
-- unnest() for each passage, so Postgres reads it as an expression it can
-- inline. The rule is unchanged: test/db/search.test.js holds it against
-- corpus.js isServedChunk on every row, and production kept the same 3,663 of
-- 3,773 passages either way.
--
-- Measured on production, 2026-11-23, with explain analyze on one search:
-- 144ms with the old body, 107ms of it spent applying the filter; 36ms with
-- this one, 7.6ms of it the filter; 34ms with no filter at all. The rest is the
-- distance itself over embeddings stored out of line (about 15ms of reading
-- them), small enough at this size that the search stays exact. Plan:
-- database-reads-2026-11-23.md in the private repo.
--
-- A section is one path segment ('docs/<section>/...'), and a song's files are
-- exactly 'music/<slug>/<file>', so comparing segments says what the patterns
-- said: 'docs/plans/x.md' and 'docs/plans/a/b.md' are kept out, 'docs/plansx/'
-- is not, and 'music/playlist.md' or a song's own README is never served.
--
-- It sets no search_path, unlike the functions around it, because Postgres
-- never inlines a function that sets one, and inlining is the point. It is
-- safe without: it is not security definer, reads no table, and calls only
-- built-ins, which pg_catalog resolves first whatever the path. The functions
-- that call it (search_near, search_words) are security definer and keep
-- their empty search_path.

create or replace function public.search_served(p_file text, p_section text, p_noindex text[], p_unpublished text[], p_songs text[])
returns boolean
language sql
immutable
as $$
  select not (p_file like 'docs/%' and split_part(p_file, '/', 2) = any(p_noindex))
    and p_file <> all(p_unpublished)
    and lower(p_file) <> 'docs/readme.md'
    and (p_file not like 'music/%'
      or (split_part(p_file, '/', 2) = any(p_songs)
        and split_part(p_file, '/', 4) = ''
        and (split_part(p_file, '/', 3) = 'context.md'
          or (split_part(p_file, '/', 3) = 'song.md' and p_section = 'Lyrics'))));
$$;

revoke execute on function public.search_served(text, text, text[], text[], text[]) from public, anon, authenticated;
