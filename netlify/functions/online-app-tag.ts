import type { Config } from '@netlify/functions'
import { runOnlineApplications } from './_shared/onlineApp'

/** Every 10 minutes. Tags or creates the Follow Up Boss person for a new Cliffco application email. */
export default async () => {
  const result = await runOnlineApplications({ backfill: false })
  return Response.json(result)
}

export const config: Config = {
  schedule: '*/10 * * * *',
}
