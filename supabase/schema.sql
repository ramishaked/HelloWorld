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
  is_favorite boolean not null default false
);

-- Idempotent for databases created before is_favorite existed.
alter table public.prompts add column if not exists is_favorite boolean not null default false;

create index if not exists prompts_created_at_idx on public.prompts (created_at desc);
create index if not exists prompts_tags_idx on public.prompts using gin (tags);
create index if not exists prompts_favorite_idx on public.prompts (is_favorite);
create index if not exists prompts_search_idx on public.prompts
  using gin (to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || content));

-- Row Level Security: the app talks to this table exclusively through the
-- Next.js server (using the Supabase service role key), which bypasses RLS.
-- Enabling RLS with no policies means no client-side key can read/write directly.
alter table public.prompts enable row level security;

-- Note: pasted images are OCR'd by Gemini in-memory and never stored, so no
-- storage bucket is required.
