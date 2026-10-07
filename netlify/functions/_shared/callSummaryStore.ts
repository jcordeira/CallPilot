import { randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'

const claims = new Map<string, string>()

export function resetCallSummaryStoreForTests() {
  claims.clear()
}

function store(): Store | null {
  try {
    return getStore({ name: 'loanpilot-call-summaries', consistency: 'strong' })
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

export function callSummaryKey(callId: number): string {
  return `summary/call/${callId}`
}

/** One summary per call. A blobs error or a lost race does not post. */
export async function claimCallSummary(callId: number, at: string): Promise<boolean> {
  const key = callSummaryKey(callId)
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

/** Drop a claim when the summary was not posted, so a later transcript or sweep can retry. */
export async function releaseCallSummary(callId: number): Promise<void> {
  const key = callSummaryKey(callId)
  claims.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    claims.set(key, 'held')
  }
}
