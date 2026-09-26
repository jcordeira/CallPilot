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
