import { createAdminClient } from '@/lib/supabase-admin'
import type { CreatedEvent, ParsedMeeting } from '@/lib/types'

// Raw fetch against two Google endpoints rather than the `googleapis` package,
// which is enormous (hundreds of MB installed) for what amounts to a token
// refresh and a single event insert.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * `calendar.events` is the narrowest scope that can create events. It is
 * classified by Google as a *sensitive* scope, which is why the consent screen
 * has to be published rather than left in Testing — see the README.
 */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Google OAuth environment variables. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.'
    )
  }
  return { clientId, clientSecret, redirectUri }
}

export function buildConsentUrl(state: string): string {
  const { clientId, redirectUri } = googleOAuthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    // `offline` is what yields a refresh token at all; `consent` forces Google to
    // re-issue one even if this account has already authorised the app before,
    // which it otherwise silently omits on repeat consents.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }> {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig()

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const data = (await res.json()) as TokenResponse
  if (!res.ok || data.error) {
    throw new Error(`Google token exchange failed: ${data.error_description || data.error || res.status}`)
  }
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and try again.'
    )
  }
  return { refreshToken: data.refresh_token }
}

export async function storeRefreshToken(refreshToken: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('google_tokens')
    .upsert({ id: 1, refresh_token: refreshToken, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) throw new Error(`Failed to store Google refresh token: ${error.message}`)
}

export async function getStoredRefreshToken(): Promise<string | null> {
  // An env var wins when present, so the bot can run without ever writing the
  // token to the database if that is preferred.
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN

  const admin = createAdminClient()
  const { data, error } = await admin.from('google_tokens').select('refresh_token').eq('id', 1).maybeSingle()

  if (error) throw new Error(`Failed to read Google refresh token: ${error.message}`)
  return data?.refresh_token ?? null
}

// Access tokens last an hour. Cache in module scope so a warm serverless
// instance handling a back-and-forth conversation doesn't re-mint one per turn.
let cachedAccessToken: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token
  }

  const refreshToken = await getStoredRefreshToken()
  if (!refreshToken) {
    throw new Error('Google Calendar is not connected yet. Visit /api/auth/google to authorise it.')
  }

  const { clientId, clientSecret } = googleOAuthConfig()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const data = (await res.json()) as TokenResponse
  if (!res.ok || !data.access_token) {
    // `invalid_grant` here almost always means the consent screen was left in
    // "Testing", where Google revokes refresh tokens after 7 days.
    const detail = data.error_description || data.error || `HTTP ${res.status}`
    throw new Error(
      `Google token refresh failed: ${detail}. If this says invalid_grant, re-authorise at /api/auth/google ` +
        `and make sure the OAuth consent screen is published ("In production"), not left in Testing.`
    )
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return cachedAccessToken.token
}

type GoogleEventResponse = {
  id?: string
  htmlLink?: string
  error?: { message?: string }
}

/** ISO date (YYYY-MM-DD) from a naive local datetime, for all-day events. */
function dateOnly(naive: string): string {
  return naive.slice(0, 10)
}

export async function createCalendarEvent(meeting: ParsedMeeting, timeZone: string): Promise<CreatedEvent> {
  if (!meeting.title || !meeting.startLocal || !meeting.endLocal) {
    throw new Error('createCalendarEvent requires a title, start and end.')
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
  const accessToken = await getAccessToken()

  // Naive local datetime plus an explicit timeZone: Google resolves the UTC
  // offset itself, so DST transitions never have to be reasoned about here.
  const body: Record<string, unknown> = {
    summary: meeting.title,
    start: meeting.allDay
      ? { date: dateOnly(meeting.startLocal) }
      : { dateTime: meeting.startLocal, timeZone },
    end: meeting.allDay ? { date: dateOnly(meeting.endLocal) } : { dateTime: meeting.endLocal, timeZone },
  }

  if (meeting.location) body.location = meeting.location
  if (meeting.description) body.description = meeting.description
  if (meeting.attendees.length > 0) body.attendees = meeting.attendees.map((email) => ({ email }))

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = (await res.json()) as GoogleEventResponse
  if (!res.ok || !data.id) {
    throw new Error(`Google Calendar rejected the event: ${data.error?.message || `HTTP ${res.status}`}`)
  }

  return { id: data.id, htmlLink: data.htmlLink ?? null }
}

/** Cheap liveness probe for /api/health — proves the stored refresh token still works. */
export async function checkCalendarAccess(): Promise<{ ok: boolean; detail: string }> {
  try {
    const token = await getAccessToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
    const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, detail: `Calendar lookup returned HTTP ${res.status}` }
    const data = (await res.json()) as { summary?: string; id?: string }
    return { ok: true, detail: `Connected to "${data.summary ?? data.id ?? calendarId}"` }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}
