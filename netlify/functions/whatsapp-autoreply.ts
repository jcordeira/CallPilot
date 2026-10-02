import type { Config } from '@netlify/functions'
import { runWhatsappAutoreply } from './_shared/whatsappAutoreply'

/** Every minute. Sends the auto-reply only after the wait elapses with no outbound reply. */
export default async () => {
  const result = await runWhatsappAutoreply({ trigger: 'schedule' })
  return Response.json(result)
}

export const config: Config = {
  schedule: '* * * * *',
}
