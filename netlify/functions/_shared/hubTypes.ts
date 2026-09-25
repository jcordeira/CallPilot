import type { ActivityItem } from './types'

export type TaskSource = 'google' | 'fub' | 'demo'
export type TaskStatus = 'needsAction' | 'completed'
export type EventSource = 'google' | 'demo'

export type HubCalendarEvent = {
  id: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  htmlLink?: string
  allDay: boolean
  source: EventSource
}

export type HubTask = {
  id: string
  title: string
  notes?: string
  due?: string
  status: TaskStatus
  source: TaskSource
  personName?: string
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
}

export type HubSummary = {
  events: HubCalendarEvent[]
  tasks: HubTask[]
  activity: ActivityItem[]
  stats: HubStats
  warnings: string[]
  google: GoogleConnection
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
