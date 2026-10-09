import { randomUUID } from 'node:crypto'
import { getStore, type Store } from '@netlify/blobs'

type ClaimRecord = { at: string; phone?: string }

const claims = new Map<string, ClaimRecord>()

export function resetContractAlertStoreForTests() {
  claims.clear()
}

function store(): Store | null {
  try {
    return getStore({ name: 'loanpilot-contract-alerts', consistency: 'strong' })
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

/** One text or one note for this deal's entry into Buyer Contract. A blobs error or a lost race does not send. */
export async function claimContractAlert(key: string, at: string): Promise<boolean> {
  if (claims.has(key)) return false
  claims.set(key, { at })
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

/** Remember which phone a held send claim actually texted, so a failed log can retry without a second text. */
export async function rememberContractAlertPhone(key: string, phone: string): Promise<void> {
  const prev = claims.get(key)
  if (prev) prev.phone = phone
  else claims.set(key, { at: 'held', phone })
  const blob = store()
  if (!blob) return
  try {
    const raw = (await blob.get(key, { type: 'json', consistency: 'strong' })) as { at?: string; token?: string; phone?: string } | null
    if (!raw || raw.phone === phone) return
    await blob.setJSON(key, { ...raw, phone })
  } catch {
    /* this isolate still has the phone for a same-process retry */
  }
}

/** Phone stored on a send claim. Null when the claim is a skip or the phone was never saved. */
export async function contractAlertPhone(key: string): Promise<string | null> {
  const local = claims.get(key)?.phone
  if (local) return local
  const blob = store()
  if (!blob) return null
  try {
    const raw = (await blob.get(key, { type: 'json', consistency: 'strong' })) as { phone?: string } | null
    return raw?.phone || null
  } catch {
    return null
  }
}

/** Drop a claim when nothing was sent, so a later webhook or sweep can retry. */
export async function releaseContractAlert(key: string): Promise<void> {
  const phone = claims.get(key)?.phone
  claims.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    claims.set(key, { at: 'held', phone })
  }
}
