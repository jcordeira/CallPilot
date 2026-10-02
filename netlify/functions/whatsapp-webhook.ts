import type { Config } from '@netlify/functions'
import { env } from './_shared/env'
import { kapsoSignatureMatches } from './_shared/kapso'
import { ingestKapsoWebhook } from './_shared/whatsappAutoreply'

/** Kapso phone-number webhooks. Signature is required; a missing secret rejects the call. */
export default async (req: Request) => {
  if (req.method === 'GET') return Response.json({ ok: true, service: 'loanpilot-whatsapp-webhook' })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()
  const signature = req.headers.get('x-webhook-signature')
  if (!kapsoSignatureMatches(rawBody, signature, env('KAPSO_WEBHOOK_SECRET'))) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown = null
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  const event = req.headers.get('x-webhook-event') ?? ''
  const result = await ingestKapsoWebhook({
    event,
    body,
    idempotencyKey: req.headers.get('x-idempotency-key'),
  })
  return Response.json(result)
}

export const config: Config = {
  path: '/api/webhooks/whatsapp',
  method: ['GET', 'POST'],
}
