import type { Config } from '@netlify/functions'
import { runFrankieDailyEmail } from './_shared/frankieDailyEmailRun'

/** Weekdays at 12:00 and 13:00 UTC. The run sends only when it is 8:00 AM in America/New_York. */
export default async () => {
  const result = await runFrankieDailyEmail()
  return Response.json(result)
}

export const config: Config = {
  schedule: '0 12,13 * * 1-5',
}
