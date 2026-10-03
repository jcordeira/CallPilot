import { getStore } from '@netlify/blobs'
import type { ScoredLead } from './hubTypes'

const LOCK_TTL_MS = 2 * 60 * 1000

const scores = new Map<number, ScoredLead>()
const locks = new Map<string, number>()

export function resetScoreStoreForTests() {
  scores.clear()
  locks.clear()
}

function store() {
  try {
    return getStore('loanpilot-scores')
  } catch {
    return null
  }
}

export async function loadPersonScore(personId: number): Promise<ScoredLead | null> {
  const cached = scores.get(personId)
  const blob = store()
  if (!blob) return cached ? { ...cached } : null
  try {
    const raw = (await blob.get(String(personId), { type: 'json' })) as ScoredLead | null
    if (raw && raw.personId === personId) {
      scores.set(personId, raw)
      return { ...raw }
    }
  } catch {
    /* memory fallback */
  }
  return cached ? { ...cached } : null
}

export async function savePersonScore(lead: ScoredLead): Promise<void> {
  scores.set(lead.personId, { ...lead })
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON(String(lead.personId), lead)
  } catch {
    /* memory holds the record */
  }
}

/** One rescore at a time per person. A second caller skips while the lock is held. */
export async function acquirePersonLock(personId: number, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const key = `lock/${personId}`
  const now = Date.now()
  const heldUntil = locks.get(key)
  if (heldUntil != null && heldUntil > now) return false
  locks.set(key, now + ttlMs)

  const blob = store()
  if (!blob) return true
  const until = new Date(now + ttlMs).toISOString()
  try {
    const created = await blob.setJSON(key, { until }, { onlyIfNew: true })
    if (created.modified) return true
    const existing = (await blob.get(key, { type: 'json' })) as { until?: string } | null
    const expiry = existing?.until ? new Date(existing.until).getTime() : 0
    if (expiry > Date.now()) {
      locks.set(key, expiry)
      return false
    }
    await blob.delete(key)
    const retryUntil = new Date(Date.now() + ttlMs).toISOString()
    locks.set(key, Date.now() + ttlMs)
    const again = await blob.setJSON(key, { until: retryUntil }, { onlyIfNew: true })
    if (!again.modified) {
      locks.delete(key)
      return false
    }
    return true
  } catch {
    return true
  }
}

export async function releasePersonLock(personId: number): Promise<void> {
  const key = `lock/${personId}`
  locks.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    /* the TTL covers a failed delete */
  }
}
