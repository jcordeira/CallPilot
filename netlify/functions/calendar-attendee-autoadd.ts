import type { Config } from '@netlify/functions'
import { runCalendarAttendeeAutoadd } from './_shared/calendarAttendeeAutoadd'

/** Every 10 minutes. Adds Joe, and Frankie when the client is a Pingtree DSCR lead or the match is unsure. */
export default async () => {
  const result = await runCalendarAttendeeAutoadd({ trigger: 'schedule' })
  return Response.json(result)
}

export const config: Config = {
  schedule: '*/10 * * * *',
}
