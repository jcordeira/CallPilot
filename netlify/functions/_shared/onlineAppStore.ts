import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

const memory = new Set<string>()

function store() {
  try {
    return getStore('loanpilot-online-apps')
  } catch {
    return null
  }
}

export function resetOnlineAppStoreForTests(): void {
  memory.clear()
}

async function owns(key: string, token: string): Promise<boolean> {
  const blob = store()
  if (!blob) return true
  try {
    const raw = (await blob.get(key, { type: 'json', consistency: 'strong' })) as { token?: string } | null
    return raw?.token === token
  } catch {
    return false
  }
}

/** True when this caller stored the key. A lost race or a blob error returns false. */
export async function claimOnlineApp(key: string): Promise<boolean> {
  if (memory.has(key)) return false
  memory.add(key)
  const blob = store()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at: new Date().toISOString(), token }, { onlyIfNew: true })
    if (written && (written as { modified?: boolean }).modified === false) {
      memory.delete(key)
      return false
    }
    if (!(await owns(key, token))) {
      memory.delete(key)
      return false
    }
    return true
  } catch {
    memory.delete(key)
    return false
  }
}

export async function releaseOnlineApp(key: string): Promise<void> {
  memory.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    /* a later run can retry */
  }
}

export type ZhengCollaboratorResult = { ok: boolean; personId: number; userId: number; error?: string }

type Saved = {
  seeded?: boolean
  enabledAt?: string
  last?: unknown
  releasedStaleClaims?: boolean
  zhengCollaborator?: ZhengCollaboratorResult
}

let memoryState: Saved = {}

export async function loadOnlineAppState(): Promise<Saved> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('state', { type: 'json' })) as Saved | null
      if (raw && typeof raw === 'object') {
        memoryState = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memoryState
}

export async function saveOnlineAppState(next: Saved): Promise<void> {
  memoryState = next
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', next)
  } catch {
    /* memory */
  }
}

export function resetOnlineAppStateForTests(): void {
  memoryState = {}
  memory.clear()
}
