-- WhatsApp → Calendar bot schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Idempotency. Meta re-delivers failed webhooks for up to 7 days, and the bot
-- creates calendar events with no confirmation step, so a replayed delivery
-- would otherwise double-book the user. The wamid primary key makes the insert
-- itself the lock: a conflict means "already seen, stop".
-- ---------------------------------------------------------------------------
create table if not exists public.processed_messages (
  wamid text primary key,
  wa_from text,
  received_at timestamptz not null default now()
);

create index if not exists processed_messages_received_at_idx
  on public.processed_messages (received_at desc);

-- ---------------------------------------------------------------------------
-- A partially-parsed appointment waiting on missing information. Keyed by
-- sender so the follow-up answer ("tomorrow 3pm") merges into the right draft.
-- ---------------------------------------------------------------------------
create table if not exists public.pending_drafts (
  wa_from text primary key,
  draft jsonb not null default '{}'::jsonb,
  question text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Single-row store for the Google OAuth refresh token, written once by the
-- /api/auth/google/callback route.
-- ---------------------------------------------------------------------------
create table if not exists public.google_tokens (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  calendar_email text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail. Events are created with no confirmation and no undo, so this is
-- the only record of what was understood from each message and what came of it.
-- ---------------------------------------------------------------------------
create table if not exists public.event_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  wa_from text,
  wamid text,
  input_kind text not null default 'text' check (input_kind in ('text', 'image', 'audio')),
  input_text text,
  parsed jsonb,
  outcome text not null default 'created' check (outcome in ('created', 'asked', 'cancelled', 'ignored', 'error')),
  google_event_id text,
  google_event_link text,
  error text
);

create index if not exists event_log_created_at_idx on public.event_log (created_at desc);
create index if not exists event_log_wa_from_idx on public.event_log (wa_from);

-- ---------------------------------------------------------------------------
-- Row Level Security: every read and write goes through the Next.js server
-- using the service role key, which bypasses RLS. Enabling RLS with no policies
-- means no client-side key can touch these tables directly.
-- ---------------------------------------------------------------------------
alter table public.processed_messages enable row level security;
alter table public.pending_drafts enable row level security;
alter table public.google_tokens enable row level security;
alter table public.event_log enable row level security;
