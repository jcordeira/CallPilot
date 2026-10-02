import type { Config } from '@netlify/functions'
import { env } from './_shared/env'
import { fubSignatureMatches, fubWebhookVerificationEnabled } from './_shared/fubSignature'
import { handleFubWebhook } from './_shared/leadHeat'

function signatureOk(rawBody: string, req: Request): boolean {
  if (!fubWebhookVerificationEnabled()) return true
  const systemKey = env('FOLLOW_UP_BOSS_SYSTEM_KEY')
  const header = req.headers.get('fub-signature')
  return fubSignatureMatches(rawBody, header, systemKey)
}

/** Follow Up Boss webhooks → rescore the person and route a task to Joseph or Frank. */
export default async (req: Request) => {
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'loanpilot-fub-webhook' })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const rawBody = await req.text()
  if (!signatureOk(rawBody, req)) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let payload: unknown
  try {
    payload = rawBody ? JSON.parse(rawBody) : null
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ ok: false, error: 'JSON object body is required' }, { status: 400 })
  }

  const result = await handleFubWebhook(payload as Record<string, unknown>)
  return Response.json({ ok: true, event: (payload as { event?: string }).event ?? null, ...result })
}

export const config: Config = {
  path: '/api/webhooks/fub',
  method: ['GET', 'POST'],
}
