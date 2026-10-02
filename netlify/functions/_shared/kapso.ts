import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env'

/**
 * Kapso signs the raw JSON body with HMAC-SHA256 and sends the hex digest in
 * `X-Webhook-Signature`. Compare the header to that digest. Re-serializing a
 * parsed body will not match.
 * https://docs.kapso.ai/docs/platform/webhooks/security
 */
export function kapsoSignatureMatches(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature.trim(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function kapsoConfigured(): boolean {
  return env('KAPSO_API_KEY').trim() !== '' && env('KAPSO_PHONE_NUMBER_ID').trim() !== ''
}

/**
 * Send a session text through Kapso's Meta proxy.
 * `POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages`
 * with `X-API-Key`. `to` is digits; `recipient` is a BSUID when there is no phone.
 * https://docs.kapso.ai/docs/whatsapp/send-messages/text
 */
export async function sendKapsoText(input: { to?: string; recipient?: string; body: string }): Promise<{ id: string }> {
  const apiKey = env('KAPSO_API_KEY').trim()
  const phoneNumberId = env('KAPSO_PHONE_NUMBER_ID').trim()
  if (!apiKey || !phoneNumberId) throw new Error('Kapso is not configured')
  const base = env('KAPSO_API_BASE', 'https://api.kapso.ai/meta/whatsapp/v24.0').replace(/\/$/, '')
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    type: 'text',
    text: { body: input.body },
  }
  if (input.to) payload.to = input.to.replace(/^\+/, '')
  else if (input.recipient) payload.recipient = input.recipient
  else throw new Error('Kapso recipient is missing')

  const res = await fetch(`${base}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Kapso send failed: ${res.status}`)
  const data = (await res.json()) as {
    messages?: { id?: string }[]
    data?: { messages?: { id?: string }[] }
  }
  const id = data.messages?.[0]?.id ?? data.data?.messages?.[0]?.id
  if (!id) throw new Error('Kapso send returned no message id')
  return { id }
}
