import { GoogleGenAI, Type, createPartFromBase64, type Part } from '@google/genai'
import type { Language, MeetingDraft, MissingField, ParsedMeeting, RawParse } from '@/lib/types'
import { addMinutesNaive, nowContext, zonedToUtc } from '@/lib/time'

// Use the "-latest" alias so the model doesn't 404 when Google retires a pinned
// version. It's multimodal (image OCR and audio), light on the free tier, and
// handles Hebrew and English natively. Note: the model behind the alias can
// change, so avoid model-version-specific request params — `thinkingConfig` is
// rejected outright by some versions. GEMINI_MODEL overrides at runtime.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'

export const DEFAULT_DURATION_MINUTES = 60

/** Events further out than this are almost certainly a model year-slip, not a real plan. */
const MAX_FUTURE_DAYS = 730

/** Small grace window so "a meeting starting now" isn't rejected as past. */
const PAST_TOLERANCE_MINUTES = 5

const SYSTEM_INSTRUCTION = `You turn WhatsApp messages into calendar appointments. The user writes in Hebrew \
or English, casually, often in one short line. You receive typed text, a screenshot/photo, or a voice note.

Return ONLY the required JSON fields.

## Time
- You are given the user's current local date and time. Resolve every relative expression against it: \
"tomorrow", "מחר", "next Thursday", "יום חמישי הבא", "in an hour", "עוד שעה", "tonight", "הערב", \
"this weekend", "בשבוע הבא".
- Output "start_local" and "end_local" as NAIVE LOCAL datetimes in the format YYYY-MM-DDTHH:MM:SS.
  NEVER append "Z", "+03:00", or any other offset. The timezone is applied downstream.
- Assume the near future. A bare weekday or date means the NEXT occurrence, not one in the past.
- Bare hours are interpreted the way a person would: "3" or "ב-3" for a meeting means 15:00, not 03:00, \
unless the message clearly says morning ("בבוקר", "am", "in the morning").
- If no duration is given, set "end_local" to exactly 60 minutes after "start_local".
- Ranges ("2-4pm", "מ-2 עד 4") set both ends directly.

## Which fields may be reported as missing
"missing" may ONLY contain "title" and/or "start". Never report duration, location, attendees or \
description as missing — they take defaults.
- "start" is missing when you cannot determine BOTH a calendar date AND a time of day. A date with no \
time (e.g. "פגישה ביום חמישי") IS missing "start". The one exception is a genuine all-day item.
- "title" is missing when the message gives nothing to name the event by (e.g. the user only sent \
"מחר ב-4"). If the message names a person, topic or activity, build a title from it instead of asking — \
"lunch with Sarah" is a perfectly good title.

## question
When "missing" is non-empty, write ONE short, natural question asking only for what is missing, in the \
SAME LANGUAGE the user wrote in. Do not greet, do not explain, do not apologise. Examples:
- missing ["start"] → "מתי לקבוע את זה?" / "When should I schedule it?"
- missing ["title"] → "איך לקרוא לפגישה?" / "What should I call it?"
- missing both → "מה הנושא ומתי?" / "What's it about, and when?"
When "missing" is empty, set "question" to an empty string.

## Other fields
- "title": short and specific, no trailing punctuation. Use the user's own wording.
- "all_day": true only for things that genuinely span a day (a birthday, a holiday, "יום כיף", \
"all day offsite"). A normal meeting is never all-day.
- "location": only if stated. Empty string otherwise. Never invent one.
- "attendees": ONLY real email addresses that literally appear in the message. A name like "Dan" or \
"דני" is NOT an email — leave it out of this array and keep it in the title instead.
- "description": any leftover detail worth keeping (agenda, phone number, notes). Empty string if none.
- "language": "he" if the user wrote in Hebrew, otherwise "en".

## intent
- "cancel" when the user is calling off the pending request ("cancel", "ביטול", "בטל", "לא משנה", \
"never mind", "forget it").
- "unclear" when the message is not about scheduling anything at all.
- "create_event" otherwise — including when information is still missing.

## Prior context
If an earlier partially-filled draft is supplied, the new message is the user ANSWERING your question. \
Merge it into the draft and re-emit ALL fields, keeping the values already established. Do not drop the \
title just because the latest message only supplied a time.`

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: ['create_event', 'cancel', 'unclear'] },
    title: { type: Type.STRING },
    start_local: { type: Type.STRING },
    end_local: { type: Type.STRING },
    all_day: { type: Type.BOOLEAN },
    location: { type: Type.STRING },
    attendees: { type: Type.ARRAY, items: { type: Type.STRING } },
    description: { type: Type.STRING },
    language: { type: Type.STRING, enum: ['he', 'en'] },
    missing: { type: Type.ARRAY, items: { type: Type.STRING, enum: ['title', 'start'] } },
    question: { type: Type.STRING },
  },
  required: [
    'intent',
    'title',
    'start_local',
    'end_local',
    'all_day',
    'location',
    'attendees',
    'description',
    'language',
    'missing',
    'question',
  ],
}

let client: GoogleGenAI | null = null

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY environment variable.')
    }
    client = new GoogleGenAI({ apiKey })
  }
  return client
}

function parseRetryDelayMs(err: unknown): number | null {
  const msg = (err as { message?: string })?.message
  if (typeof msg !== 'string') return null
  const m = msg.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null
}

