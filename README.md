# PromptVault

Paste a prompt (text or a screenshot), and PromptVault saves it with an AI-generated
title, description, and tags — instantly searchable and copy-ready.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **Supabase** — Postgres for prompt metadata and text
- **Gemini** (`@google/genai`) — multimodal enrichment (title/description/tags/OCR)
- **Vercel** — deployment target

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](./supabase/schema.sql). This creates the
   `prompts` table. (No storage bucket is needed — pasted images are OCR'd in memory and only
   the extracted text is stored.)
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

Open [http://localhost:3000](http://localhost:3000). Tap the **Paste** button (or press
`Cmd+V` / `Ctrl+V` on desktop) to save whatever is on your clipboard — text or an image.

## How it works

- Tapping **Paste** reads the clipboard directly via the Async Clipboard API
  (`navigator.clipboard.read()` / `readText()`) — this is the primary interaction, since iPhone
  has no keyboard shortcut to listen for. A global `paste` event listener is also wired up as a
  desktop convenience for `Cmd/Ctrl+V` (`components/dashboard.tsx`).
- Text goes straight to the `createPromptFromText` Server Action; images are sent (in memory)
  to Gemini for OCR + analysis via `createPromptFromImage` — the image itself is never stored,
  only the text Gemini extracts from it (`app/actions.ts`).
- Gemini (`lib/gemini.ts`) returns structured JSON (title, description, tags, cleaned prompt
  text) using a strict `responseSchema`, so no manual parsing/repair is needed.
- All database writes happen server-side with the Supabase **service role** key
  (`lib/supabase-admin.ts`). Row Level Security is enabled on `prompts` with no client-facing
  policies, so the table can't be read or written directly from the browser.
- The dashboard (`components/dashboard.tsx`) does client-side search across title,
  description, tags, and content.

## Deploy

Push this repo to GitHub and import it on [Vercel](https://vercel.com/new), then set the same
environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`) in the project settings. Vercel serves everything over HTTPS, which the
Clipboard API requires.

## Installing on your iPhone (personal use, no App Store)

This is a PWA (`app/manifest.ts`) — you can install it as a home-screen app without going
through the App Store:

1. Open the deployed URL in **Safari** on your iPhone (must be Safari, not Chrome/other
   browsers — only Safari can add to the home screen).
2. Tap the **Share** icon, then **Add to Home Screen**.
3. Launch it from the home screen icon. It opens full-screen, without Safari's address bar,
   and behaves like a native app.

Since it's only installed via your own Safari "Add to Home Screen," it's private to your
device — nothing is published or reviewed anywhere.
