// Timezone helpers.
//
// The parser emits *naive* local datetimes ("2026-08-12T15:00:00") rather than
// offset-aware ones, and the timezone is attached separately when the Google
// Calendar event is built. That deliberately keeps the model out of the offset
// and DST business, which is the single most common source of "the meeting is
// an hour off" bugs — Google accepts `{ dateTime, timeZone }` and resolves the
// offset itself.
//
// Validation still needs a real instant, so `zonedToUtc` does the conversion
// here, in code, where DST transitions can be handled deterministically.

export function defaultTimeZone(): string {
  return process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
}

/**
 * Minutes that `timeZone` is ahead of UTC at the given instant.
 * Positive east of Greenwich (Asia/Jerusalem is +180, or +240 in summer).
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const at: Record<string, string> = {}
  for (const part of parts) at[part.type] = part.value

  // Intl can render midnight as hour "24" in some environments.
  const hour = Number(at.hour) % 24

  const wallClockAsUtc = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    hour,
    Number(at.minute),
    Number(at.second)
  )

  return (wallClockAsUtc - instant.getTime()) / 60000
}

/**
 * Convert a naive local datetime ("2026-08-12T15:00:00") in `timeZone` to the
 * UTC instant it refers to. Returns null if the string isn't a valid datetime.
 *
 * Two passes: the first guess uses the offset in effect at the *approximate*
 * instant, the second re-reads the offset at the corrected instant so that
 * times near a DST transition land on the right side of the jump.
 */
export function zonedToUtc(naive: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(naive.trim())
  if (!match) return null

  const [, y, mo, d, h, mi, s] = match
  const asIfUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0))
  if (Number.isNaN(asIfUtc)) return null

  // Date.UTC silently rolls out-of-range components over: month 13 becomes
  // January of the next year, 31 April becomes 1 May, hour 99 becomes four days
  // later. That would quietly turn a malformed model response into a
  // plausible-looking date on the wrong day, which is precisely the failure this
  // validation exists to catch. Round-trip the components and reject mismatches.
  const roundTrip = new Date(asIfUtc)
  const componentsSurvived =
    roundTrip.getUTCFullYear() === Number(y) &&
    roundTrip.getUTCMonth() === Number(mo) - 1 &&
    roundTrip.getUTCDate() === Number(d) &&
    roundTrip.getUTCHours() === Number(h) &&
    roundTrip.getUTCMinutes() === Number(mi)
  if (!componentsSurvived) return null

  const firstOffset = offsetMinutesAt(new Date(asIfUtc), timeZone)
  let instant = new Date(asIfUtc - firstOffset * 60000)

  const secondOffset = offsetMinutesAt(instant, timeZone)
  if (secondOffset !== firstOffset) {
    instant = new Date(asIfUtc - secondOffset * 60000)
  }

  return Number.isNaN(instant.getTime()) ? null : instant
}

/** Naive local datetime string for an instant, e.g. "2026-08-12T15:00:00". */
export function utcToZonedNaive(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const at: Record<string, string> = {}
  for (const part of parts) at[part.type] = part.value
  const hour = String(Number(at.hour) % 24).padStart(2, '0')

  return `${at.year}-${at.month}-${at.day}T${hour}:${at.minute}:${at.second}`
}

/** Add minutes to a naive local datetime, going through the real instant so DST is respected. */
export function addMinutesNaive(naive: string, minutes: number, timeZone: string): string | null {
  const instant = zonedToUtc(naive, timeZone)
  if (!instant) return null
  return utcToZonedNaive(new Date(instant.getTime() + minutes * 60000), timeZone)
}

/**
 * The "you are here" line handed to the model. Relative expressions like
 * "tomorrow", "next Thursday" or "מחר" are meaningless without it.
 */
export function nowContext(timeZone: string): { naive: string; human: string } {
  const now = new Date()
  const naive = utcToZonedNaive(now, timeZone)

  const human = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)

  return { naive, human: `${human} (${timeZone})` }
}

/** Human-readable event time for the WhatsApp confirmation reply. */
export function formatForReply(
  startNaive: string,
  endNaive: string,
  timeZone: string,
  locale: 'he' | 'en',
  allDay: boolean
): string {
  const start = zonedToUtc(startNaive, timeZone)
  const end = zonedToUtc(endNaive, timeZone)
  if (!start) return startNaive

  const tag = locale === 'he' ? 'he-IL' : 'en-GB'

  const day = new Intl.DateTimeFormat(tag, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(start)

  if (allDay) return day

  const time = (d: Date) =>
    new Intl.DateTimeFormat(tag, { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)

  return end ? `${day}, ${time(start)}–${time(end)}` : `${day}, ${time(start)}`
}
