import type { Config, Context } from '@netlify/functions'
import { env } from './_shared/env'
import { fubSignatureMatches, fubWebhookVerificationEnabled } from './_shared/fubSignature'
import { handleFubWebhook } from './_shared/leadHeat'
import { runLoaReminders } from './_shared/loaReminders'

function signatureOk(rawBody: string, req: Request): boolean {
  if (!fubWebhookVerificationEnabled()) return true
  const systemKey = env('FOLLOW_UP_BOSS_SYSTEM_KEY')
  const header = req.headers.get('fub-signature')
  return fubSignatureMatches(rawBody, header, systemKey)
}

function resourceIds(payload: Record<string, unknown>): number[] {
  if (!Array.isArray(payload.resourceIds)) return []
  return payload.resourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
}

function settle(pending: Promise<unknown>) {
  return pending.then(
    (value) => value,
    (err: unknown) => {
      const message = err instanceof Error && err.message ? err.message : 'reminder failed'
      console.log(`[loa-reminders] webhook follow-up failed: ${message}`)
      return { error: message }
    },
  )
}

/** Follow Up Boss webhooks → rescore the person and route a task to Joseph or Frank. */
export default async (req: Request, context?: Context) => {
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

  const body = payload as Record<string, unknown>
  const event = typeof body.event === 'string' ? body.event : ''
  const ids = resourceIds(body)

  // peopleUpdated also fires when LoanPilot writes customLoanPilotScore. Rescoring it loops notes.
  if (/^peopleUpdated$/i.test(event)) {
    return Response.json({ ok: true, event, skipped: 'people-updated' })
  }

  // Call events are not scored (that would change lead routing). They feed miss reminders.
  // callsUpdated claims the same reminder key as callsCreated, so a pair does not post twice.
  if (/^calls/i.test(event)) {
    const pending = settle(runLoaReminders({ trigger: event || 'calls', callIds: ids }))
    if (context?.waitUntil) {
      context.waitUntil(pending.then(() => undefined))
      return Response.json({ ok: true, event, reminders: { accepted: true } })
    }
    return Response.json({ ok: true, event, reminders: await pending })
  }

  const result = await handleFubWebhook(body)
  if (/^textMessages/i.test(event)) {
    const pending = settle(runLoaReminders({ trigger: event, textIds: ids }))
    if (context?.waitUntil) context.waitUntil(pending.then(() => undefined))
    else await pending
  }
  return Response.json({ ok: true, event: event || null, ...result })
}

export const config: Config = {
  path: '/api/webhooks/fub',
  method: ['GET', 'POST'],
}
