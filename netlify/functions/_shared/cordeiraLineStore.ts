import { randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'

export type PendingText = {
  id: string
  contact: string
  conversationId?: string
  inboundAt: string
  personId?: number
  personName?: string
  /** Set after an alert goes out. The stretch stays open until someone replies. */
  alertedAt?: string
}

export type QueuedCall = {
  id: string
  contact: string
  at: string
  conversationId?: string
  personId?: number
  personName?: string
}

export type CordeiraState = {
  pendingTexts: Record<string, PendingText>
  queuedCalls: Record<string, QueuedCall>
  answeredAt: Record<string, string>
  /** Last missed-call alert per lead. One alert per lead per 4 hours. */
  lastCallAlert: Record<string, string>
}

const empty = (): CordeiraState => ({ pendingTexts: {}, queuedCalls: {}, answeredAt: {}, lastCallAlert: {} })

let memory: CordeiraState = empty()
const claims = new Map<string, string>()

export function resetCordeiraStateForTests() {
  memory = empty()
  claims.clear()
}

export function getCordeiraState(): CordeiraState {
  return memory
}

function store(): Store | null {
  try {
    return getStore({ name: 'loanpilot-cordeira-line', consistency: 'strong' })
  } catch {
    return null
  }
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

function personIdOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function normalize(raw: unknown): CordeiraState | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<CordeiraState>
  const pendingTexts: Record<string, PendingText> = {}
  if (record.pendingTexts && typeof record.pendingTexts === 'object') {
    for (const [key, value] of Object.entries(record.pendingTexts)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Partial<PendingText>
      if (typeof item.id !== 'string' || typeof item.contact !== 'string' || typeof item.inboundAt !== 'string') continue
      pendingTexts[key] = {
        id: item.id,
        contact: item.contact,
        conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
        inboundAt: item.inboundAt,
        personId: personIdOf(item.personId),
        personName: typeof item.personName === 'string' ? item.personName : undefined,
        alertedAt: typeof item.alertedAt === 'string' ? item.alertedAt : undefined,
      }
    }
  }
  const queuedCalls: Record<string, QueuedCall> = {}
  if (record.queuedCalls && typeof record.queuedCalls === 'object') {
    for (const [key, value] of Object.entries(record.queuedCalls)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Partial<QueuedCall>
      if (typeof item.id !== 'string' || typeof item.contact !== 'string' || typeof item.at !== 'string') continue
      queuedCalls[key] = {
        id: item.id,
        contact: item.contact,
        at: item.at,
        conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
        personId: personIdOf(item.personId),
        personName: typeof item.personName === 'string' ? item.personName : undefined,
      }
    }
  }
  const byLead: Record<string, PendingText> = {}
  for (const item of Object.values(pendingTexts)) {
    const lead = item.personId ? `person:${item.personId}` : item.contact
    const prev = byLead[lead]
    if (!prev || item.inboundAt < prev.inboundAt) byLead[lead] = item
  }
  return {
    pendingTexts: byLead,
    queuedCalls,
    answeredAt: stringMap(record.answeredAt),
    lastCallAlert: stringMap(record.lastCallAlert),
  }
}

export async function hydrateCordeiraState(): Promise<void> {
  const blob = store()
  if (!blob) return
  try {
    const raw = normalize(await blob.get('state', { type: 'json', consistency: 'strong' }))
    if (raw) memory = raw
  } catch {
    /* keep memory */
  }
}

export async function persistCordeiraState(): Promise<void> {
  const blob = store()
  if (!blob) return
  const snapshot = structuredClone(memory)
  try {
    await blob.setJSON('state', snapshot)
  } catch {
    /* memory holds the record */
  }
}

/** Reserve a key in this process before any await so concurrent runs cannot both win. */
export function reserveClaim(key: string, at: string): boolean {
  if (claims.has(key)) return false
  claims.set(key, at)
  return true
}

export function releaseClaim(key: string): void {
  claims.delete(key)
}

export function claimHeld(key: string): boolean {
  return claims.has(key)
}

/**
 * Strong fail-closed confirm. A blobs error or a lost race does not send.
 * The in-memory reservation stays so this process does not retry the alert.
 */
export async function confirmClaim(key: string, at: string): Promise<boolean> {
  if (!claims.has(key)) return false
  const blob = store()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at, token }, { onlyIfNew: true })
    if (!(await ownsConditionalWrite(blob, key, token, written))) return false
    return true
  } catch {
    return false
  }
}
