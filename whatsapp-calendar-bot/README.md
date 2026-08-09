# WhatsApp → Google Calendar

Send a WhatsApp message like *"budget review with Dan next Thursday 3pm at the office"* — or a screenshot of
an invite, or a voice note — and the appointment appears in your Google Calendar. Works in Hebrew and English.

The bot creates the event immediately, with no confirmation step. When the **subject** or the **date/time** is
missing it asks one short follow-up question instead, in whichever language you wrote in.

```
You  ▸ פגישה עם דני מחר ב-15:00 במשרד
Bot  ◂ ✅ נקבע: פגישה עם דני
       🗓 ד׳, 12 באוג׳ 2026, 15:00–16:00
       📍 משרד
       https://calendar.google.com/…

You  ▸ meeting with Dan
Bot  ◂ When should I schedule it?
You  ▸ tomorrow 4pm
Bot  ◂ ✅ Added: meeting with Dan …
```

## Cost

**Nothing.** WhatsApp *service conversations* — ones you start, answered within 24 hours — have been free and
unlimited since November 2024, and this bot never sends a template message (the only billable kind). Vercel
Hobby, Supabase free tier and the Gemini free tier cover the rest.

It also uses the **official** Cloud API, so your personal WhatsApp account is never automated and is not at
risk, unlike `whatsapp-web.js`-style approaches.

## How it works

```
WhatsApp → Meta Cloud API → POST /api/whatsapp/webhook
                              ├─ verify X-Hub-Signature-256 over the raw body
                              ├─ reject senders not in ALLOWED_WA_NUMBERS
                              ├─ claim the message id (ON CONFLICT DO NOTHING)
                              ├─ 200 OK  ◄── immediately
                              └─ after(): download media → Gemini → validate
                                          → ask a question, or create the event
```

Two properties are load-bearing:

- **Fast ack.** Meta wants a sub-250ms response and retries anything slower, so the parse and calendar write
  happen in `after()` — after the response has already gone out.
- **Exactly-once.** Meta redelivers failed webhooks for up to 7 days. Since events are created with no undo, a
  redelivery must not double-book you. The `processed_messages` primary key makes the database the arbiter:
  only genuinely new message ids are returned by the claiming insert.

## Setup

### 1. Supabase

Create a project, then run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. Copy the project URL
and the **service role** key from Project Settings → API.

### 2. Meta WhatsApp Cloud API

1. At [developers.facebook.com](https://developers.facebook.com/apps), create an app of type **Business** and
   add the **WhatsApp** product. A **Test Business Account** is enough — no business verification, no phone
   number purchase.
2. Under **WhatsApp → API Setup** you get a free test number and its **Phone number ID**. Add your own number
   under *To* as a verified recipient (up to 5 are allowed).
3. **Generate a permanent token.** The token shown on the API Setup page expires in **24 hours**. Go to
   Business Settings → **System Users** → add a user → *Generate token*, selecting your app and the
   `whatsapp_business_messaging` and `whatsapp_business_management` scopes. That token does not expire — use it
   as `WHATSAPP_TOKEN`.
4. Copy the **App Secret** from App Settings → Basic → `WHATSAPP_APP_SECRET`.
5. Leave the webhook configuration until after the first deploy (step 5 below), since it needs the live URL.

### 3. Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google
   Calendar API**.
2. Configure the **OAuth consent screen**: User type *External*, and add yourself as the contact. Add the scope
   `https://www.googleapis.com/auth/calendar.events`.
3. **Publish the app — set publishing status to "In production".** This step is not optional. While the consent
   screen sits in *Testing*, Google **revokes refresh tokens after 7 days**, and the bot silently stops creating
   events every week. `calendar.events` is a *sensitive* scope, so an unverified published app shows a "Google
   hasn't verified this app" warning once (*Advanced → Go to app*) and is capped at 100 users — neither matters
   for personal use, and **no verification submission is required**.
4. Create an **OAuth client ID** of type *Web application*, with the authorized redirect URI
   `https://<your-app>.vercel.app/api/auth/google/callback`.

### 4. Gemini

Get a key from [AI Studio](https://aistudio.google.com/apikey). The free tier is enough.

### 5. Deploy

Push to GitHub, import the repo in Vercel, and set every variable from
[`.env.local.example`](.env.local.example). Then:

1. **Connect the calendar** — open `https://<your-app>.vercel.app/api/auth/google?key=<SETUP_SECRET>` once and
   accept the consent screen. The refresh token is stored in Supabase.
2. **Register the webhook** — in the Meta app under WhatsApp → Configuration, set the callback URL to
   `https://<your-app>.vercel.app/api/whatsapp/webhook`, the verify token to your `WHATSAPP_VERIFY_TOKEN`, and
   subscribe to the **`messages`** field.
3. **Check it** — `https://<your-app>.vercel.app/api/health` should return `ok: true`. The home page shows the
   same status in readable form.

Then message the bot from an allowlisted number.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill it in
npm run dev
```

`npm run test:parse` exercises the timezone and validation rules with no network access, and additionally runs
real Hebrew/English phrases through Gemini when `GEMINI_API_KEY` is set. Run it after touching anything in
`lib/time.ts` or `lib/gemini.ts` — it is the cheapest way to catch a date bug.

To receive real webhooks locally, expose port 3000 with a tunnel (`ngrok http 3000`) and point the Meta webhook
at the tunnel URL.

### Proving the deduplication works

```bash
WHATSAPP_APP_SECRET=… ALLOWED_WA_NUMBERS=… \
  npm run replay -- https://<your-app>.vercel.app/api/whatsapp/webhook "lunch with Sarah tomorrow 1pm"
```

This signs a synthetic message the way Meta does and delivers it **twice**, then tries a tampered body. Expect
`200`, `200`, `401` — and then check that only one row came back:

```sql
select outcome, count(*) from event_log where wamid = '<printed id>' group by outcome;
```

Two `created` rows would mean a redelivery could double-book you.

## Design notes

**The model never does offset arithmetic.** It emits naive local datetimes (`2026-08-12T15:00:00`) and the
timezone is attached separately when the event is built, so Google resolves the offset and DST itself. The
conversions needed for validation live in `lib/time.ts`, where they are deterministic and tested.

**The model is treated as untrusted.** `validateParse` in `lib/gemini.ts` rejects starts in the past, starts
more than two years out (the classic year slip), end-before-start, malformed dates that `Date.UTC` would
silently roll over, filler titles like "Meeting", and attendee entries that are names rather than email
addresses. Anything rejected is demoted to a follow-up question rather than written to the calendar.

**Failures speak up.** Work in `after()` is never retried by Meta, so an error replies to you in WhatsApp
instead of disappearing. Every message and its outcome is recorded in `event_log` — worth having precisely
because there is no undo.

## Limitations

- Recurring events, editing and deleting are not supported — the bot only creates.
- PDF and document attachments are ignored.
- Meta's test number can only exchange messages with up to 5 pre-verified recipients. Moving to a real business
  number requires verification but **no code changes**, only new environment values.
