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

export type QuoHistoryMessage = {
  id: string
  at: string
  direction: 'in' | 'out'
  text: string
}

let inboxIdMemory: string | null = null

async function quoInboxId(): Promise<string> {
  const explicit = env('QUO_PHONE_NUMBER_ID').trim()
  if (explicit) return explicit
  if (inboxIdMemory) return inboxIdMemory
  const from = env('QUO_FROM_NUMBER').trim()
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/phone-numbers`, { headers: { Authorization: env('QUO_API_KEY') } })
  if (!res.ok) throw new Error(`Quo phone numbers failed: ${res.status}`)
  const data = (await res.json()) as { data?: { id?: string; number?: string; phoneNumber?: string }[] }
  const match = (data.data ?? []).find((item) => item.number === from || item.phoneNumber === from) ?? data.data?.[0]
  if (!match?.id) throw new Error('Quo inbox id was not found')
  inboxIdMemory = match.id
  return match.id
}

/** Recent texts with one contact on the Sales line. Demo mode returns nothing from Quo. */
export async function listQuoMessages(participant: string): Promise<QuoHistoryMessage[]> {
  if (isDemoMode() || !quoSmsConfigured()) return []
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const params = new URLSearchParams({ phoneNumberId: await quoInboxId(), maxResults: '30' })
  params.append('participants', participant)
  const res = await fetch(`${base}/messages?${params}`, { headers: { Authorization: env('QUO_API_KEY') } })
  if (!res.ok) throw new Error(`Quo messages failed: ${res.status}`)
  const data = (await res.json()) as {
    data?: { id?: string; from?: string; to?: string[]; text?: string; body?: string; content?: string; direction?: string; createdAt?: string }[]
  }
  return (data.data ?? []).map((item) => {
    const direction = String(item.direction ?? '').toLowerCase()
    const inbound = direction === 'incoming' || direction === 'inbound' || item.from === participant
    return {
      id: item.id || `${item.createdAt ?? ''}-${item.text ?? ''}`,
      at: item.createdAt || new Date().toISOString(),
      direction: inbound ? 'in' as const : 'out' as const,
      text: item.text || item.body || item.content || '',
    }
  })
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
