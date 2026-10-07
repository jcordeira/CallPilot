import type { Config } from '@netlify/functions'
import { runCallSummarySweep } from './_shared/callSummary'
import { runLoaReminders } from './_shared/loaReminders'

/** Every 15 minutes: overdue tasks, unanswered texts, and missed calls. No-ops until LOA_REMINDERS_ENABLED=true.
 * The same schedule sweeps Follow Up Boss calls from the last 24 hours for a late transcript.
 * That sweep no-ops until CALL_SUMMARIES_ENABLED=true and does not change reminder behavior. */
export default async (_req: Request) => {
  const result = await runLoaReminders({ trigger: 'schedule' })
  let callSummaries: unknown
  try {
    callSummaries = await runCallSummarySweep()
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'call summary sweep failed'
    console.log(`[call-summary] sweep failed: ${message}`)
    callSummaries = { error: message }
  }
  return Response.json({ ...result, callSummaries })
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
