import type { Config, Context } from '@netlify/functions'
import { env } from './_shared/env'
import { deliverCommandReply, handleCommandMessage, readQuoInbound } from './_shared/commandMode'
import { claimQuoMessage } from './_shared/commandStore'
import { verifyQuoWebhook } from './_shared/quoSignature'

/** Quo message.received on the Sales line. Commands only; client texts are ignored. */
export default async (req: Request, context?: Context) => {
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

  // Claim before any parse or note so a Quo retry is a no-op. Fail closed when blobs error.
  if (!(await claimQuoMessage(message.id))) return Response.json({ ok: true, ignored: 'duplicate' })

  const work = async () => {
    const result = await handleCommandMessage({
      from: message.from,
      to: message.to,
      body: message.body,
      messageId: message.id,
      quoClaimed: true,
    })
    if (result.reply) await deliverCommandReply(message.from, result.reply)
    return result
  }

  const waitUntil = context?.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(work().catch((err) => {
      const detail = err instanceof Error && err.message ? err.message : 'command failed'
      console.log(`[quo-webhook] ${detail}`)
    }))
    return Response.json({ ok: true, accepted: true })
  }

  const result = await work()
  return Response.json({ ok: true, ignored: result.ignored ?? null, acted: Boolean(result.reply) })
}

export const config: Config = {
  path: '/api/webhooks/quo',
  method: ['GET', 'POST'],
}
