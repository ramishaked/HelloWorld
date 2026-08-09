/**
 * Idempotency check against a running instance.
 *
 * Signs a synthetic inbound message exactly the way Meta does and delivers it
 * TWICE, which is what a redelivery looks like. Meta retries failed webhooks for
 * up to 7 days, and this bot creates events with no confirmation and no undo, so
 * "the same message twice produces one event" is the regression most worth
 * having a button for.
 *
 *   WHATSAPP_APP_SECRET=… ALLOWED_WA_NUMBERS=… \
 *     npm run replay -- https://your-app.vercel.app/api/whatsapp/webhook "lunch with Sarah tomorrow 1pm"
 *
 * Then confirm in Supabase that event_log holds exactly one 'created' row for
 * the printed message id — and that your calendar has one event, not two.
 */
import crypto from 'node:crypto'

const [url, text = 'lunch with Sarah tomorrow 1pm'] = process.argv.slice(2)

if (!url) {
  console.error('Usage: npm run replay -- <webhook-url> [message text]')
  process.exit(1)
}

const appSecret = process.env.WHATSAPP_APP_SECRET
const from = (process.env.ALLOWED_WA_NUMBERS ?? '').split(',')[0]?.replace(/\D/g, '')

if (!appSecret || !from) {
  console.error('Set WHATSAPP_APP_SECRET and ALLOWED_WA_NUMBERS (the first entry is used as the sender).')
  process.exit(1)
}

// Unique per run, so repeat runs of this script aren't themselves deduplicated.
const wamid = `wamid.REPLAYTEST${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '0',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '0', phone_number_id: '0' },
            contacts: [{ profile: { name: 'Replay' }, wa_id: from }],
            messages: [
              {
                from,
                id: wamid,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
}

const body = JSON.stringify(payload)
const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')

async function deliver(attempt: number) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  })
  console.log(`  delivery ${attempt}: HTTP ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 80)}`)
  return res.status
}

console.log(`\nReplaying ${wamid}\n  message: "${text}"\n  sender:  ${from}\n`)

const first = await deliver(1)
const second = await deliver(2)

console.log(`
Both deliveries should return 200 — the second is accepted and then discarded by
the wamid claim, not rejected at the HTTP layer.

Now verify exactly-once actually held:
  select outcome, count(*) from event_log where wamid = '${wamid}' group by outcome;
Expect a single row. Two 'created' rows would mean the deduplication failed.
`)

// A tampered replay must be refused outright — proves the signature check is live.
const tampered = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  body: body.replace(text, `${text} (tampered)`),
})
console.log(`Tampered body → HTTP ${tampered.status} (expected 401)\n`)

process.exit(first === 200 && second === 200 && tampered.status === 401 ? 0 : 1)
