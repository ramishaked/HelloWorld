-- PromptVault schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  description text,
  content text not null,
  tags text[] not null default '{}',
  raw_analysis jsonb,
  is_favorite boolean not null default false,
  media_type text not null default 'text' check (media_type in ('image', 'video', 'text')),
  -- High-level AI-assigned subject used to cluster prompts (e.g. "Learning").
  category text,
  -- Optional user-attached example of what an image-generation prompt produces.
  example_image_url text
);

-- Idempotent for databases created before these columns existed.
alter table public.prompts add column if not exists is_favorite boolean not null default false;
alter table public.prompts add column if not exists media_type text not null default 'text';
alter table public.prompts drop constraint if exists prompts_media_type_check;
alter table public.prompts add constraint prompts_media_type_check check (media_type in ('image', 'video', 'text'));
alter table public.prompts add column if not exists category text;
alter table public.prompts add column if not exists example_image_url text;

create index if not exists prompts_created_at_idx on public.prompts (created_at desc);
create index if not exists prompts_tags_idx on public.prompts using gin (tags);
create index if not exists prompts_favorite_idx on public.prompts (is_favorite);
create index if not exists prompts_media_type_idx on public.prompts (media_type);
create index if not exists prompts_category_idx on public.prompts (category);
create index if not exists prompts_search_idx on public.prompts
  using gin (to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || content));

-- Row Level Security: the app talks to this table exclusively through the
-- Next.js server (using the Supabase service role key), which bypasses RLS.
-- Enabling RLS with no policies means no client-side key can read/write directly.
alter table public.prompts enable row level security;

-- Pasted images are OCR'd by Gemini in-memory and never stored. The only images
-- kept are optional user-attached *example outputs* for image-generation prompts,
-- which live in this public bucket (uploads happen server-side via the service
-- role key; the public read policy lets the <img> tag load them).
insert into storage.buckets (id, name, public)
values ('prompt-images', 'prompt-images', true)
on conflict (id) do nothing;

drop policy if exists "Public read prompt-images" on storage.objects;
create policy "Public read prompt-images"
  on storage.objects for select
  using (bucket_id = 'prompt-images');
