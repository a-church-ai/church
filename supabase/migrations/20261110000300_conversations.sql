-- Every conversation asked of the sanctuary (data/conversations/<slug>.jsonl),
-- with what grouping decided of it (conversation-groups.json,
-- conversation-screen.json) and its first question's embedding
-- (conversation-vectors.jsonl).
--
-- A conversation opened from the website has a slug made from its question and
-- an owner token; one opened over the API by a name is "<name>-<date>"; an
-- anonymous one "anon-<id>". The earliest have no meta at all, so name, owner
-- token and created are null for them, as their files had no _meta line.

create table public.conversations (
  slug text primary key check (slug ~ '^[A-Za-z0-9_-]{1,200}$'),
  has_meta boolean not null default false,
  name text check (char_length(name) <= 200),
  owner_token text check (char_length(owner_token) <= 64),
  created_at timestamptz,
  -- The conversation it was gathered onto (itself when it heads a group),
  -- assigned once.
  group_head text,
  -- Whether its first question may be listed, decided once: { show, at }.
  screen jsonb,
  -- Its first question's embedding, made once.
  embedding extensions.vector(768)
);

create table public.conversation_turns (
  id bigint generated always as identity primary key,
  slug text not null references public.conversations (slug) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  at timestamptz not null,
  -- door and referral on a question, nearest on an answer, as the lines had.
  details jsonb not null default '{}'
);
create index conversation_turns_slug on public.conversation_turns (slug, id);
create index conversation_turns_at on public.conversation_turns (at);

alter table public.conversations enable row level security;
alter table public.conversation_turns enable row level security;
revoke all on table public.conversations, public.conversation_turns from public, anon, authenticated;
revoke all on sequence public.conversation_turns_id_seq from public, anon, authenticated;

-- Open a conversation from the website: the first free slug of slug, slug-2,
-- slug-3, ..., taken in one statement each, so two questions alike cannot
-- both take one. Returns the slug taken.
create function public.open_conversation(p_slug text, p_name text, p_owner_token text, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := p_slug;
  v_n integer := 1;
begin
  loop
    insert into public.conversations (slug, has_meta, name, owner_token, created_at)
    values (v_slug, true, p_name, p_owner_token, p_at)
    on conflict (slug) do nothing;
    if found then return v_slug; end if;
    v_n := v_n + 1;
    v_slug := p_slug || '-' || v_n;
  end loop;
end;
$$;

-- Add turns to a conversation, creating it without meta if it is new (a
-- named or anonymous session over the API).
create function public.add_turns(p_slug text, p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.conversations (slug) values (p_slug) on conflict (slug) do nothing;
  insert into public.conversation_turns (slug, role, content, at, details)
  select p_slug, r->>'role', r->>'content', (r->>'timestamp')::timestamptz, r - array['role', 'content', 'timestamp']
  from jsonb_array_elements(p_rows) with ordinality as t(r, n)
  order by n;
$$;

-- What grouping decides, each once: the first decision stands.
create function public.set_conversation_screen(p_slug text, p_screen jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations set screen = p_screen where slug = p_slug and screen is null;
$$;

create function public.set_conversation_embedding(p_slug text, p_embedding extensions.vector)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations set embedding = p_embedding where slug = p_slug and embedding is null;
$$;

create function public.set_conversation_group(p_slug text, p_head text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations set group_head = p_head where slug = p_slug and group_head is null;
$$;

-- The copy from the old files: a conversation whole, its meta and turns, once.
create function public.import_conversation(p_slug text, p_meta jsonb, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (slug, has_meta, name, owner_token, created_at)
  values (p_slug, p_meta is not null, p_meta->>'name', p_meta->>'owner_token', (p_meta->>'created')::timestamptz)
  on conflict (slug) do nothing;
  if not found then return; end if;
  insert into public.conversation_turns (slug, role, content, at, details)
  select p_slug, r->>'role', r->>'content', (r->>'timestamp')::timestamptz, r - array['role', 'content', 'timestamp']
  from jsonb_array_elements(p_rows) with ordinality as t(r, n)
  order by n;
end;
$$;

revoke execute on function public.open_conversation(text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.add_turns(text, jsonb) from public, anon, authenticated;
revoke execute on function public.set_conversation_screen(text, jsonb) from public, anon, authenticated;
revoke execute on function public.set_conversation_embedding(text, extensions.vector) from public, anon, authenticated;
revoke execute on function public.set_conversation_group(text, text) from public, anon, authenticated;
revoke execute on function public.import_conversation(text, jsonb, jsonb) from public, anon, authenticated;