// The Gemini free tier has low request limits. Retry a couple of times honoring
// the API's suggested delay so a transient limit doesn't surface as a failure.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = 2
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number })?.status
      const retriable = status === 429 || status === 503 || status === 500
      if (retriable && attempt < maxRetries) {
        const waitMs = Math.min(20000, (parseRetryDelayMs(err) ?? 2500 * 2 ** attempt) + 500)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      if (status === 429) {
        throw new Error('Gemini rate limit reached — the free tier has low limits. Try again in a minute.')
      }
      throw err
    }
  }
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/** Titles that carry no information — treat as if the user hadn't given one. */
const FILLER_TITLES = new Set([
  'meeting',
  'event',
  'appointment',
  'untitled',
  'untitled event',
  'n/a',
  'none',
  'פגישה',
  'אירוע',
  'תור',
  'ללא כותרת',
])

/**
 * Validate and normalise a raw model response.
 *
 * Exported so the offline harness can exercise the rules without a live model.
 * The model is treated as untrusted here: LLMs slip on dates in predictable
 * ways (wrong year being the classic), and this bot creates events with no
 * confirmation step, so anything that doesn't survive these checks is demoted
 * to "missing" and asked about rather than silently written to the calendar.
 */
export function validateParse(raw: Partial<RawParse>, timeZone: string, now: Date = new Date()): ParsedMeeting {
  const language: Language = raw.language === 'he' ? 'he' : 'en'
  const intent = raw.intent === 'cancel' || raw.intent === 'unclear' ? raw.intent : 'create_event'
  const allDay = raw.all_day === true

  let title = isBlank(raw.title) ? null : raw.title!.trim().slice(0, 200)
  if (title && FILLER_TITLES.has(title.toLowerCase())) title = null

  let startLocal: string | null = null
  let endLocal: string | null = null

  if (!isBlank(raw.start_local)) {
    const candidate = raw.start_local!.trim()
    const instant = zonedToUtc(candidate, timeZone)

    if (instant) {
      const minutesFromNow = (instant.getTime() - now.getTime()) / 60000
      const withinWindow =
        minutesFromNow >= -PAST_TOLERANCE_MINUTES && minutesFromNow <= MAX_FUTURE_DAYS * 24 * 60

      // A start in the past or absurdly far out means the model mis-resolved the
      // relative expression. Better to ask again than to book the wrong day.
      if (withinWindow) {
        startLocal = candidate.slice(0, 19)
      }
    }
  }

  if (startLocal) {
    const startInstant = zonedToUtc(startLocal, timeZone)!
    const rawEnd = isBlank(raw.end_local) ? null : raw.end_local!.trim().slice(0, 19)
    const endInstant = rawEnd ? zonedToUtc(rawEnd, timeZone) : null

    endLocal =
      endInstant && endInstant.getTime() > startInstant.getTime()
        ? rawEnd
        : addMinutesNaive(startLocal, DEFAULT_DURATION_MINUTES, timeZone)
  }

  const missing: MissingField[] = []
  if (!title) missing.push('title')
  if (!startLocal) missing.push('start')

  const attendees = Array.isArray(raw.attendees)
    ? raw.attendees.filter((a): a is string => typeof a === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.trim())).map((a) => a.trim())
    : []

  return {
    intent,
    title,
    startLocal,
    endLocal,
    allDay,
    location: isBlank(raw.location) ? null : raw.location!.trim().slice(0, 300),
    attendees,
    description: isBlank(raw.description) ? null : raw.description!.trim().slice(0, 2000),
    language,
    missing,
    question: isBlank(raw.question) ? null : raw.question!.trim().slice(0, 300),
  }
}

export type ParseInput = {
  text?: string
  imageBase64?: string
  imageMimeType?: string
  audioBase64?: string
  audioMimeType?: string
  draft?: MeetingDraft | null
  timeZone: string
}

export async function parseMeeting(input: ParseInput): Promise<ParsedMeeting> {
  const parts: Part[] = []

  if (input.imageBase64 && input.imageMimeType) {
    parts.push(createPartFromBase64(input.imageBase64, input.imageMimeType))
  }
  if (input.audioBase64 && input.audioMimeType) {
    parts.push(createPartFromBase64(input.audioBase64, input.audioMimeType))
  }

  const { human } = nowContext(input.timeZone)
  parts.push({ text: `Current local date and time: ${human}` })

  if (input.draft) {
    parts.push({
      text:
        `Pending draft the user is answering about (merge the new message into this, keep established values):\n` +
        JSON.stringify(
          {
            title: input.draft.title,
            start_local: input.draft.startLocal,
            end_local: input.draft.endLocal,
            all_day: input.draft.allDay,
            location: input.draft.location,
            attendees: input.draft.attendees,
            description: input.draft.description,
          },
          null,
          2
        ) +
        (input.draft.transcript.length
          ? `\n\nEarlier messages in this request:\n${input.draft.transcript.map((t) => `- ${t}`).join('\n')}`
          : ''),
    })
  }

  if (input.text) {
    parts.push({ text: `New message from the user:\n${input.text}` })
  } else if (input.audioBase64) {
    parts.push({ text: 'The new message from the user is the attached voice note. Transcribe it, then apply the rules.' })
  } else if (input.imageBase64) {
    parts.push({ text: 'The new message from the user is the attached image. Read the text in it, then apply the rules.' })
  }

  if (parts.length === 0) {
    throw new Error('parseMeeting requires text, an image, or audio.')
  }

  const response = await withRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema,
      },
    })
  )

  const rawText = response.text
  if (!rawText) {
    throw new Error('Gemini returned an empty response.')
  }

  let raw: Partial<RawParse>
  try {
    raw = JSON.parse(rawText) as Partial<RawParse>
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${rawText.slice(0, 200)}`)
  }

  return validateParse(raw, input.timeZone)
}
