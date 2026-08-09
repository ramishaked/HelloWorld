import { createAdminClient } from '@/lib/supabase-admin'
import { createCalendarEvent } from '@/lib/google-calendar'
import { parseMeeting } from '@/lib/gemini'
import { clearDraft, draftToMeeting, getDraft, mergeDraft, saveDraft } from '@/lib/drafts'
import { reply } from '@/lib/messages'
import { defaultTimeZone, formatForReply } from '@/lib/time'
import { downloadMedia, sendText, type InboundMessage } from '@/lib/whatsapp'
import type { InputKind, Language } from '@/lib/types'

type Outcome = 'created' | 'asked' | 'cancelled' | 'ignored' | 'error'

async function logEvent(entry: {
  waFrom: string
  wamid: string
  inputKind: InputKind
  inputText: string | null
  parsed?: unknown
  outcome: Outcome
  googleEventId?: string | null
  googleEventLink?: string | null
  error?: string | null
}) {
  try {
    const admin = createAdminClient()
    await admin.from('event_log').insert({
      wa_from: entry.waFrom,
      wamid: entry.wamid,
      input_kind: entry.inputKind,
      input_text: entry.inputText,
      parsed: entry.parsed ?? null,
      outcome: entry.outcome,
      google_event_id: entry.googleEventId ?? null,
      google_event_link: entry.googleEventLink ?? null,
      error: entry.error ?? null,
    })
  } catch (err) {
    // Never let the audit trail take down the actual work.
    console.error('[event_log] failed to write:', (err as Error).message)
  }
}

async function safeSend(to: string, body: string) {
  try {
    await sendText(to, body)
  } catch (err) {
    console.error('[whatsapp] failed to send reply:', (err as Error).message)
  }
}

/**
 * Everything that happens after the webhook has already returned 200.
 *
 * Runs inside `after()`, so nothing here blocks Meta's delivery — but equally,
 * nothing here gets retried. Failures therefore have to surface to the user as
 * a WhatsApp reply rather than relying on a redelivery that will never come.
 */
export async function handleMessage(message: InboundMessage): Promise<void> {
  const timeZone = defaultTimeZone()
  let language: Language = 'en'

  try {
    const draft = await getDraft(message.from)
    if (draft) language = draft.language

    if (message.unsupported) {
      await safeSend(message.from, reply.unsupported(language))
      await logEvent({
        waFrom: message.from,
        wamid: message.wamid,
        inputKind: 'text',
        inputText: null,
        outcome: 'ignored',
      })
      return
    }

    // Media arrives by reference; fetch the bytes before the model can see them.
    let imageBase64: string | undefined
    let imageMimeType: string | undefined
    let audioBase64: string | undefined
    let audioMimeType: string | undefined

    if (message.mediaId && message.kind === 'image') {
      const media = await downloadMedia(message.mediaId)
      imageBase64 = media.base64
      imageMimeType = media.mimeType
    } else if (message.mediaId && message.kind === 'audio') {
      const media = await downloadMedia(message.mediaId)
      audioBase64 = media.base64
      // WhatsApp voice notes are OGG/Opus, which Gemini accepts directly.
      audioMimeType = media.mimeType
    }

    const parsed = await parseMeeting({
      text: message.text ?? undefined,
      imageBase64,
      imageMimeType,
      audioBase64,
      audioMimeType,
      draft,
      timeZone,
    })
    language = parsed.language

    if (parsed.intent === 'cancel') {
      if (draft) await clearDraft(message.from)
      await safeSend(message.from, draft ? reply.cancelled(language) : reply.nothingToCancel(language))
      await logEvent({
        waFrom: message.from,
        wamid: message.wamid,
        inputKind: message.kind,
        inputText: message.text,
        parsed,
        outcome: 'cancelled',
      })
      return
    }

    // With no draft in play, an unschedulable message is just chatter. With a
    // draft open it is far more likely to be a clumsy answer to the question
    // that was asked, so it still goes through the merge path.
    if (parsed.intent === 'unclear' && !draft) {
      await safeSend(message.from, reply.unclear(language))
      await logEvent({
        waFrom: message.from,
        wamid: message.wamid,
        inputKind: message.kind,
        inputText: message.text,
        parsed,
        outcome: 'ignored',
      })
      return
    }

    const merged = mergeDraft(parsed, draft, message.text)
    const meeting = draftToMeeting(merged)

    if (meeting.missing.length > 0) {
      const question = parsed.question ?? reply.askFallback(language, meeting.missing)
      await saveDraft(message.from, merged, question)
      await safeSend(message.from, question)
      await logEvent({
        waFrom: message.from,
        wamid: message.wamid,
        inputKind: message.kind,
        inputText: message.text,
        parsed: merged,
        outcome: 'asked',
      })
      return
    }

    const event = await createCalendarEvent(meeting, timeZone)
    await clearDraft(message.from)

    const when = formatForReply(meeting.startLocal!, meeting.endLocal!, timeZone, language, meeting.allDay)
    await safeSend(
      message.from,
      reply.created(language, meeting.title!, when, meeting.location, event.htmlLink)
    )

    await logEvent({
      waFrom: message.from,
      wamid: message.wamid,
      inputKind: message.kind,
      inputText: message.text,
      parsed: merged,
      outcome: 'created',
      googleEventId: event.id,
      googleEventLink: event.htmlLink,
    })
  } catch (err) {
    const detail = (err as Error).message
    console.error('[handle-message]', detail)

    const notConnected = detail.includes('not connected') || detail.includes('invalid_grant')
    await safeSend(message.from, notConnected ? reply.notConnected(language) : reply.failed(language))

    await logEvent({
      waFrom: message.from,
      wamid: message.wamid,
      inputKind: message.kind,
      inputText: message.text,
      outcome: 'error',
      error: detail.slice(0, 1000),
    })
  }
}
