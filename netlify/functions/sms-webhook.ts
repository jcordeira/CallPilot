import type { Config, Context } from '@netlify/functions'
import { processIncomingMessage } from './_shared/pipeline'
import { loadSettings } from './_shared/store'
import type { IncomingMessage } from './_shared/types'
import { env } from './_shared/env'

/** Quo / OpenPhone inbound SMS webhook → lead-only auto-reply + CRM/calendar tasks. */
export default async (req: Request, _context: Context) => {
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'loanpilot-sms-webhook' })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secret = env('QUO_WEBHOOK_SECRET')
  if (secret) {
    const header = req.headers.get('x-openphone-signature') ?? req.headers.get('x-quo-secret') ?? ''
    if (header !== secret) return new Response('Unauthorized', { status: 401 })
  }

  const payload = (await req.json()) as Record<string, unknown>
  const data = (payload.data ?? payload) as Record<string, unknown>
  const from = String(data.from ?? data.phoneNumber ?? '')
  const content = String(data.body ?? data.content ?? data.text ?? '')
  const id = String(data.id ?? data.messageId ?? `sms-${Date.now()}`)

  if (!from || !content) {
    return Response.json({ ok: false, error: 'Missing from/content' }, { status: 400 })
  }

  const settings = await loadSettings()
  if (!settings.channels.sms) {
    return Response.json({ ok: true, skipped: 'SMS channel disabled' })
  }

  const message: IncomingMessage = {
    id,
    channel: 'sms',
    fromPhone: from,
    body: content,
    receivedAt: new Date().toISOString(),
  }

  const result = await processIncomingMessage(message, settings)
  return Response.json({ ok: true, activity: result.activity })
}

export const config: Config = {
  path: '/api/webhooks/sms',
  method: ['GET', 'POST'],
}
