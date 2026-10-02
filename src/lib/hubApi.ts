export type HubEventSource = 'google' | 'demo'
export type HubTaskSource = 'google' | 'fub' | 'demo'

export type HubCalendarEvent = {
  id: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  htmlLink?: string
  allDay: boolean
  source: HubEventSource
}

export type HubTask = {
  id: string
  title: string
  notes?: string
  due?: string
  status: 'needsAction' | 'completed'
  source: HubTaskSource
  personName?: string
  assignedTo?: string
}

export type LeadHeatBand = 'hot' | 'warm' | 'cool' | 'cold'

export type ScoredLead = {
  personId: number
  name: string
  score: number
  band: LeadHeatBand
  reasons: string[]
  assignee?: string
  assigneeRole?: 'lo' | 'loa'
  taskType?: string
  due?: string
  stage?: string
  scoredAt: string
}

export type GoogleConnection = {
  configured: boolean
  connected: boolean
  email?: string
  source: 'oauth' | 'env' | null
  needsCalendarWrite?: boolean
}

export type HubSummary = {
  events: HubCalendarEvent[]
  tasks: HubTask[]
  activity: {
    id: string
    at: string
    decision: string
    summary: string
  }[]
  stats: {
    upcomingEvents: number
    openTasks: number
    recentReplies: number
    escalations: number
    demo: boolean
  }
  warnings: string[]
  google: GoogleConnection
  leads?: ScoredLead[]
}

async function hubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hub/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let body: { ok?: boolean; data?: T; error?: string } = {}
  if (text) {
    try {
      body = JSON.parse(text) as { ok?: boolean; data?: T; error?: string }
    } catch {
      throw new Error(text.slice(0, 200) || res.statusText)
    }
  }
  if (!res.ok || body.ok === false) throw new Error(body.error || res.statusText || 'Request failed')
  return body.data as T
}

export function fetchHubSummary() {
  return hubRequest<HubSummary>('summary')
}

export function fetchLeadHeat() {
  return hubRequest<{ leads: ScoredLead[]; demo: boolean }>('leads')
}

export function rescoreLeads() {
  return hubRequest<{ leads: ScoredLead[]; demo: boolean }>('score', { method: 'POST' })
}

export function createHubTask(input: {
  title: string
  notes?: string
  due?: string
  source?: 'google' | 'fub' | 'both'
  personId?: number
  personName?: string
}) {
  return hubRequest<{ tasks: HubTask[] }>('tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

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

export type ReminderPanel = {
  enabled: boolean
  dryRun: boolean
  lookbackHours: number
  textWindowMinutes: number
  timezone: string
  smsConfigured: boolean
  quoFromConfigured: boolean
  googleMissedCalls: string
  seats: { userId: number; name: string; role: 'lo' | 'loa'; phoneSet: boolean; fubNote: boolean }[]
  recent: ReminderLog[]
  watermark?: string
  subscribe: string[]
}

export type ReminderRun = {
  skipped?: 'disabled' | 'demo'
  enabled: boolean
  dryRun: boolean
  deliveries: { channel: string; seatName: string; summary: string; status: string }[]
  deferred: number
}

export function fetchReminderPanel() {
  return hubRequest<ReminderPanel>('reminders')
}

export function previewReminders() {
  return hubRequest<ReminderRun>('reminders', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true }),
  })
}

export type WhatsappLog = {
  id: string
  at: string
  trigger: string
  dryRun: boolean
  contactLabel: string
  summary: string
  status: 'preview' | 'sent' | 'skipped' | 'error' | 'cancelled'
  error?: string
}

export type WhatsappPanel = {
  enabled: boolean
  dryRun: boolean
  waitMinutes: number
  cooldownHours: number
  kapsoConfigured: boolean
  quoConfigured: boolean
  loPhoneSet: boolean
  pending: number
  recent: WhatsappLog[]
}

export type WhatsappRun = {
  skipped?: 'disabled' | 'demo'
  enabled: boolean
  dryRun: boolean
  deliveries: { contactLabel: string; summary: string; status: string }[]
}

export function fetchWhatsappPanel() {
  return hubRequest<WhatsappPanel>('whatsapp')
}

export function previewWhatsappAutoreply() {
  return hubRequest<WhatsappRun>('whatsapp', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true }),
  })
}

export type CalendarGuestPreview = {
  id: string
  summary: string
  startIso: string
  htmlLink?: string
  action: 'add' | 'already' | 'skip'
  reason: string
}

export type CalendarGuestPanel = {
  enabled: boolean
  dryRun: boolean
  emails: string[]
  days: number
  notify: string
  gmailCanInvite: boolean
  needsCalendarWrite: boolean
  recent: { id: string; at: string; summary: string; status: string; detail: string }[]
}

export type CalendarGuestRun = {
  skipped?: 'disabled' | 'demo' | 'scope'
  enabled: boolean
  dryRun: boolean
  previews: CalendarGuestPreview[]
  added: number
}

export function fetchCalendarGuestPanel() {
  return hubRequest<CalendarGuestPanel>('calendar-guests')
}

export function previewCalendarGuests() {
  return hubRequest<CalendarGuestRun>('calendar-guests', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true }),
  })
}

export function createHubEvent(input: {
  summary?: string
  description?: string
  startIso?: string
  endIso?: string
  attendeeEmail?: string
  leadName?: string
  hint?: string
}) {
  return hubRequest<{ event: HubCalendarEvent }>('events', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}


export type GoogleStatus = GoogleConnection & {
  expiresAt?: number
  connectedAt?: string
}

async function googleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/google/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let body: { ok?: boolean; data?: T; error?: string } = {}
  if (text) {
    try {
      body = JSON.parse(text) as { ok?: boolean; data?: T; error?: string }
    } catch {
      throw new Error(text.slice(0, 200) || res.statusText)
    }
  }
  if (!res.ok || body.ok === false) throw new Error(body.error || res.statusText || 'Request failed')
  return body.data as T
}

export function fetchGoogleStatus() {
  return googleRequest<GoogleStatus>('status')
}

export function disconnectGoogle() {
  return googleRequest<{ connected: boolean }>('disconnect', { method: 'POST' })
}

export function googleConnectUrl() {
  return '/api/google/connect'
}
