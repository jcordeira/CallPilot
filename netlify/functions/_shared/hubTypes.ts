import type { ActivityItem } from './types'

export type TaskSource = 'google' | 'fub' | 'demo'
export type TaskStatus = 'needsAction' | 'completed'
export type EventSource = 'google' | 'demo'

export type CalendarAttendee = {
  email: string
  displayName?: string
  responseStatus?: string
  optional?: boolean
  self?: boolean
  organizer?: boolean
}

export type HubCalendarEvent = {
  id: string
  summary: string
  description?: string
  location?: string
  startIso: string
  endIso: string
  htmlLink?: string
  allDay: boolean
  source: EventSource
  attendees?: CalendarAttendee[]
}

export type HubTask = {
  id: string
  title: string
  notes?: string
  due?: string
  status: TaskStatus
  source: TaskSource
  personName?: string
  personId?: number
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
  taskId?: number
  stage?: string
  scoredAt: string
}

export type HubStats = {
  upcomingEvents: number
  openTasks: number
  recentReplies: number
  escalations: number
  demo: boolean
}

export type GoogleConnection = {
  configured: boolean
  connected: boolean
  email?: string
  source: 'oauth' | 'env' | null
  needsCalendarWrite?: boolean
  /** True when the grant includes `calendar` or `calendar.events`. Env tokens are treated as capable. */
  canWrite?: boolean
  /** OAuth is connected, but the saved grant cannot send Gmail. */
  needsGmailSend?: boolean
  /** OAuth is connected but the stored scope cannot edit events or send a Gmail invite. */
  reconnect?: boolean
}

export type HubSummary = {
  events: HubCalendarEvent[]
  tasks: HubTask[]
  activity: ActivityItem[]
  stats: HubStats
  warnings: string[]
  google: GoogleConnection
  leads: ScoredLead[]
}

export type HubEventInput = {
  summary?: string
  description?: string
  startIso?: string
  endIso?: string
  attendeeEmail?: string
  leadName?: string
  hint?: string
}

export type HubTaskInput = {
  title: string
  notes?: string
  due?: string
  source: 'google' | 'fub' | 'both'
  personId?: number
  personName?: string
}

/** Local calendar date `offsetDays` from `base`, as YYYY-MM-DD. */
export function shiftDateKey(base: Date, offsetDays: number): string {
  const d = new Date(base.getTime())
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
