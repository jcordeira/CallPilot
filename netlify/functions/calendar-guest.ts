import type { Config } from '@netlify/functions'
import { runCalendarGuest } from './_shared/calendarGuest'

/** Every 15 minutes. Adds configured guests to upcoming client appointments. Off until enabled. */
export default async () => {
  const result = await runCalendarGuest({ trigger: 'schedule' })
  return Response.json(result)
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
