/** Domain types shared across the app. Hours are floats in the host's time zone (14.5 = 2:30 PM). */

export type Location = 'Google Meet' | 'Zoom' | 'Phone call' | 'In person'

export interface CallType {
  id: string
  name: string
  durationMinutes: number
  location: Location
  note: string
}

export interface RecurringBreak {
  id: string
  name: string
  start: number // hour float
  end: number // hour float
  /** JS weekday numbers, 0 = Sunday … 6 = Saturday */
  days: number[]
  enabled: boolean
}

export interface WorkingHours {
  start: number
  end: number
  days: number[]
}

export type EventKind = 'client' | 'task' | 'synced'

export interface CalendarEvent {
  id: string
  userId: string
  /** YYYY-MM-DD in the host zone */
  dateKey: string
  start: number
  end: number
  title: string
  kind: EventKind
  /** For tasks booked by a teammate */
  createdBy?: string
  /** For synced events */
  source?: 'google' | 'outlook' | 'icloud'
  allDay?: boolean
}

export interface TeamMember {
  id: string
  name: string
  role: string
  email: string
  status?: 'active' | 'invited' | 'out-of-office'
  hours: WorkingHours
}

export type Provider = 'google' | 'outlook' | 'icloud'

export interface Connection {
  provider: Provider
  name: string
  tag: string
  account: string | null
  enabled: boolean
}

export interface EmailSetting {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface Settings {
  connections: Connection[]
  emails: EmailSetting[]
  conferencing: Location
  bufferMinutes: number
  breaks: RecurringBreak[]
  workingHours: WorkingHours
  minNoticeHours: number
  maxCallsPerDay: number
}

export interface Booking {
  id: string
  callTypeId: string
  hostId: string
  dateKey: string
  start: number
  end: number
  clientName: string
  clientEmail: string
  guests: string[]
  notes: string
  timeZone: string
  createdAt: string
}

export interface Zone {
  id: string
  label: string
  /** Generic abbreviation shown in the header, e.g. "ET" */
  abbr: string
  /** Friendly name used in helper copy, e.g. "Eastern Time" */
  long: string
}
