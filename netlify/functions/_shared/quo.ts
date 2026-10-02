import { env, isDemoMode } from './env'

/** True when an API key and a sending inbox number are both set. */
export function quoSmsConfigured(): boolean {
  return env('QUO_API_KEY').trim() !== '' && env('QUO_FROM_NUMBER').trim() !== ''
}

/**
 * Quo (OpenPhone) — business SMS that works on iPhone via the Quo app.
 * `QUO_FROM_NUMBER` is the Quo inbox that sends (E.164), not the recipient's cell.
 */
export async function sendSms(input: { to: string; content: string }): Promise<{ id: string }> {
  const from = env('QUO_FROM_NUMBER')
  const apiKey = env('QUO_API_KEY')

  if (isDemoMode()) return { id: `sms-demo-${Date.now()}` }
  if (!apiKey || !from) throw new Error('Quo SMS is not configured')

  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  // Quo public API (OpenPhone-compatible). Prefer webhook-driven inbound; outbound via REST.
  const res = await fetch(`${base}/messages`, {
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

/** Reminders use this so a missing Quo key skips the text instead of throwing. Demo mode never calls Quo. */
export async function sendSmsIfConfigured(input: {
  to: string
  content: string
}): Promise<{ id: string } | { skipped: 'not_configured' }> {
  if (!quoSmsConfigured()) return { skipped: 'not_configured' }
  if (isDemoMode()) return { id: `sms-demo-${Date.now()}` }
  return sendSms(input)
}
