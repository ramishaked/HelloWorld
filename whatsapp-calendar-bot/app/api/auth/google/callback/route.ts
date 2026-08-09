import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { exchangeCodeForTokens, storeRefreshToken } from '@/lib/google-calendar'
import { STATE_COOKIE } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(new URL(`/?connected=0&reason=${encodeURIComponent(oauthError)}`, url.origin))
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state.' }, { status: 400 })
  }

  const jar = await cookies()
  const expectedState = jar.get(STATE_COOKIE)?.value
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: 'State mismatch — restart the flow at /api/auth/google.' }, { status: 400 })
  }
  jar.delete(STATE_COOKIE)

  try {
    const { refreshToken } = await exchangeCodeForTokens(code)
    await storeRefreshToken(refreshToken)
    return NextResponse.redirect(new URL('/?connected=1', url.origin))
  } catch (err) {
    return NextResponse.redirect(
      new URL(`/?connected=0&reason=${encodeURIComponent((err as Error).message)}`, url.origin)
    )
  }
}
