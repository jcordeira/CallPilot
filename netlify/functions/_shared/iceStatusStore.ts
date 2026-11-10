import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

const memoryClaims = new Set<string>()
let memoryLoans: Record<string, number> = {}
let memoryReviews: IceReview[] = []
let memoryLast: unknown
let memoryFlags: { releasedParseClaims?: boolean } = {}

export type IceReview = {
  id: string
  at: string
  borrower: string
  loan: string
  event: string
  reason: string
  candidates: { id: number; name: string }[]
}

function store() {
  try {
    return getStore('loanpilot-ice-status')
  } catch {
    return null
  }
}

export function resetIceStatusForTests(): void {
  memoryClaims.clear()
  memoryLoans = {}
  memoryReviews = []
  memoryLast = undefined
  memoryFlags = {}
}

export async function loadIceFlags(): Promise<{ releasedParseClaims?: boolean }> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('flags', { type: 'json' })) as { releasedParseClaims?: boolean } | null
      if (raw && typeof raw === 'object') memoryFlags = raw
    } catch {
      /* memory */
    }
  }
  return memoryFlags
}

export async function saveIceFlags(next: { releasedParseClaims?: boolean }): Promise<void> {
  memoryFlags = next
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('flags', next)
  } catch {
    /* memory */
  }
}

export async function claimIce(key: string): Promise<boolean> {
  if (memoryClaims.has(key)) return false
  memoryClaims.add(key)
  const blob = store()
  if (!blob) return true
  const token = randomUUID()
  try {
    const written = await blob.setJSON(key, { at: new Date().toISOString(), token }, { onlyIfNew: true })
    if (written && (written as { modified?: boolean }).modified === false) {
      memoryClaims.delete(key)
      return false
    }
    return true
  } catch {
    memoryClaims.delete(key)
    return false
  }
}

export async function releaseIce(key: string): Promise<void> {
  memoryClaims.delete(key)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(key)
  } catch {
    /* a later run can retry */
  }
}

export async function loanPersonId(loan: string): Promise<number | null> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('loans', { type: 'json' })) as Record<string, number> | null
      if (raw && typeof raw === 'object') memoryLoans = raw
    } catch {
      /* memory */
    }
  }
  const id = memoryLoans[loan]
  return typeof id === 'number' ? id : null
}

export async function saveLoanPerson(loan: string, personId: number): Promise<void> {
  memoryLoans = { ...memoryLoans, [loan]: personId }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('loans', memoryLoans)
  } catch {
    /* memory */
  }
}

export async function listIceReviews(): Promise<IceReview[]> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('reviews', { type: 'json' })) as IceReview[] | null
      if (Array.isArray(raw)) memoryReviews = raw
    } catch {
      /* memory */
    }
  }
  return memoryReviews
}

export async function addIceReview(review: IceReview): Promise<void> {
  const current = await listIceReviews()
  if (current.some((item) => item.id === review.id)) return
  memoryReviews = [review, ...current].slice(0, 50)
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('reviews', memoryReviews)
  } catch {
    /* memory */
  }
}

export async function saveIceRun(summary: unknown): Promise<void> {
  memoryLast = summary
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('last', summary)
  } catch {
    /* memory */
  }
}

export async function loadIceRun(): Promise<unknown> {
  const blob = store()
  if (blob) {
    try {
      const raw = await blob.get('last', { type: 'json' })
      if (raw) {
        memoryLast = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memoryLast ?? null
}
