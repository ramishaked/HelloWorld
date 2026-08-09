import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { checkCalendarAccess } from '@/lib/google-calendar'
import { defaultTimeZone, nowContext } from '@/lib/time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUIRED_ENV = [
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'ALLOWED_WA_NUMBERS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GEMINI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SETUP_SECRET',
] as const

/**
 * One request that answers "is this thing actually going to work?" — the three
 * dependencies fail independently and mostly fail silently, so checking them
 * separately beats waiting for a WhatsApp message to come back wrong.
 */
export async function GET() {
  const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name])

  let supabase: { ok: boolean; detail: string }
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('processed_messages').select('wamid').limit(1)
    supabase = error ? { ok: false, detail: error.message } : { ok: true, detail: 'Reachable, schema present' }
  } catch (err) {
    supabase = { ok: false, detail: (err as Error).message }
  }

  const calendar = missingEnv.length > 0 ? { ok: false, detail: 'Skipped — env incomplete' } : await checkCalendarAccess()

  const timeZone = defaultTimeZone()
  const ok = missingEnv.length === 0 && supabase.ok && calendar.ok

  return NextResponse.json(
    {
      ok,
      env: missingEnv.length === 0 ? { ok: true, detail: 'All required variables set' } : { ok: false, missing: missingEnv },
      supabase,
      calendar,
      time: { timeZone, now: nowContext(timeZone).human },
    },
    { status: ok ? 200 : 503 }
  )
}
