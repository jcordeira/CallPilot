import type { Config } from '@netlify/functions'
import { runLoaReminders } from './_shared/loaReminders'

/** Every 15 minutes: overdue tasks, unanswered texts, and missed calls. No-ops until LOA_REMINDERS_ENABLED=true. */
export default async (_req: Request) => {
  const result = await runLoaReminders({ trigger: 'schedule' })
  return Response.json(result)
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
