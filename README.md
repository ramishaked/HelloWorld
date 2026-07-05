# PromptVault

Paste a prompt (text or a screenshot), and PromptVault saves it with an AI-generated
title, description, and tags — instantly searchable and copy-ready.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **Supabase** — Postgres for metadata, Storage for pasted screenshots
- **Gemini** (`@google/genai`) — multimodal enrichment (title/description/tags/OCR)
- **Vercel** — deployment target

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](./supabase/schema.sql). This creates the
   `prompts` table and a public `prompt-images` storage bucket.
3. From **Project Settings → API**, copy the **Project URL** and the **service_role** key
   (not the anon key — the app only talks to Supabase from the server).

### 2. Gemini

Grab an API key from [Google AI Studio](https://aistudio.google.com/apikey).

### 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash   # optional
```

### 4. Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then press `Cmd+V` / `Ctrl+V` anywhere on
the page to save whatever is on your clipboard — text or an image.

## How it works

- Pasting is captured by a global `paste` listener in `components/dashboard.tsx`.
- Text goes straight to the `createPromptFromText` Server Action; images are uploaded to
  Supabase Storage and sent to Gemini for OCR + analysis via `createPromptFromImage`
  (`app/actions.ts`).
- Gemini (`lib/gemini.ts`) returns structured JSON (title, description, tags, cleaned prompt
  text) using a strict `responseSchema`, so no manual parsing/repair is needed.
- All database and storage writes happen server-side with the Supabase **service role** key
  (`lib/supabase-admin.ts`). Row Level Security is enabled on `prompts` with no client-facing
  policies, so the table can't be read or written directly from the browser.
- The dashboard (`components/dashboard.tsx`) does client-side search across title,
  description, tags, and content.

## Deploy

Push this repo to GitHub and import it on [Vercel](https://vercel.com/new), then set the same
environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`) in the project settings.
