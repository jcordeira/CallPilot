import type { Config, Context } from '@netlify/functions'
import { handleFubCallSummaryWebhook } from './_shared/callSummary'
import { handleFubContractWebhook } from './_shared/contractAlerts'
import { handleFubCordeiraWebhook } from './_shared/cordeiraLine'
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

/** People, notes, email, texts, and tasks stay on the scoring path. Anything else is acknowledged and ignored. */
function isScoredEvent(event: string): boolean {
  return event === '' || /^(people|notes|emails|textMessages|tasks)/i.test(event)
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
  // callsUpdated shares each item claim and the 15-minute SMS digest claim with callsCreated.
  // The same events also feed Cordeira-line alerts when that flag is on, and call summaries
  // when CALL_SUMMARIES_ENABLED=true. Both no-op before any fetch while their flags are off.
  if (/^calls/i.test(event)) {
    const reminders = settle(runLoaReminders({ trigger: event || 'calls', callIds: ids }))
    const cordeira = settle(handleFubCordeiraWebhook(body))
    const summaries = settle(handleFubCallSummaryWebhook(body))
    if (context?.waitUntil) {
      context.waitUntil(Promise.all([reminders, cordeira, summaries]).then(() => undefined))
      return Response.json({ ok: true, event, reminders: { accepted: true } })
    }
    const [reminderResult] = await Promise.all([reminders, cordeira, summaries])
    return Response.json({ ok: true, event, reminders: reminderResult })
  }

  // Deal pipeline stages are not person stages. Buyer Contract alerts read GET /v1/deals/:id.
  // dealsCreated and dealsUpdated only. Other deal events are acknowledged with no fetch.
  if (/^deals/i.test(event)) {
    const alerts = settle(handleFubContractWebhook(body))
    if (context?.waitUntil) {
      context.waitUntil(alerts.then(() => undefined))
      return Response.json({ ok: true, event })
    }
    await alerts
    return Response.json({ ok: true, event })
  }

  if (!isScoredEvent(event)) {
    return Response.json({ ok: true, event, skipped: 'ignored' })
  }

  const result = await handleFubWebhook(body)
  if (/^textMessages/i.test(event)) {
    const pending = Promise.all([
      settle(runLoaReminders({ trigger: event, textIds: ids })),
      settle(handleFubCordeiraWebhook(body)),
    ])
    if (context?.waitUntil) context.waitUntil(pending.then(() => undefined))
    else await pending
  }
  return Response.json({ ok: true, event: event || null, ...result })
}

export const config: Config = {
  path: '/api/webhooks/fub',
  method: ['GET', 'POST'],
}
