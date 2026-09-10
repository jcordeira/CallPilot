/**
 * Placeholder content from the design handoff. Names, teammates, call types and
 * sample events are fixtures — replace with real data from the API.
 *
 * Sample events are generated relative to the current week so the week view
 * always has something to show.
 */
import type { CalendarEvent, CallType, Connection, EmailSetting, RecurringBreak, Settings, TeamMember, Zone } from '../lib/types'
import { addDays, startOfWeek, todayKey } from '../lib/time'

export const HOST_ID = 'maya'

export const CALL_TYPES: CallType[] = [
  { id: 'intro', name: 'Intro Call', durationMinutes: 15, location: 'Google Meet', note: 'No prep needed' },
  { id: 'strategy', name: 'Strategy Session', durationMinutes: 45, location: 'Zoom', note: 'Agenda sent in advance' },
  { id: 'deep-dive', name: 'Deep Dive', durationMinutes: 90, location: 'Zoom', note: 'Screen share recommended' },
]

/** Offered time zones. Offsets are computed live; abbreviations are curated. */
export const ZONES: Zone[] = [
  { id: 'America/New_York', label: 'Eastern Time — New York', abbr: 'ET', long: 'Eastern Time' },
  { id: 'America/Chicago', label: 'Central Time — Chicago', abbr: 'CT', long: 'Central Time' },
  { id: 'America/Denver', label: 'Mountain Time — Denver', abbr: 'MT', long: 'Mountain Time' },
  { id: 'America/Phoenix', label: 'Arizona — Phoenix', abbr: 'MST', long: 'Arizona Time' },
  { id: 'America/Los_Angeles', label: 'Pacific Time — Los Angeles', abbr: 'PT', long: 'Pacific Time' },
  { id: 'America/Anchorage', label: 'Alaska — Anchorage', abbr: 'AKT', long: 'Alaska Time' },
  { id: 'Pacific/Honolulu', label: 'Hawaii — Honolulu', abbr: 'HST', long: 'Hawaii Time' },
  { id: 'America/Toronto', label: 'Canada — Toronto', abbr: 'ET', long: 'Eastern Time' },
  { id: 'America/Vancouver', label: 'Canada — Vancouver', abbr: 'PT', long: 'Pacific Time' },
  { id: 'America/Mexico_City', label: 'Mexico — Mexico City', abbr: 'CST', long: 'Central Time' },
  { id: 'America/Sao_Paulo', label: 'Brazil — São Paulo', abbr: 'BRT', long: 'Brasília Time' },
  { id: 'Europe/London', label: 'United Kingdom — London', abbr: 'UK', long: 'UK Time' },
  { id: 'Europe/Lisbon', label: 'Portugal — Lisbon', abbr: 'WET', long: 'Portugal Time' },
  { id: 'Europe/Paris', label: 'France — Paris', abbr: 'CET', long: 'Central European Time' },
  { id: 'Europe/Berlin', label: 'Germany — Berlin', abbr: 'CET', long: 'Central European Time' },
  { id: 'Europe/Madrid', label: 'Spain — Madrid', abbr: 'CET', long: 'Central European Time' },
  { id: 'Europe/Athens', label: 'Greece — Athens', abbr: 'EET', long: 'Eastern European Time' },
  { id: 'Asia/Dubai', label: 'UAE — Dubai', abbr: 'GST', long: 'Gulf Time' },
  { id: 'Asia/Kolkata', label: 'India — Kolkata', abbr: 'IST', long: 'India Time' },
  { id: 'Asia/Singapore', label: 'Singapore', abbr: 'SGT', long: 'Singapore Time' },
  { id: 'Asia/Tokyo', label: 'Japan — Tokyo', abbr: 'JST', long: 'Japan Time' },
  { id: 'Australia/Sydney', label: 'Australia — Sydney', abbr: 'AET', long: 'Sydney Time' },
  { id: 'Pacific/Auckland', label: 'New Zealand — Auckland', abbr: 'NZT', long: 'New Zealand Time' },
]

export const DEFAULT_ZONE = 'America/New_York'

const WEEKDAYS = [1, 2, 3, 4, 5]

export const TEAM: TeamMember[] = [
  { id: 'maya', name: 'Maya Cordeira', role: 'Owner', email: 'maya@teamcordeira.com', status: 'active', hours: { start: 9, end: 17, days: WEEKDAYS } },
  { id: 'devon', name: 'Devon Reyes', role: 'Client success', email: 'devon@teamcordeira.com', status: 'active', hours: { start: 9, end: 17, days: WEEKDAYS } },
  { id: 'priya', name: 'Priya Raman', role: 'Operations', email: 'priya@teamcordeira.com', status: 'active', hours: { start: 9, end: 17, days: WEEKDAYS } },
  { id: 'sam', name: 'Sam Whitfield', role: 'Advisor', email: 'sam@teamcordeira.com', status: 'active', hours: { start: 10, end: 16, days: WEEKDAYS } },
  { id: 'nia', name: 'Nia Bekele', role: 'Analyst', email: 'nia@teamcordeira.com', status: 'out-of-office', hours: { start: 9, end: 17, days: WEEKDAYS } },
]

