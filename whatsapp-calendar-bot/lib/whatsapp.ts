import crypto from 'node:crypto'
import type { InputKind } from '@/lib/types'

// Meta deprecates Graph API versions on a rolling ~2-year schedule, so this is
// overridable without a code change when the pinned one ages out.
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

export function whatsappConfig() {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID.')
  }
  return { token, phoneNumberId }
}

/** Digits only, so "+972-50 123 4567" and "972501234567" compare equal. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * The webhook URL is public and unauthenticated by design — Meta calls it. The
 * allowlist is what stops anyone who discovers the URL (or messages the number)
 * from writing events into the owner's calendar.
 */
export function isAllowedSender(from: string): boolean {
  const raw = process.env.ALLOWED_WA_NUMBERS
  if (!raw) return false

  const allowed = raw
    .split(',')
    .map((entry) => normalizePhone(entry))
    .filter(Boolean)

  return allowed.includes(normalizePhone(from))
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body.
 * Must be given the exact bytes Meta sent — re-serialising parsed JSON changes
 * key order and whitespace, and the digest no longer matches.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret || !signatureHeader) return false

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  // timingSafeEqual throws on length mismatch, so guard before comparing.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function sendText(to: string, body: string): Promise<void> {
  const { token, phoneNumberId } = whatsappConfig()

  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      // Link previews would expand the calendar URL into a large card.
      text: { preview_url: false, body: body.slice(0, 4096) },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`WhatsApp send failed (HTTP ${res.status}): ${detail.slice(0, 300)}`)
  }
}

/**
 * Media arrives by reference, not by value: the webhook carries an id, which
 * resolves to a short-lived signed URL that itself needs the bearer token.
 */
export async function downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  const { token } = whatsappConfig()

  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!metaRes.ok) {
    throw new Error(`Media lookup failed (HTTP ${metaRes.status}).`)
  }

  const meta = (await metaRes.json()) as { url?: string; mime_type?: string }
  if (!meta.url) throw new Error('Media lookup returned no URL.')

  const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!binRes.ok) {
    throw new Error(`Media download failed (HTTP ${binRes.status}).`)
  }

  const buffer = Buffer.from(await binRes.arrayBuffer())
  return {
    base64: buffer.toString('base64'),
    mimeType: meta.mime_type?.split(';')[0].trim() || 'application/octet-stream',
  }
}

export type InboundMessage = {
  wamid: string
  from: string
  kind: InputKind
  /** Text body, or the caption attached to an image. */
  text: string | null
  mediaId: string | null
  /** Message types the bot can't act on (video, document, location, …). */
  unsupported: boolean
}

type WebhookValue = {
  messages?: {
    id?: string
    from?: string
    type?: string
    text?: { body?: string }
    image?: { id?: string; caption?: string }
    audio?: { id?: string }
    voice?: { id?: string }
  }[]
  statuses?: unknown[]
}

/**
 * Flatten Meta's deeply nested envelope into the messages worth acting on.
 * Delivery/read receipts arrive through the same webhook and are ignored.
 */
export function extractMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = []
  const entries = (payload as { entry?: { changes?: { value?: WebhookValue }[] }[] })?.entry ?? []

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (!message.id || !message.from) continue

        const base = { wamid: message.id, from: message.from }

        switch (message.type) {
          case 'text':
            out.push({ ...base, kind: 'text', text: message.text?.body ?? '', mediaId: null, unsupported: false })
            break
          case 'image':
            out.push({
              ...base,
              kind: 'image',
              text: message.image?.caption ?? null,
              mediaId: message.image?.id ?? null,
              unsupported: false,
            })
            break
          case 'audio':
          case 'voice':
            out.push({
              ...base,
              kind: 'audio',
              text: null,
              mediaId: message.audio?.id ?? message.voice?.id ?? null,
              unsupported: false,
            })
            break
          default:
            out.push({ ...base, kind: 'text', text: null, mediaId: null, unsupported: true })
        }
      }
    }
  }

  return out
}
