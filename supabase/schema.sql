-- PromptVault schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  description text,
  content text not null,
  image_url text,
  tags text[] not null default '{}',
  raw_analysis jsonb
);

create index if not exists prompts_created_at_idx on public.prompts (created_at desc);
create index if not exists prompts_tags_idx on public.prompts using gin (tags);
create index if not exists prompts_search_idx on public.prompts
  using gin (to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || content));

-- Row Level Security: the app talks to this table exclusively through the
-- Next.js server (using the Supabase service role key), which bypasses RLS.
-- Enabling RLS with no policies means no client-side key can read/write directly.
alter table public.prompts enable row level security;

-- Storage bucket for pasted screenshots.
insert into storage.buckets (id, name, public)
values ('prompt-images', 'prompt-images', true)
on conflict (id) do nothing;

-- Allow public read of images (bucket is public), block anonymous writes.
-- Uploads happen server-side with the service role key, which bypasses this policy.
drop policy if exists "Public read access for prompt-images" on storage.objects;
create policy "Public read access for prompt-images"
  on storage.objects for select
  using (bucket_id = 'prompt-images');
