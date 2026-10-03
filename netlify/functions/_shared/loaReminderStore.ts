import { getStore } from '@netlify/blobs'

/** One reminder the hub can show. Phone numbers are never stored. */
export type ReminderLog = {
  id: string
  at: string
  trigger: string
  dryRun: boolean
  seatUserId: number
  seatName: string
  seatRole: 'lo' | 'loa'
  channel: 'note' | 'sms'
  personId?: number
  personName?: string
  summary: string
  itemKeys: string[]
  status: 'preview' | 'sent' | 'skipped' | 'error'
  error?: string
}

export type ReminderState = {
  /** Earliest miss we will ever remind about. Set the first time reminders are enabled. */
  watermark?: string
  reminded: Record<string, string>
  recent: ReminderLog[]
}

const empty = (): ReminderState => ({ reminded: {}, recent: [] })

let memory: ReminderState = empty()
const claims = new Map<string, string>()

function claimKey(key: string): string {
  return `reminded/${key}`
}

export async function resetReminderStateForTests() {
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

/** Claim one missed item before posting. A second caller in the same moment gets false. */
export async function claimReminderItem(key: string, at: string): Promise<boolean> {
  const blobKey = claimKey(key)
  if (claims.has(blobKey)) return false
  claims.set(blobKey, at)
  const blob = store()
  if (!blob) return true
  try {
    const written = await blob.setJSON(blobKey, { at }, { onlyIfNew: true })
    if (!written.modified) {
      claims.delete(blobKey)
      return false
    }
    return true
  } catch {
    return true
  }
}

export async function releaseReminderItem(key: string): Promise<void> {
  const blobKey = claimKey(key)
  claims.delete(blobKey)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(blobKey)
  } catch {
    /* a released claim can be retried from memory */
  }
}

function mergeStates(base: ReminderState, incoming: ReminderState): ReminderState {
  const reminded = { ...base.reminded }
  for (const [key, at] of Object.entries(incoming.reminded)) {
    if (!reminded[key] || at < reminded[key]) reminded[key] = at
  }
  const marks = [base.watermark, incoming.watermark].filter((value): value is string => Boolean(value))
  const recent: ReminderLog[] = []
  const seen = new Set<string>()
  for (const log of [...incoming.recent, ...base.recent]) {
    if (seen.has(log.id)) continue
    seen.add(log.id)
    recent.push(log)
    if (recent.length >= 40) break
  }
  return {
    watermark: marks.sort()[0],
    reminded,
    recent,
  }
}

function store() {
  try {
    return getStore('loanpilot-reminders')
  } catch {
    return null
  }
}

function normalize(raw: unknown): ReminderState | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<ReminderState>
  const reminded: Record<string, string> = {}
  if (record.reminded && typeof record.reminded === 'object') {
    for (const [key, value] of Object.entries(record.reminded)) {
      if (typeof value === 'string') reminded[key] = value
    }
  }
  return {
    watermark: typeof record.watermark === 'string' ? record.watermark : undefined,
    reminded,
    recent: Array.isArray(record.recent) ? record.recent.slice(0, 40) : [],
  }
}

export async function loadReminderState(): Promise<ReminderState> {
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
    watermark: memory.watermark,
    reminded: { ...memory.reminded },
    recent: [...memory.recent],
  }
}

export async function saveReminderState(state: ReminderState): Promise<void> {
  memory = mergeStates(memory, state)
  const blob = store()
  if (!blob) return
  try {
    const current = normalize(await blob.get('state', { type: 'json' })) ?? empty()
    memory = mergeStates(current, memory)
    await blob.setJSON('state', memory)
  } catch {
    /* memory still holds the merge */
  }
}
