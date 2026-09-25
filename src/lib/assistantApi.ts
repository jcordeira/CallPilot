export type Channel = 'gmail' | 'neo' | 'sms'

export type ActivityItem = {
  id: string
  at: string
  channel: Channel
  from: string
  subject?: string
  senderKind: 'lead' | 'ops' | 'unknown'
  decision: 'replied' | 'escalated' | 'skipped' | 'task_created' | 'appointment_created'
  summary: string
  replyPreview?: string
  fubPersonId?: number
  fubTaskId?: number
  calendarEventId?: string
}

export type AssistantSettings = {
  autoReplyEnabled: boolean
  draftOnly: boolean
  channels: { gmail: boolean; neo: boolean; sms: boolean }
  leadOnly: boolean
  opsDomainBlocklist: string[]
  opsEmailBlocklist: string[]
  escalateKeywords: string[]
  signature: string
  tone: 'warm_professional' | 'brief' | 'friendly'
  createFubTasks: boolean
  createCalendarEvents: boolean
  unavailableMessage: string
  loanOfficerName: string
  companyName: string
  nmls?: string
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/assistant/${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export function fetchActivity(limit = 40) {
  return api<{ items: ActivityItem[] }>(`activity?limit=${limit}`)
}

export function fetchSettings() {
  return api<{ settings: AssistantSettings }>('settings')
}

export function saveSettings(patch: Partial<AssistantSettings>) {
  return api<{ settings: AssistantSettings }>('settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function runSweep() {
  return api<{ ok: boolean; processed: number; results: ActivityItem[] }>('run', { method: 'POST' })
}

export function previewReply(input: {
  body: string
  channel?: Channel
  subject?: string
  fromEmail?: string
  fromName?: string
  fromPhone?: string
}) {
  return api<{ activity: ActivityItem; replyBody?: string }>('preview', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
