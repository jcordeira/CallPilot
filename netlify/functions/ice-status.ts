import type { Config } from '@netlify/functions'
import { runIceStatus } from './_shared/iceStatus'

/** Every 10 minutes. Notes collaborators and advances Purchase stages for new Cliffco mail. */
export default async () => {
  const result = await runIceStatus()
  return Response.json({ ...result, code: 'catchup-3' })
}

export const config: Config = {
  schedule: '*/10 * * * *',
}
