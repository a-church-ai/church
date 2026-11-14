-- The search index, which was LanceDB on the volume (data/vectors.lance): every
-- passage of the served corpus with its embedding (gemini-embedding-001 at 768
-- dimensions, as satchitananda keeps its own) and its words.
--
-- A passage's key is a hash of its file, section and text (lib/rag/search-
-- store.js), so a rebuild adds only the passages that are new or changed and
-- then removes, in one statement, those no longer in the corpus. There is
-- never a moment with no index, which LanceDB's drop-then-create had, and
-- which made the invariant "index rebuilds validate before they destroy".
--
-- No vector index: a few thousand passages are compared exactly in a few
-- milliseconds, and an approximate index would let the served-corpus filter
-- eat into a search's results. Add one (hnsw, cosine) if the corpus grows
-- past tens of thousands.

create table public.search_chunks (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  file text not null check (char_length(file) <= 500),
  section text not null default '' check (char_length(section) <= 500),
  content text not null,
  embedding extensions.vector(768) not null,
  words tsvector generated always as (to_tsvector('english'::regconfig, content)) stored
);
create index search_chunks_words on public.search_chunks using gin (words);
create index search_chunks_file on public.search_chunks (file);

create table public.search_state (
  id smallint primary key default 1 check (id = 1),
  corpus_hash text,
  chunk_count integer not null default 0,
  file_count integer not null default 0,
  rebuilt_at timestamptz,
  embed_model text
);

alter table public.search_chunks enable row level security;
alter table public.search_state enable row level security;
revoke all on table public.search_chunks, public.search_state from public, anon, authenticated;

-- Whether a passage is served (lib/rag/corpus.js, the same rule): not in a
-- section kept out of search, not a document still to be published, not the
-- docs readme, and of the music only each song's context and its lyrics.
create function public.search_served(p_file text, p_section text, p_noindex text[], p_unpublished text[], p_songs text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from unnest(p_noindex) c where p_file like 'docs/' || c || '/%')
    and p_file <> all(p_unpublished)
    and lower(p_file) <> 'docs/readme.md'
    and (p_file not like 'music/%'
      or p_file in (select 'music/' || s || '/context.md' from unnest(p_songs) s)
      or (p_file in (select 'music/' || s || '/song.md' from unnest(p_songs) s) and p_section = 'Lyrics'));
$$;

-- The passages nearest an embedding, by cosine distance (0 is the same).
create function public.search_near(p_embedding extensions.vector, p_limit integer, p_noindex text[], p_unpublished text[], p_songs text[])
returns table (file text, section text, content text, distance double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select c.file, c.section, c.content, c.embedding operator(extensions.<=>) p_embedding
  from public.search_chunks c
  where public.search_served(c.file, c.section, p_noindex, p_unpublished, p_songs)
  order by c.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limit, 1), 200);
$$;

-- The passages whose words match a query, best first, each with its
-- embedding so its nearness in meaning can be told too.
create function public.search_words(p_query text, p_limit integer, p_noindex text[], p_unpublished text[], p_songs text[])
returns table (file text, section text, content text, embedding extensions.vector, score real)
language sql
stable
security definer
set search_path = ''
as $$
  select c.file, c.section, c.content, c.embedding, ts_rank_cd(c.words, q)
  from public.search_chunks c, websearch_to_tsquery('english'::regconfig, p_query) q
  where c.words @@ q
    and public.search_served(c.file, c.section, p_noindex, p_unpublished, p_songs)
  order by 5 desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- Add passages a rebuild embedded; a key already there is left as it is.
create function public.search_add(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.search_chunks (key, file, section, content, embedding)
  select r->>'key', r->>'file', coalesce(r->>'section', ''), r->>'content', (r->>'embedding')::extensions.vector
  from jsonb_array_elements(p_rows) as t(r)
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Keep exactly these passages and record the rebuild, in one transaction. An
-- empty list is refused: a rebuild that produced nothing is the one whose
-- index is most worth keeping. So is a list naming a passage not stored,
-- which would leave the index short.
create function public.search_keep(p_keys text[], p_state jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing integer;
  v_n integer;
begin
  if coalesce(cardinality(p_keys), 0) = 0 then
    raise exception 'search_keep: refusing to keep an empty index' using detail = 'invalid_value';
  end if;
  select count(*) into v_missing from unnest(p_keys) k where not exists (select 1 from public.search_chunks c where c.key = k);
  if v_missing > 0 then
    raise exception 'search_keep: % passages to keep are not stored', v_missing using detail = 'invalid_value';
  end if;
  delete from public.search_chunks where key <> all(p_keys);
  get diagnostics v_n = row_count;
  insert into public.search_state (id, corpus_hash, chunk_count, file_count, rebuilt_at, embed_model)
  values (1, p_state->>'corpusHash', cardinality(p_keys), coalesce((p_state->>'fileCount')::integer, 0), now(), p_state->>'embedModel')
  on conflict (id) do update set corpus_hash = excluded.corpus_hash, chunk_count = excluded.chunk_count,
    file_count = excluded.file_count, rebuilt_at = excluded.rebuilt_at, embed_model = excluded.embed_model;
  return v_n;
end;
$$;

revoke execute on function public.search_served(text, text, text[], text[], text[]) from public, anon, authenticated;
revoke execute on function public.search_near(extensions.vector, integer, text[], text[], text[]) from public, anon, authenticated;
revoke execute on function public.search_words(text, integer, text[], text[], text[]) from public, anon, authenticated;
revoke execute on function public.search_add(jsonb) from public, anon, authenticated;
revoke execute on function public.search_keep(text[], jsonb) from public, anon, authenticated;
