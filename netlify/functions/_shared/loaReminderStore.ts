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

export async function resetReminderStateForTests() {
  memory = empty()
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory is already clear */
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
  memory = {
    watermark: state.watermark,
    reminded: { ...state.reminded },
    recent: [...state.recent],
  }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', memory)
  } catch {
    /* memory still holds the latest */
  }
}
