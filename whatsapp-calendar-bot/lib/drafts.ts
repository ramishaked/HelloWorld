import { createAdminClient } from '@/lib/supabase-admin'
import type { MeetingDraft, ParsedMeeting } from '@/lib/types'

function ttlMinutes(): number {
  const parsed = Number(process.env.DRAFT_TTL_MINUTES)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30
}

/**
 * The half-finished appointment this sender is currently being asked about.
 *
 * Drafts expire so that answering "3pm" tomorrow doesn't get merged into a
 * question the user has long forgotten; past the TTL the message is treated as
 * a fresh request instead.
 */
export async function getDraft(waFrom: string): Promise<MeetingDraft | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pending_drafts')
    .select('draft, updated_at')
    .eq('wa_from', waFrom)
    .maybeSingle()

  if (error) throw new Error(`Failed to read draft: ${error.message}`)
  if (!data) return null

  const ageMinutes = (Date.now() - new Date(data.updated_at as string).getTime()) / 60000
  if (ageMinutes > ttlMinutes()) {
    await clearDraft(waFrom)
    return null
  }

  return data.draft as MeetingDraft
}

export async function saveDraft(waFrom: string, draft: MeetingDraft, question: string | null): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('pending_drafts').upsert(
    {
      wa_from: waFrom,
      draft,
      question,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'wa_from' }
  )

  if (error) throw new Error(`Failed to save draft: ${error.message}`)
}

export async function clearDraft(waFrom: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('pending_drafts').delete().eq('wa_from', waFrom)
  if (error) throw new Error(`Failed to clear draft: ${error.message}`)
}

/**
 * Fold a fresh parse into the running draft.
 *
 * The model already receives the previous draft and is told to re-emit every
 * field, but it can still drop one on a terse follow-up ("3pm"). Falling back to
 * the stored value keeps a subject the user gave two messages ago from
 * evaporating.
 */
export function mergeDraft(
  parsed: ParsedMeeting,
  existing: MeetingDraft | null,
  newText: string | null
): MeetingDraft {
  const transcript = [...(existing?.transcript ?? [])]
  if (newText && newText.trim()) transcript.push(newText.trim())

  return {
    title: parsed.title ?? existing?.title ?? null,
    startLocal: parsed.startLocal ?? existing?.startLocal ?? null,
    endLocal: parsed.endLocal ?? existing?.endLocal ?? null,
    allDay: parsed.allDay || (existing?.allDay ?? false),
    location: parsed.location ?? existing?.location ?? null,
    attendees: parsed.attendees.length > 0 ? parsed.attendees : (existing?.attendees ?? []),
    description: parsed.description ?? existing?.description ?? null,
    language: parsed.language,
    transcript: transcript.slice(-10),
  }
}

/** A draft is complete once it has the two things worth stopping to ask about. */
export function draftToMeeting(draft: MeetingDraft): ParsedMeeting {
  return {
    intent: 'create_event',
    title: draft.title,
    startLocal: draft.startLocal,
    endLocal: draft.endLocal,
    allDay: draft.allDay,
    location: draft.location,
    attendees: draft.attendees,
    description: draft.description,
    language: draft.language,
    missing: [
      ...(draft.title ? [] : (['title'] as const)),
      ...(draft.startLocal ? [] : (['start'] as const)),
    ],
    question: null,
  }
}
