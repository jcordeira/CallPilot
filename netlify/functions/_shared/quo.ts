import { env, isDemoMode } from './env'

/** Quo (OpenPhone) — business SMS that works on iPhone via the Quo app. */
export async function sendSms(input: { to: string; content: string }): Promise<{ id: string }> {
  const from = env('QUO_FROM_NUMBER')
  const apiKey = env('QUO_API_KEY')

  if (isDemoMode() || !apiKey || !from) {
    return { id: `sms-demo-${Date.now()}` }
  }

  // Quo public API (OpenPhone-compatible). Prefer webhook-driven inbound; outbound via REST.
  const res = await fetch('https://api.openphone.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: input.content,
      from,
      to: [input.to],
    }),
  })
  if (!res.ok) throw new Error(`Quo SMS failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { data?: { id?: string }; id?: string }
  return { id: data.data?.id ?? data.id ?? `sms-${Date.now()}` }
}