export const DEFAULT_BREAKS: RecurringBreak[] = [
  { id: 'lunch', name: 'Lunch', start: 12, end: 13, days: [1, 2, 3, 4, 5], enabled: true },
  { id: 'focus', name: 'Focus block', start: 8, end: 9, days: [1, 3, 5], enabled: true },
  { id: 'wrap', name: 'End-of-week wrap-up', start: 15, end: 17, days: [5], enabled: false },
]

export const DEFAULT_CONNECTIONS: Connection[] = [
  { provider: 'google', name: 'Google Calendar', tag: 'GC', account: 'maya@teamcordeira.com', enabled: true },
  { provider: 'outlook', name: 'Outlook Calendar', tag: 'OL', account: 'maya.cordeira@outlook.com', enabled: true },
  { provider: 'icloud', name: 'iCloud Calendar', tag: 'IC', account: null, enabled: false },
]

export const DEFAULT_EMAILS: EmailSetting[] = [
  { id: 'confirmation', name: 'Booking confirmation', description: 'Sent immediately, with a calendar invite attached', enabled: true },
  { id: 'reminder-24h', name: 'Reminder — 24 hours before', description: 'To the client and every guest', enabled: true },
  { id: 'reminder-1h', name: 'Reminder — 1 hour before', description: 'Includes the meeting link', enabled: true },
  { id: 'follow-up', name: 'Follow-up after the call', description: 'Sent 2 hours after the end time', enabled: false },
]

export const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 60]

export const DEFAULT_SETTINGS: Settings = {
  connections: DEFAULT_CONNECTIONS,
  emails: DEFAULT_EMAILS,
  conferencing: 'Google Meet',
  bufferMinutes: 15,
  breaks: DEFAULT_BREAKS,
  workingHours: { start: 9, end: 17, days: WEEKDAYS },
  minNoticeHours: 24,
  maxCallsPerDay: 4,
}

/** Sample events for the current week. `d` is 1 = Monday … 7 = Sunday. */
interface Seed {
  user: string
  d: number
  s: number
  e: number
  title: string
  kind: CalendarEvent['kind']
  createdBy?: string
  source?: CalendarEvent['source']
  allDay?: boolean
}

const SEEDS: Seed[] = [
  // Maya (host) — matches the handoff's week view
  { user: 'maya', d: 1, s: 9, e: 9.75, title: 'Intro — J. Alvarez', kind: 'client' },
  { user: 'maya', d: 1, s: 13, e: 14, title: 'Strategy — Lumen Co', kind: 'client' },
  { user: 'maya', d: 2, s: 10.5, e: 11.5, title: 'Prep deck (from Devon)', kind: 'task', createdBy: 'devon' },
  { user: 'maya', d: 2, s: 15, e: 16.5, title: 'Deep Dive — Harbor', kind: 'client' },
  { user: 'maya', d: 3, s: 9, e: 10, title: 'Team standup', kind: 'synced', source: 'google' },
  { user: 'maya', d: 3, s: 14, e: 14.5, title: 'Intro — T. Nakamura', kind: 'client' },
  { user: 'maya', d: 4, s: 11, e: 12, title: 'Quarterly review', kind: 'synced', source: 'outlook' },
  { user: 'maya', d: 4, s: 16, e: 17, title: 'Call notes follow-up', kind: 'task', createdBy: 'priya' },
  { user: 'maya', d: 5, s: 10, e: 11.5, title: 'Strategy — Fieldstone', kind: 'client' },
  // Devon
  { user: 'devon', d: 4, s: 9.5, e: 10.5, title: 'Onboarding — Rivera', kind: 'client' },
  { user: 'devon', d: 4, s: 13, e: 14, title: 'Support review', kind: 'synced', source: 'google' },
  { user: 'devon', d: 2, s: 14, e: 15, title: 'Renewal — Aster', kind: 'client' },
  // Priya — clear today
  { user: 'priya', d: 1, s: 10, e: 11, title: 'Vendor sync', kind: 'synced', source: 'google' },
  { user: 'priya', d: 5, s: 9, e: 9.5, title: 'Ops check-in', kind: 'task', createdBy: 'maya' },
  // Sam
  { user: 'sam', d: 4, s: 10, e: 11.5, title: 'Advisory — Northwind', kind: 'client' },
  { user: 'sam', d: 4, s: 13.5, e: 15, title: 'Advisory — Kestrel', kind: 'client' },
  { user: 'sam', d: 3, s: 11, e: 12, title: 'Board prep', kind: 'synced', source: 'outlook' },
  // Nia — out of office this week
  { user: 'nia', d: 1, s: 0, e: 0, title: 'Out of office', kind: 'synced', source: 'google', allDay: true },
  { user: 'nia', d: 2, s: 0, e: 0, title: 'Out of office', kind: 'synced', source: 'google', allDay: true },
  { user: 'nia', d: 3, s: 0, e: 0, title: 'Out of office', kind: 'synced', source: 'google', allDay: true },
  { user: 'nia', d: 4, s: 0, e: 0, title: 'Out of office', kind: 'synced', source: 'google', allDay: true },
]

export function seedEvents(now: Date = new Date()): CalendarEvent[] {
  const monday = startOfWeek(todayKey(now))
  return SEEDS.map((s, i) => ({
    id: `seed-${i}`,
    userId: s.user,
    dateKey: addDays(monday, s.d - 1),
    start: s.s,
    end: s.e,
    title: s.title,
    kind: s.kind,
    createdBy: s.createdBy,
    source: s.source,
    allDay: s.allDay,
  }))
}
