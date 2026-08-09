import { checkCalendarAccess } from '@/lib/google-calendar'
import { defaultTimeZone, nowContext } from '@/lib/time'

export const dynamic = 'force-dynamic'

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/10 py-3 last:border-0">
      <span aria-hidden className={ok ? 'text-emerald-400' : 'text-amber-400'}>
        {ok ? '●' : '○'}
      </span>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-sm text-white/60">{detail}</div>
      </div>
    </div>
  )
}

export default async function Page() {
  const timeZone = defaultTimeZone()

  const envMissing = [
    'WHATSAPP_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_PHONE_NUMBER_ID',
    'ALLOWED_WA_NUMBERS',
    'GEMINI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ].filter((name) => !process.env[name])

  const calendar = await checkCalendarAccess()

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">WhatsApp → Calendar</h1>
      <p className="mt-2 text-white/60">
        Message the bot in Hebrew or English and the appointment lands in Google Calendar.
      </p>

      <section className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] px-5">
        <Row
          label="Configuration"
          ok={envMissing.length === 0}
          detail={envMissing.length === 0 ? 'All required variables set' : `Missing: ${envMissing.join(', ')}`}
        />
        <Row label="Google Calendar" ok={calendar.ok} detail={calendar.detail} />
        <Row label="Timezone" ok detail={`${timeZone} — ${nowContext(timeZone).human}`} />
      </section>

      {!calendar.ok && (
        <p className="mt-6 text-sm text-white/60">
          Not connected yet? Open <code className="text-white/80">/api/auth/google?key=&lt;SETUP_SECRET&gt;</code> once
          to authorise the calendar.
        </p>
      )}

      <p className="mt-10 text-sm text-white/40">
        Full diagnostics at <code>/api/health</code>.
      </p>
    </main>
  )
}
