import { getStore } from '@netlify/blobs'

export type CommandLog = {
  id: string
  at: string
  actor: string
  role: 'owner' | 'team'
  command: string
  summary: string
  status: 'preview' | 'done' | 'denied' | 'error'
  dryRun: boolean
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

function store() {
  try {
    return getStore('loanpilot-commands')
  } catch {
    return null
  }
}

export async function resetCommandStateForTests() {
  memory = { seen: [], pending: [], recent: [] }
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory */
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
          recent: raw.recent.slice(0, 40),
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
    recent: next.recent.slice(0, 40),
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
