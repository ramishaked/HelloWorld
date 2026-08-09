import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { handleMessage } from '@/lib/handle-message'
import { extractMessages, isAllowedSender, verifySignature, type InboundMessage } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Parsing plus a calendar write runs in `after()`, which is bounded by the
// route's max duration rather than the response time.
export const maxDuration = 60

/**
 * Meta's subscription handshake: it calls this once when the webhook URL is
 * registered and expects the challenge echoed back verbatim.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
  }

  return new Response('Forbidden', { status: 403 })
}

/**
 * Claim messages we have not seen before, atomically.
 *
 * `ON CONFLICT DO NOTHING ... RETURNING` means the database decides the winner:
 * only genuinely new wamids come back, so a redelivery — Meta retries for up to
 * 7 days — cannot produce a second calendar event even if two deliveries land
 * concurrently on different instances.
 */
async function claimUnseen(messages: InboundMessage[]): Promise<InboundMessage[]> {
  if (messages.length === 0) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('processed_messages')
    .upsert(
      messages.map((m) => ({ wamid: m.wamid, wa_from: m.from })),
      { onConflict: 'wamid', ignoreDuplicates: true }
    )
    .select('wamid')

  if (error) throw new Error(`Failed to claim messages: ${error.message}`)

  const claimed = new Set((data ?? []).map((row) => row.wamid as string))
  return messages.filter((m) => claimed.has(m.wamid))
}

export async function POST(request: Request) {
  // The signature is computed over the exact bytes Meta sent, so the raw text
  // has to be read before anything parses it.
  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  // Status callbacks (delivered/read) come through this same webhook and
  // produce no messages, so they fall out here.
  const inbound = extractMessages(payload)
  const allowed = inbound.filter((m) => isAllowedSender(m.from))

  for (const rejected of inbound.filter((m) => !isAllowedSender(m.from))) {
    console.warn(`[webhook] ignoring message from non-allowlisted sender ${rejected.from}`)
  }

  let fresh: InboundMessage[] = []
  try {
    fresh = await claimUnseen(allowed)
  } catch (err) {
    // Failing the claim means we cannot guarantee exactly-once. Returning
    // non-200 asks Meta to redeliver, which is the safe direction: a retry that
    // claims successfully is better than a message dropped on the floor.
    console.error('[webhook]', (err as Error).message)
    return new Response('Storage unavailable', { status: 503 })
  }

  // Ack now, work later. Meta wants a fast response and retries anything slow,
  // and parsing plus a calendar write takes seconds.
  after(async () => {
    for (const message of fresh) {
      await handleMessage(message)
    }
  })

  return new Response('OK', { status: 200 })
}
