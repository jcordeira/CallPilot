import { randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'

export type CommandLog = {
  id: string
  at: string
  actor: string
  role: 'owner' | 'team'
  command: string
  summary: string
  status: 'preview' | 'done' | 'denied' | 'error'
  dryRun: boolean
  /** Hub chat or the Quo SMS webhook. Older rows without this field are SMS. */
  source?: 'hub' | 'sms'
}

export type CommandPending = {
  id: string
  phone: string
  expiresAt: string
  summary: string
  kind: 'confirm' | 'choice' | 'approval'
  payload: Record<string, unknown>
}

export type CommandState = {
  seen: string[]
  pending: CommandPending[]
  recent: CommandLog[]
  busyUntil?: string
}

let memory: CommandState = { seen: [], pending: [], recent: [] }
const quoClaims = new Map<string, string>()
const helpClaims = new Map<string, string>()

function store() {
  try {
    return getStore('loanpilot-commands')
  } catch {
    return null
  }
}

function strongStore(): Store | null {
  try {
    return getStore({ name: 'loanpilot-commands', consistency: 'strong' })
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

export async function resetCommandStateForTests() {
  memory = { seen: [], pending: [], recent: [] }
  quoClaims.clear()
  helpClaims.clear()
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory */
  }
}

/**
 * One Quo message id. Memory is reserved before the first await.
 * No blob store: the memory claim wins. A blobs error or a lost race does not process.
 */
export async function claimQuoMessage(messageId: string, at = new Date().toISOString()): Promise<boolean> {
  const id = messageId.trim()
  if (!id) return false
  const key = `quo-msg/${id}`
  if (quoClaims.has(key)) return false
  quoClaims.set(key, at)
  const blob = strongStore()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at, token }, { onlyIfNew: true })
    if (!(await ownsConditionalWrite(blob, key, token, written))) {
      quoClaims.delete(key)
      return false
    }
    return true
  } catch {
    quoClaims.delete(key)
    return false
  }
}

const HELP_WINDOW_MS = 12 * 60 * 60 * 1000

/** One help menu per sender per 12 hours. A blobs error does not send another menu. */
export async function claimHelpReply(phone: string, now: Date): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / HELP_WINDOW_MS)
  const key = `help/${phone}/${bucket}`
  if (helpClaims.has(key)) return false
  helpClaims.set(key, now.toISOString())
  const blob = strongStore()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at: now.toISOString(), token }, { onlyIfNew: true })
    if (!(await ownsConditionalWrite(blob, key, token, written))) {
      helpClaims.delete(key)
      return false
    }
    return true
  } catch {
    helpClaims.delete(key)
    return false
  }
}

export async function loadCommandState(): Promise<CommandState> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('state', { type: 'json' })) as CommandState | null
      if (raw && Array.isArray(raw.recent) && Array.isArray(raw.seen)) {
        memory = {
          seen: raw.seen.slice(0, 300),
          pending: Array.isArray(raw.pending) ? raw.pending.slice(0, 40) : [],
          recent: raw.recent.slice(0, 80),
          busyUntil: raw.busyUntil,
        }
        return memory
      }
    } catch {
      /* memory */
    }
  }
  return {
    seen: [...memory.seen],
    pending: [...memory.pending],
    recent: [...memory.recent],
    busyUntil: memory.busyUntil,
  }
}

export async function saveCommandState(next: CommandState) {
  memory = {
    seen: next.seen.slice(0, 300),
    pending: next.pending.slice(0, 40),
    recent: next.recent.slice(0, 80),
    busyUntil: next.busyUntil,
  }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', memory)
  } catch {
    /* memory */
  }
}

export async function commandBusyUntil(now = new Date()): Promise<string | undefined> {
  const state = await loadCommandState()
  if (!state.busyUntil) return undefined
  if (new Date(state.busyUntil).getTime() <= now.getTime()) return undefined
  return state.busyUntil
}
