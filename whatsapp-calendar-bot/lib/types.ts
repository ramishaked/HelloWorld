export type InputKind = 'text' | 'image' | 'audio'

export type Language = 'he' | 'en'

export type Intent = 'create_event' | 'cancel' | 'unclear'

/** The only fields worth stopping to ask about; everything else takes a default. */
export type MissingField = 'title' | 'start'

/** Raw, unvalidated shape returned by the model. */
export type RawParse = {
  intent: Intent
  title: string
  start_local: string
  end_local: string
  all_day: boolean
  location: string
  attendees: string[]
  description: string
  language: Language
  missing: string[]
  question: string
}

/** A parse that has been through server-side validation. */
export type ParsedMeeting = {
  intent: Intent
  title: string | null
  /** Naive local datetime, e.g. "2026-08-12T15:00:00". Timezone applied at event-build time. */
  startLocal: string | null
  endLocal: string | null
  allDay: boolean
  location: string | null
  attendees: string[]
  description: string | null
  language: Language
  missing: MissingField[]
  question: string | null
}

/** What gets persisted between turns while waiting for missing information. */
export type MeetingDraft = {
  title: string | null
  startLocal: string | null
  endLocal: string | null
  allDay: boolean
  location: string | null
  attendees: string[]
  description: string | null
  language: Language
  /** Original message text(s), so the model keeps full context on follow-ups. */
  transcript: string[]
}

export type CreatedEvent = {
  id: string
  htmlLink: string | null
}
