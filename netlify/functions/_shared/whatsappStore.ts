import { randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'

export type WhatsappLog = {
  id: string
  at: string
  trigger: string
  dryRun: boolean
  contactLabel: string
  summary: string
  status: 'preview' | 'sent' | 'skipped' | 'error' | 'cancelled'
  error?: string
}

export type WhatsappPending = {
  contactKey: string
  phone?: string
  recipient?: string
  label: string
  alertLabel: string
  snippet: string
  messageId: string
  conversationId?: string
  inboundAt: string
  previewed?: boolean
  skipLogged?: boolean
  attempts: number
}

export type WhatsappState = {
  pending: Record<string, WhatsappPending>
  /** Latest outbound from Joseph or the API, per contact. */
  answeredAt: Record<string, string>
  cooldownUntil: Record<string, string>
  ownMessageIds: string[]
  idempotencyKeys: string[]
  seenMessageIds: string[]
  recent: WhatsappLog[]
}

const MAX_RECENT = 40
const MAX_IDS = 200

const empty = (): WhatsappState => ({
  pending: {},
  answeredAt: {},
  cooldownUntil: {},
  ownMessageIds: [],
  idempotencyKeys: [],
  seenMessageIds: [],
  recent: [],
})

let memory: WhatsappState = empty()
const claims = new Map<string, string>()

export async function resetWhatsappStateForTests() {
  memory = empty()
  claims.clear()
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory is already clear */
  }
}

function store(): Store | null {
  try {
    return getStore({ name: 'loanpilot-whatsapp', consistency: 'strong' })
  } catch {
    return null
  }
}

function claimKey(contactKey: string, messageId: string): string {
  return `send/${contactKey}/${messageId}`
}

/**
 * @netlify/blobs 11.1.1 reports `modified: true` for every conditional write that
 * is not HTTP 412. A strong read-back of our token is what proves we own the key.
 */
async function ownsConditionalWrite(blob: Store, key: string, token: string, result: { modified: boolean }): Promise<boolean> {
  if (!result.modified) return false
  const raw = (await blob.get(key, { type: 'json', consistency: 'strong' })) as { token?: string } | null
  return raw?.token === token
}

/** One auto-reply per inbound message. Blobs errors and lost races skip the send. */
export async function claimAutoreplySend(contactKey: string, messageId: string, at: string): Promise<boolean> {
  const key = claimKey(contactKey, messageId)
  if (claims.has(key)) return false
  claims.set(key, at)
  const blob = store()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at, token }, { onlyIfNew: true })
    if (!(await ownsConditionalWrite(blob, key, token, written))) {
      claims.delete(key)
      return false
    }
    return true
  } catch {
    claims.delete(key)
    return false
  }
}

export async function releaseAutoreplyClaim(contactKey: string, messageId: string): Promise<void> {
  const key = claimKey(contactKey, messageId)
  claims.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    /* a failed send can be claimed again */
  }
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function normalize(raw: unknown): WhatsappState | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<WhatsappState>
  const pending: Record<string, WhatsappPending> = {}
  if (record.pending && typeof record.pending === 'object') {
    for (const [key, value] of Object.entries(record.pending)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Partial<WhatsappPending>
      if (typeof item.contactKey !== 'string' || typeof item.inboundAt !== 'string' || typeof item.messageId !== 'string') continue
      pending[key] = {
        contactKey: item.contactKey,
        phone: typeof item.phone === 'string' ? item.phone : undefined,
        recipient: typeof item.recipient === 'string' ? item.recipient : undefined,
        label: typeof item.label === 'string' ? item.label : 'a contact',
        alertLabel: typeof item.alertLabel === 'string' ? item.alertLabel : typeof item.label === 'string' ? item.label : 'a contact',
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
        messageId: item.messageId,
        conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
        inboundAt: item.inboundAt,
        previewed: item.previewed === true,
        skipLogged: item.skipLogged === true,
        attempts: typeof item.attempts === 'number' ? item.attempts : 0,
      }
    }
  }
  return {
    pending,
    answeredAt: stringMap(record.answeredAt),
    cooldownUntil: stringMap(record.cooldownUntil),
    ownMessageIds: Array.isArray(record.ownMessageIds) ? record.ownMessageIds.filter((id) => typeof id === 'string').slice(-MAX_IDS) : [],
    idempotencyKeys: Array.isArray(record.idempotencyKeys)
      ? record.idempotencyKeys.filter((id) => typeof id === 'string').slice(-MAX_IDS)
      : [],
    seenMessageIds: Array.isArray(record.seenMessageIds)
      ? record.seenMessageIds.filter((id) => typeof id === 'string').slice(-MAX_IDS)
      : [],
    recent: Array.isArray(record.recent) ? record.recent.slice(0, MAX_RECENT) : [],
  }
}

export async function loadWhatsappState(): Promise<WhatsappState> {
  const blob = store()
  if (blob) {
    try {
      const raw = normalize(await blob.get('state', { type: 'json' }))
      if (raw) {
        memory = raw
        return raw
      }
    } catch {
      /* memory fallback */
    }
  }
  return {
    pending: { ...memory.pending },
    answeredAt: { ...memory.answeredAt },
    cooldownUntil: { ...memory.cooldownUntil },
    ownMessageIds: [...memory.ownMessageIds],
    idempotencyKeys: [...memory.idempotencyKeys],
    seenMessageIds: [...memory.seenMessageIds],
    recent: [...memory.recent],
  }
}

export async function saveWhatsappState(next: WhatsappState): Promise<void> {
  const trimmed: WhatsappState = {
    ...next,
    ownMessageIds: next.ownMessageIds.slice(-MAX_IDS),
    idempotencyKeys: next.idempotencyKeys.slice(-MAX_IDS),
    seenMessageIds: next.seenMessageIds.slice(-MAX_IDS),
    recent: next.recent.slice(0, MAX_RECENT),
  }
  memory = trimmed
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', trimmed)
  } catch {
    /* memory still holds the latest */
  }
}
