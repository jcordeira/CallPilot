import type { Config } from '@netlify/functions'
import { runCordeiraLineAlerts } from './_shared/cordeiraLine'

/** Every minute. Unanswered Cordeira-line texts alert once the 10-minute timer is up. */
export default async () => {
  const result = await runCordeiraLineAlerts()
  return Response.json(result)
}

export const config: Config = {
  schedule: '* * * * *',
}
