import type { Config } from '@netlify/functions'
import { runCallSummarySweep } from './_shared/callSummary'
import { runContractAlertSweep } from './_shared/contractAlerts'
import { runLoaReminders } from './_shared/loaReminders'

/** Every 15 minutes: overdue tasks, unanswered texts, and missed calls. No-ops until LOA_REMINDERS_ENABLED=true.
 * The same schedule sweeps Follow Up Boss calls from the last 24 hours for a late transcript,
 * and Purchase deals that entered Buyer Contract in the last 24 hours.
 * Those sweeps do not change reminder behavior. */
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
  let contractAlerts: unknown
  try {
    contractAlerts = await runContractAlertSweep()
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'contract alert sweep failed'
    console.log(`[contract-alert] sweep failed: ${message}`)
    contractAlerts = { error: message }
  }
  return Response.json({ ...result, callSummaries, contractAlerts })
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
