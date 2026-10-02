import type { Config } from '@netlify/functions'
import { env } from './_shared/env'
import { deliverCommandReply, handleCommandMessage, readQuoInbound } from './_shared/commandMode'
import { verifyQuoWebhook } from './_shared/quoSignature'

/** Quo message.received on the Sales line. Commands only; client texts are ignored. */
export default async (req: Request) => {
  if (req.method === 'GET') return Response.json({ ok: true, service: 'loanpilot-quo-webhook' })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()
  const valid = verifyQuoWebhook({
    rawBody,
    secret: env('QUO_WEBHOOK_SECRET'),
    webhookId: req.headers.get('webhook-id'),
    webhookTimestamp: req.headers.get('webhook-timestamp'),
    webhookSignature: req.headers.get('webhook-signature'),
    openPhoneSignature: req.headers.get('openphone-signature'),
  })
  if (!valid) return new Response('Unauthorized', { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const message = readQuoInbound(payload)
  if (!message || !message.incoming) return Response.json({ ok: true, ignored: 'event' })

  const result = await handleCommandMessage({
    from: message.from,
    to: message.to,
    body: message.body,
    messageId: message.id,
  })
  if (result.reply) await deliverCommandReply(message.from, result.reply)
  return Response.json({ ok: true, ignored: result.ignored ?? null, acted: Boolean(result.reply) })
}

export const config: Config = {
  path: '/api/webhooks/quo',
  method: ['GET', 'POST'],
}
