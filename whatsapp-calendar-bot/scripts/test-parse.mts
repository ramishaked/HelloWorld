/**
 * Offline parser harness.
 *
 * Part A exercises the validation and timezone rules with no network access, so
 * the logic that decides "is this date real?" is verifiable without a Gemini key
 * or any Meta/Google setup. This is where date bugs actually live.
 *
 * Part B runs real phrases through Gemini, and is skipped unless GEMINI_API_KEY
 * is present.
 *
 *   npm run test:parse
 */
import { validateParse, DEFAULT_DURATION_MINUTES, parseMeeting } from '@/lib/gemini'
import { zonedToUtc, utcToZonedNaive, addMinutesNaive, formatForReply } from '@/lib/time'
import { extractMessages, isAllowedSender, normalizePhone, verifySignature } from '@/lib/whatsapp'
import crypto from 'node:crypto'
import type { RawParse } from '@/lib/types'

const TZ = 'Asia/Jerusalem'

let passed = 0
let failed = 0

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      expected ${e}\n      actual   ${a}`)
  }
}

function raw(over: Partial<RawParse>): Partial<RawParse> {
  return {
    intent: 'create_event',
    title: 'Budget review',
    start_local: '2026-08-12T15:00:00',
    end_local: '',
    all_day: false,
    location: '',
    attendees: [],
    description: '',
    language: 'en',
    missing: [],
    question: '',
    ...over,
  }
}

// A fixed "now" so these assertions never drift with the wall clock.
const NOW = new Date('2026-08-09T09:00:00Z') // 12:00 in Jerusalem (UTC+3, summer)

console.log('\n\x1b[1mA. Timezone math (no network)\x1b[0m')
{
  check('summer date resolves at UTC+03:00', zonedToUtc('2026-08-12T15:00:00', TZ)?.toISOString(), '2026-08-12T12:00:00.000Z')
  check('winter date resolves at UTC+02:00', zonedToUtc('2026-01-12T15:00:00', TZ)?.toISOString(), '2026-01-12T13:00:00.000Z')
  check('round-trips back to the same wall clock', utcToZonedNaive(zonedToUtc('2026-08-12T15:00:00', TZ)!, TZ), '2026-08-12T15:00:00')
  check('adding 60 minutes crosses the hour', addMinutesNaive('2026-08-12T15:30:00', 60, TZ), '2026-08-12T16:30:00')
  check('adding minutes rolls the date over midnight', addMinutesNaive('2026-08-12T23:30:00', 60, TZ), '2026-08-13T00:30:00')
  check('garbage input is rejected, not coerced', zonedToUtc('not a date', TZ), null)
}

console.log('\n\x1b[1mB. Validation rules\x1b[0m')
{
  const ok = validateParse(raw({}), TZ, NOW)
  check('a complete parse has nothing missing', ok.missing, [])
  check('missing end defaults to +60 minutes', ok.endLocal, '2026-08-12T16:00:00')
  check('default duration constant is 60', DEFAULT_DURATION_MINUTES, 60)

  const past = validateParse(raw({ start_local: '2020-01-01T15:00:00' }), TZ, NOW)
  check('a start in the past is demoted to missing', past.missing, ['start'])
  check('a rejected start is not passed through', past.startLocal, null)

  const yearSlip = validateParse(raw({ start_local: '2031-08-12T15:00:00' }), TZ, NOW)
  check('a >2y future start (year slip) is rejected', yearSlip.missing, ['start'])

  const backwards = validateParse(raw({ start_local: '2026-08-12T15:00:00', end_local: '2026-08-12T14:00:00' }), TZ, NOW)
  check('end before start is corrected to +60', backwards.endLocal, '2026-08-12T16:00:00')

  const noTitle = validateParse(raw({ title: '' }), TZ, NOW)
  check('an empty title is reported missing', noTitle.missing, ['title'])

  const filler = validateParse(raw({ title: 'Meeting' }), TZ, NOW)
  check('a filler title ("Meeting") is reported missing', filler.missing, ['title'])

  const fillerHe = validateParse(raw({ title: 'פגישה' }), TZ, NOW)
  check('a filler Hebrew title ("פגישה") is reported missing', fillerHe.missing, ['title'])

  const bothMissing = validateParse(raw({ title: '', start_local: '' }), TZ, NOW)
  check('both fields can be missing at once', bothMissing.missing, ['title', 'start'])

  const attendees = validateParse(raw({ attendees: ['Dan', 'דני', 'dan@example.com', ' a@b.co '] }), TZ, NOW)
  check('names are dropped, emails kept and trimmed', attendees.attendees, ['dan@example.com', 'a@b.co'])

  const badDate = validateParse(raw({ start_local: '2026-13-45T99:00:00' }), TZ, NOW)
  check('an unparseable start is demoted to missing', badDate.missing, ['start'])

  const offsetLeak = validateParse(raw({ start_local: '2026-08-12T15:00:00+03:00' }), TZ, NOW)
  check('a stray offset is tolerated and stripped', offsetLeak.startLocal, '2026-08-12T15:00:00')

  const cancel = validateParse(raw({ intent: 'cancel' }), TZ, NOW)
  check('cancel intent survives validation', cancel.intent, 'cancel')

  const he = validateParse(raw({ language: 'he', question: 'מתי לקבוע?' }), TZ, NOW)
  check('Hebrew language flag is preserved', he.language, 'he')
  check('the question text is preserved', he.question, 'מתי לקבוע?')
}

console.log('\n\x1b[1mC. Reply formatting\x1b[0m')
{
  check(
    'English reply reads as a date range',
    formatForReply('2026-08-12T15:00:00', '2026-08-12T16:00:00', TZ, 'en', false),
    'Wed, 12 Aug 2026, 15:00–16:00'
  )
  check(
    'all-day events omit the time',
    formatForReply('2026-08-12T00:00:00', '2026-08-13T00:00:00', TZ, 'en', true),
    'Wed, 12 Aug 2026'
  )
}

console.log('\n\x1b[1mD. Webhook security and payload parsing\x1b[0m')
{
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret'
  const body = JSON.stringify({ hello: 'world' })
  const good = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(body, 'utf8').digest('hex')

  check('a correct signature is accepted', verifySignature(body, good), true)
  check('a tampered body is rejected', verifySignature(body + ' ', good), false)
  check('a wrong signature is rejected', verifySignature(body, 'sha256=' + 'a'.repeat(64)), false)
  check('a missing signature header is rejected', verifySignature(body, null), false)
  check('a short signature does not throw', verifySignature(body, 'sha256=abc'), false)

  process.env.ALLOWED_WA_NUMBERS = '+972-50 123 4567, 447700900000'
  check('an allowlisted number matches despite formatting', isAllowedSender('972501234567'), true)
  check('a second allowlisted number matches', isAllowedSender('447700900000'), true)
  check('a stranger is rejected', isAllowedSender('12125550000'), false)
  check('phone normalisation strips punctuation', normalizePhone('+972-50 123 4567'), '972501234567')

  const previous = process.env.ALLOWED_WA_NUMBERS
  delete process.env.ALLOWED_WA_NUMBERS
  check('an unset allowlist denies everyone', isAllowedSender('972501234567'), false)
  process.env.ALLOWED_WA_NUMBERS = previous

  const textPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
              contacts: [{ profile: { name: 'Rami' }, wa_id: '972501234567' }],
              messages: [
                {
                  from: '972501234567',
                  id: 'wamid.HBgLOTcyNTAxMjM0NTY3',
                  timestamp: '1754730000',
                  text: { body: 'meeting with Dan tomorrow 3pm' },
                  type: 'text',
                },
              ],
            },
          },
        ],
      },
    ],
  }

  const extracted = extractMessages(textPayload)
  check('a text message is extracted', extracted.length, 1)
  check('the message id is carried through', extracted[0]?.wamid, 'wamid.HBgLOTcyNTAxMjM0NTY3')
  check('the sender is carried through', extracted[0]?.from, '972501234567')
  check('the text body is carried through', extracted[0]?.text, 'meeting with Dan tomorrow 3pm')
  check('the kind is text', extracted[0]?.kind, 'text')

  const statusPayload = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: { messaging_product: 'whatsapp', statuses: [{ id: 'wamid.X', status: 'delivered' }] },
          },
        ],
      },
    ],
  }
  check('delivery receipts produce no messages', extractMessages(statusPayload).length, 0)

  const imagePayload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '972501234567',
                  id: 'wamid.IMG',
                  type: 'image',
                  image: { id: 'media-123', mime_type: 'image/jpeg', caption: 'invite' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
  const img = extractMessages(imagePayload)[0]
  check('an image message yields kind=image', img?.kind, 'image')
  check('the media id is captured', img?.mediaId, 'media-123')
  check('the caption becomes the text', img?.text, 'invite')

  const voicePayload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { from: '972501234567', id: 'wamid.AUD', type: 'audio', audio: { id: 'media-456', mime_type: 'audio/ogg' } },
              ],
            },
          },
        ],
      },
    ],
  }
  const aud = extractMessages(voicePayload)[0]
  check('a voice note yields kind=audio', aud?.kind, 'audio')
  check('the audio media id is captured', aud?.mediaId, 'media-456')

  const docPayload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from: '972501234567', id: 'wamid.DOC', type: 'document', document: { id: 'd1' } }],
            },
          },
        ],
      },
    ],
  }
  check('an unsupported type is flagged, not dropped', extractMessages(docPayload)[0]?.unsupported, true)

  check('an empty payload is handled', extractMessages({}).length, 0)
  check('a malformed payload does not throw', extractMessages({ entry: [{}] }).length, 0)
}

console.log('\n\x1b[1mE. Live Gemini parses\x1b[0m')
if (!process.env.GEMINI_API_KEY) {
  console.log('  \x1b[33m⊘ skipped\x1b[0m — set GEMINI_API_KEY to run these')
} else {
  const cases: { label: string; text: string; expectMissing: string[] }[] = [
    { label: 'EN full',            text: 'budget review with Dan next Thursday 3pm at the office', expectMissing: [] },
    { label: 'EN relative',        text: 'call with the design team tomorrow at 10:30',            expectMissing: [] },
    { label: 'EN no time',         text: 'meeting with Dan',                                       expectMissing: ['start'] },
    { label: 'EN no subject',      text: 'tomorrow 4pm',                                           expectMissing: ['title'] },
    { label: 'EN range',           text: 'workshop on Monday 2-4pm',                               expectMissing: [] },
    { label: 'EN in an hour',      text: 'quick sync in an hour',                                  expectMissing: [] },
    { label: 'HE full',            text: 'פגישה עם דני מחר ב-15:00 במשרד',                          expectMissing: [] },
    { label: 'HE relative',        text: 'תור לרופא ביום ראשון הבא בעשר בבוקר',                     expectMissing: [] },
    { label: 'HE no time',         text: 'פגישה עם רונית',                                          expectMissing: ['start'] },
    { label: 'HE no subject',      text: 'מחר ב-4',                                                expectMissing: ['title'] },
    { label: 'HE evening',         text: 'ארוחת ערב עם ההורים הערב ב-8',                            expectMissing: [] },
    { label: 'cancel EN',          text: 'never mind',                                             expectMissing: [] },
    { label: 'cancel HE',          text: 'ביטול',                                                  expectMissing: [] },
    { label: 'nonsense',           text: 'asdfgh qwerty',                                          expectMissing: [] },
  ]

  for (const c of cases) {
    try {
      const parsed = await parseMeeting({ text: c.text, timeZone: TZ })
      const summary =
        parsed.intent !== 'create_event'
          ? `intent=${parsed.intent}`
          : `${parsed.title ?? '—'} @ ${parsed.startLocal ?? '—'}→${parsed.endLocal ?? '—'}` +
            (parsed.location ? ` [${parsed.location}]` : '') +
            (parsed.missing.length ? `  missing=${parsed.missing.join(',')} q="${parsed.question}"` : '')
      console.log(`  \x1b[36m${c.label.padEnd(14)}\x1b[0m ${c.text}\n      → ${summary}`)
    } catch (err) {
      failed++
      console.log(`  \x1b[31m✗ ${c.label}\x1b[0m threw: ${(err as Error).message}`)
    }
  }
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`)
process.exit(failed > 0 ? 1 : 0)
