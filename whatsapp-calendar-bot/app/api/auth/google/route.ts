import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildConsentUrl } from '@/lib/google-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const STATE_COOKIE = 'gcal_oauth_state'

/**
 * Starts the one-time Google consent flow.
 *
 * Guarded by SETUP_SECRET: the callback writes whatever refresh token comes
 * back, so without a guard anyone who found this URL could complete the flow
 * with their own Google account and quietly redirect every future appointment
 * into their calendar.
 */
export async function GET(request: Request) {
  const setupSecret = process.env.SETUP_SECRET
  if (!setupSecret) {
    return NextResponse.json(
      { error: 'SETUP_SECRET is not configured. Set it before running the Google connect flow.' },
      { status: 500 }
    )
  }

  const url = new URL(request.url)
  if (url.searchParams.get('key') !== setupSecret) {
    return NextResponse.json({ error: 'Unauthorized. Append ?key=<SETUP_SECRET>.' }, { status: 401 })
  }

  const state = crypto.randomUUID()

  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(buildConsentUrl(state))
}
