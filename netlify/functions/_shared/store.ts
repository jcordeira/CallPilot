import { getStore } from '@netlify/blobs'
import type { ActivityItem, AssistantSettings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { isDemoMode } from './env'

const memoryActivity: ActivityItem[] = []
let memorySettings: AssistantSettings | null = null

async function activityStore() {
  try {
    return getStore('loanpilot-activity')
  } catch {
    return null
  }
}

async function settingsStore() {
  try {
    return getStore('loanpilot-settings')
  } catch {
    return null
  }
}

export async function loadSettings(): Promise<AssistantSettings> {
  if (memorySettings) return memorySettings
  const store = await settingsStore()
  if (store) {
    const raw = await store.get('config', { type: 'json' })
    if (raw && typeof raw === 'object') {
      memorySettings = { ...DEFAULT_SETTINGS, ...(raw as AssistantSettings) }
      return memorySettings
    }
  }
  memorySettings = { ...DEFAULT_SETTINGS }
  return memorySettings
}

export async function saveSettings(patch: Partial<AssistantSettings>): Promise<AssistantSettings> {
  const current = await loadSettings()
  const next = { ...current, ...patch, channels: { ...current.channels, ...(patch.channels ?? {}) } }
  memorySettings = next
  const store = await settingsStore()
  if (store) await store.setJSON('config', next)
  return next
}

export async function appendActivity(item: ActivityItem): Promise<void> {
  memoryActivity.unshift(item)
  if (memoryActivity.length > 200) memoryActivity.length = 200
  const store = await activityStore()
  if (store) {
    const existing = ((await store.get('items', { type: 'json' })) as ActivityItem[] | null) ?? []
    const merged = [item, ...existing].slice(0, 200)
    await store.setJSON('items', merged)
  }
}

export async function listActivity(limit = 50): Promise<ActivityItem[]> {
  const store = await activityStore()
  if (store) {
    const existing = ((await store.get('items', { type: 'json' })) as ActivityItem[] | null) ?? []
    if (existing.length) return existing.slice(0, limit)
  }
  if (memoryActivity.length) return memoryActivity.slice(0, limit)
  if (isDemoMode()) return seedDemoActivity().slice(0, limit)
  return []
}

function seedDemoActivity(): ActivityItem[] {
  const now = Date.now()
  return [
    {
      id: 'seed-1',
      at: new Date(now - 12 * 60_000).toISOString(),
      channel: 'gmail',
      from: 'alex.buyer@gmail.com',
      subject: 'Question about pre-approval documents',
      senderKind: 'lead',
      decision: 'replied',
      summary: 'Drafted reply listing typical pre-approval docs; FUB task created.',
      replyPreview: 'Thanks for asking. For a typical pre-approval we start with…',
      fubPersonId: 1001,
      fubTaskId: 5102,
    },
    {
      id: 'seed-2',
      at: new Date(now - 40 * 60_000).toISOString(),
      channel: 'sms',
      from: '+15551234567',
      senderKind: 'lead',
      decision: 'appointment_created',
      summary: 'Lead asked for a call; held calendar slot and FUB Appointment task.',
      calendarEventId: 'cal-demo-1',
      fubTaskId: 5103,
    },
    {
      id: 'seed-3',
      at: new Date(now - 2 * 3600_000).toISOString(),
      channel: 'gmail',
      from: 'ops@underwriting.example.com',
      subject: 'UW condition update — file 55421',
      senderKind: 'ops',
      decision: 'skipped',
      summary: 'Skipped — operations sender, not a lead.',
    },
  ]
}
