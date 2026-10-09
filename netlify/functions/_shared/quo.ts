import { getStore, type Store } from '@netlify/blobs'
import { env, isDemoMode } from './env'

/** GSM-7 basic alphabet. One character is one septet, so 160 characters is one segment. */
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM7 = new Set(GSM7_BASIC)

const GSM7_PUNCTUATION: Record<string, string> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u202F': ' ',
  '\u2007': ' ',
  '\uFEFF': ' ',
}

/** Map smart punctuation, then drop emoji and anything outside the single-septet alphabet. */
export function toGsm7(input: string): string {
  let mapped = ''
  for (const char of input) mapped += GSM7_PUNCTUATION[char] ?? char
  let out = ''
  for (const char of mapped) if (GSM7.has(char)) out += char
  return out
}

export function isGsm7(input: string): boolean {
  for (const char of input) if (!GSM7.has(char)) return false
  return true
}

/** GSM-7 segment count. Multipart messages pack 153 characters each. */
export function gsmSegmentCount(input: string): number {
  const text = isGsm7(input) ? input : toGsm7(input)
  if (text.length === 0) return 0
  if (text.length <= 160) return 1
  return Math.ceil(text.length / 153)
}

const QUO_BACKOFF_MS = 30 * 60 * 1000
let backoffUntilMs = 0

export class QuoSmsError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(`Quo SMS failed: ${status} ${detail}`)
    this.name = 'QuoSmsError'
    this.status = status
  }
}

export function isQuoPaymentBlock(err: unknown): boolean {
  return err instanceof QuoSmsError && err.status === 402
}

export function resetQuoForTests() {
  backoffUntilMs = 0
}

function quoStore(): Store | null {
  try {
    return getStore({ name: 'loanpilot-quo', consistency: 'strong' })
  } catch {
    return null
  }
}

async function readBackoffUntil(): Promise<number> {
  if (backoffUntilMs > Date.now()) return backoffUntilMs
  const blob = quoStore()
  if (!blob) return backoffUntilMs
  try {
    const raw = (await blob.get('sms-backoff', { type: 'json', consistency: 'strong' })) as { until?: string } | null
    const until = raw?.until ? Date.parse(raw.until) : 0
    if (Number.isFinite(until) && until > backoffUntilMs) backoffUntilMs = until
  } catch {
    /* a missed flag must not silence texts forever */
  }
  return backoffUntilMs
}

/** True while a 402 backoff flag is still in the future. */
export async function quoSmsPaused(now = new Date()): Promise<boolean> {
  const until = await readBackoffUntil()
  return until > now.getTime()
}

/** Skip every Quo send for 30 minutes after a 402. The clock is the caller's `now`. */
export async function noteQuoPaymentFailure(now = new Date()): Promise<void> {
  const until = now.getTime() + QUO_BACKOFF_MS
  if (until > backoffUntilMs) backoffUntilMs = until
  const blob = quoStore()
  if (!blob) return
  try {
    await blob.setJSON('sms-backoff', { until: new Date(backoffUntilMs).toISOString() })
  } catch {
    /* memory flag still skips sends in this process */
  }
}

/** True when an API key and a sending inbox number are both set. */
export function quoSmsConfigured(): boolean {
  return env('QUO_API_KEY').trim() !== '' && env('QUO_FROM_NUMBER').trim() !== ''
}

/**
 * Quo (OpenPhone) — business SMS that works on iPhone via the Quo app.
 * `QUO_FROM_NUMBER` is the Quo inbox that sends (E.164), not the recipient's cell.
 */
export async function sendSms(input: { to: string; content: string }): Promise<{ id: string }> {
  const content = toGsm7(input.content)
  const from = env('QUO_FROM_NUMBER')
  const apiKey = env('QUO_API_KEY')

  if (isDemoMode()) return { id: `sms-demo-${Date.now()}` }
  if (!apiKey || !from) throw new Error('Quo SMS is not configured')
  if (await quoSmsPaused()) throw new QuoSmsError(402, 'backoff')

  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  // Quo public API (OpenPhone-compatible). Prefer webhook-driven inbound; outbound via REST.
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      from,
      to: [input.to],
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    if (res.status === 402) await noteQuoPaymentFailure()
    throw new QuoSmsError(res.status, detail)
  }
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

/** Recent texts with one contact on a specific Quo number id. Demo mode returns nothing from Quo. */
export async function listQuoMessagesOnNumber(phoneNumberId: string, participant: string): Promise<QuoHistoryMessage[]> {
  if (isDemoMode() || !quoSmsConfigured()) return []
  const id = phoneNumberId.trim()
  if (!id) return []
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const params = new URLSearchParams({ phoneNumberId: id, maxResults: '30' })
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

/** Recent texts with one contact on the Sales line. Demo mode returns nothing from Quo. */
export async function listQuoMessages(participant: string): Promise<QuoHistoryMessage[]> {
  if (isDemoMode() || !quoSmsConfigured()) return []
  return listQuoMessagesOnNumber(await quoInboxId(), participant)
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
