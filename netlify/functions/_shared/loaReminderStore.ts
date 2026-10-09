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

export type SmsBacklogEntry = {
  phone: string
  name: string
  role: 'lo' | 'loa'
  bullets: string[]
  itemKeys: string[]
  at: string
}

let memory: ReminderState = empty()
const claims = new Map<string, string>()
let smsBacklog: Record<string, SmsBacklogEntry> = {}

function claimKey(key: string): string {
  return `reminded/${key}`
}

export async function resetReminderStateForTests() {
  memory = empty()
  claims.clear()
  smsBacklog = {}
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
    await blob.delete('sms-backlog')
  } catch {
    /* memory is already clear */
  }
}

/** Claim one missed item, seat, or SMS digest. A second caller in the same moment gets false. */
export async function claimReminderItem(key: string, at: string): Promise<boolean> {
  const won = await claimReminderItems([key], at)
  return won.length === 1
}

/**
 * Claim every key before the first await so concurrent runs in this process
 * cannot split one person's task, text, and call across two notes.
 */
export async function claimReminderItems(keys: string[], at: string): Promise<string[]> {
  const won: string[] = []
  for (const key of keys) {
    const blobKey = claimKey(key)
    if (claims.has(blobKey)) continue
    claims.set(blobKey, at)
    won.push(key)
  }
  const blob = store()
  if (!blob) return won
  const kept: string[] = []
  for (const key of won) {
    const blobKey = claimKey(key)
    try {
      const written = await blob.setJSON(blobKey, { at }, { onlyIfNew: true })
      if (!written.modified) {
        claims.delete(blobKey)
        continue
      }
      kept.push(key)
    } catch {
      claims.delete(blobKey)
    }
  }
  return kept
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
    return getStore('loanpilot-reminders', { consistency: 'strong' })
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

function normalizeBacklog(raw: unknown): Record<string, SmsBacklogEntry> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, SmsBacklogEntry> = {}
  for (const [userId, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(userId) || !value || typeof value !== 'object') continue
    const item = value as Partial<SmsBacklogEntry>
    if (typeof item.phone !== 'string' || typeof item.name !== 'string') continue
    if (item.role !== 'lo' && item.role !== 'loa') continue
    out[userId] = {
      phone: item.phone,
      name: item.name,
      role: item.role,
      bullets: Array.isArray(item.bullets) ? item.bullets.filter((line) => typeof line === 'string') : [],
      itemKeys: Array.isArray(item.itemKeys) ? item.itemKeys.filter((key) => typeof key === 'string') : [],
      at: typeof item.at === 'string' ? item.at : new Date(0).toISOString(),
    }
  }
  return out
}

async function loadBacklogMap(): Promise<Record<string, SmsBacklogEntry>> {
  const blob = store()
  if (blob) {
    try {
      const raw = normalizeBacklog(await blob.get('sms-backlog', { type: 'json', consistency: 'strong' }))
      if (raw) {
        for (const [userId, entry] of Object.entries(raw)) {
          const prev = smsBacklog[userId]
          smsBacklog[userId] = {
            phone: entry.phone,
            name: entry.name,
            role: entry.role,
            bullets: [...new Set([...(prev?.bullets ?? []), ...entry.bullets])],
            itemKeys: [...new Set([...(prev?.itemKeys ?? []), ...entry.itemKeys])],
            at: entry.at,
          }
        }
      }
    } catch {
      /* memory */
    }
  }
  return smsBacklog
}

async function saveBacklogMap(): Promise<void> {
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('sms-backlog', smsBacklog)
  } catch {
    /* memory */
  }
}

/** Collapse every held digest for one teammate into a single bullet list. */
export async function mergeSmsBacklog(entry: SmsBacklogEntry & { userId: number }): Promise<void> {
  const map = await loadBacklogMap()
  const key = String(entry.userId)
  const prev = map[key]
  map[key] = {
    phone: entry.phone,
    name: entry.name,
    role: entry.role,
    bullets: [...new Set([...(prev?.bullets ?? []), ...entry.bullets])],
    itemKeys: [...new Set([...(prev?.itemKeys ?? []), ...entry.itemKeys])],
    at: entry.at,
  }
  smsBacklog = map
  await saveBacklogMap()
}

export async function listSmsBacklog(): Promise<(SmsBacklogEntry & { userId: number })[]> {
  const map = await loadBacklogMap()
  return Object.entries(map).map(([userId, entry]) => ({ ...entry, userId: Number(userId) }))
}

export async function removeSmsBacklog(userId: number): Promise<void> {
  const map = await loadBacklogMap()
  delete map[String(userId)]
  smsBacklog = map
  await saveBacklogMap()
}
