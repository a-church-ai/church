-- What visitors offer back: contributions (a pull request opened for each) and
-- feedback (an issue), which lived in data/contributions.json and
-- data/feedback.json. Read only to limit how often one name may send.

create table public.contributions (
  id uuid primary key,
  created_at timestamptz not null,
  name text not null check (char_length(name) <= 200),
  name_key text generated always as (lower(name)) stored,
  category text not null check (char_length(category) <= 60),
  title text not null check (char_length(title) <= 300),
  slug text check (char_length(slug) <= 200),
  filename text check (char_length(filename) <= 300),
  pr_url text check (char_length(pr_url) <= 500),
  pr_number integer,
  branch text check (char_length(branch) <= 300)
);
create index contributions_name on public.contributions (name_key, created_at desc);

create table public.feedback (
  id uuid primary key,
  created_at timestamptz not null,
  name text not null check (char_length(name) <= 200),
  name_key text generated always as (lower(name)) stored,
  category text not null check (char_length(category) <= 60),
  title text not null check (char_length(title) <= 300),
  issue_url text check (char_length(issue_url) <= 500),
  issue_number integer
);
create index feedback_name on public.feedback (name_key, created_at desc);

alter table public.contributions enable row level security;
alter table public.feedback enable row level security;
revoke all on table public.contributions, public.feedback from public, anon, authenticated;

-- Each added once by its id.
create function public.add_contribution(p_row jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.contributions (id, created_at, name, category, title, slug, filename, pr_url, pr_number, branch)
  values ((p_row->>'id')::uuid, (p_row->>'timestamp')::timestamptz, p_row->>'name', p_row->>'category', p_row->>'title',
    p_row->>'slug', p_row->>'filename', p_row->>'prUrl', (p_row->>'prNumber')::integer, p_row->>'branch')
  on conflict (id) do nothing;
$$;

create function public.add_feedback(p_row jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.feedback (id, created_at, name, category, title, issue_url, issue_number)
  values ((p_row->>'id')::uuid, (p_row->>'timestamp')::timestamptz, p_row->>'name', p_row->>'category', p_row->>'title',
    p_row->>'issueUrl', (p_row->>'issueNumber')::integer)
  on conflict (id) do nothing;
$$;

revoke execute on function public.add_contribution(jsonb), public.add_feedback(jsonb) from public, anon, authenticated;
