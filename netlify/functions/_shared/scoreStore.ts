import { createHash, randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'
import type { ScoredLead } from './hubTypes'

const LOCK_TTL_MS = 2 * 60 * 1000

const scores = new Map<number, ScoredLead>()
const locks = new Map<string, number>()
const noteClaims = new Map<string, string>()

export function resetScoreStoreForTests() {
  scores.clear()
  locks.clear()
  noteClaims.clear()
}

function store(): Store | null {
  try {
    return getStore({ name: 'loanpilot-scores', consistency: 'strong' })
  } catch {
    return null
  }
}

type LockRecord = { until?: string; token?: string }

/**
 * @netlify/blobs 11.1.1 reports `modified: true` for every conditional write that
 * is not HTTP 412. A strong read-back of our token is what proves we own the key.
 */
async function ownsConditionalWrite(blob: Store, key: string, token: string, result: { modified: boolean }): Promise<boolean> {
  if (!result.modified) return false
  const raw = (await blob.get(key, { type: 'json', consistency: 'strong' })) as { token?: string } | null
  return raw?.token === token
}

function heatNoteKey(personId: number, subject: string, body: string): string {
  const hash = createHash('sha256').update(subject).update('\0').update(body).digest('hex')
  return `note/${personId}/${hash}`
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

  const blob = store()
  if (!blob) {
    locks.set(key, now + ttlMs)
    return true
  }

  const token = randomUUID()
  const until = new Date(now + ttlMs).toISOString()
  try {
    const created = await blob.setJSON(key, { until, token }, { onlyIfNew: true })
    if (await ownsConditionalWrite(blob, key, token, created)) {
      locks.set(key, now + ttlMs)
      return true
    }

    // A missing lock is not an expired one. Skip it; the cron rescores later.
    const existing = await blob.getWithMetadata(key, { type: 'json', consistency: 'strong' })
    if (!existing) return false
    const data = existing.data as LockRecord | null
    if (data?.token === token) {
      locks.set(key, now + ttlMs)
      return true
    }
    const expiry = data?.until ? new Date(data.until).getTime() : Number.NaN
    if (!existing.etag || !Number.isFinite(expiry) || expiry > Date.now()) {
      if (Number.isFinite(expiry) && expiry > Date.now()) locks.set(key, expiry)
      return false
    }

    const retryToken = randomUUID()
    const retryUntil = new Date(Date.now() + ttlMs).toISOString()
    const again = await blob.setJSON(key, { until: retryUntil, token: retryToken }, { onlyIfMatch: existing.etag })
    if (!(await ownsConditionalWrite(blob, key, retryToken, again))) return false
    locks.set(key, Date.now() + ttlMs)
    return true
  } catch {
    return false
  }
}

/** One heat note body per person. Blobs errors and lost races skip the write. */
export async function claimLeadHeatNote(personId: number, subject: string, body: string, at: string): Promise<boolean> {
  const key = heatNoteKey(personId, subject, body)
  if (noteClaims.has(key)) return false
  noteClaims.set(key, at)
  const blob = store()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at, token }, { onlyIfNew: true })
    if (!(await ownsConditionalWrite(blob, key, token, written))) {
      noteClaims.delete(key)
      return false
    }
    return true
  } catch {
    noteClaims.delete(key)
    return false
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
