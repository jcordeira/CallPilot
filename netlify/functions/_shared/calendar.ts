import { env, isDemoMode } from './env'
import { resolveGoogleAccessToken } from './googleAuth'
import { forgetHubEvent, loadHubExtras, rememberHubEvent, rememberHubTask } from './hubExtras'
import type { CalendarAttendee, HubCalendarEvent, HubTask } from './hubTypes'
import { shiftDateKey } from './hubTypes'

let demoSeq = 0

function nextDemoId(prefix: string): string {
  demoSeq += 1
  return `${prefix}-${Date.now()}-${demoSeq}`
}

function inWindow(startIso: string, now: Date, days: number): boolean {
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return false
  const horizon = now.getTime() + days * 86_400_000
  return start >= now.getTime() - 60_000 && start < horizon
}

function atLocal(base: Date, dayOffset: number, hour: number, minute: number): Date {
  const d = new Date(base.getTime())
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d
}

async function googleError(res: Response, label: string): Promise<string> {
  const text = (await res.text()).slice(0, 300)
  return `${label} failed: ${res.status} ${text}`
}

/** Sample events for the next few days. Pure — pass `now` in tests. */
export function demoUpcomingEvents(now = new Date(), days = 7): HubCalendarEvent[] {
  const specs: { day: number; hour: number; minute: number; summary: string; description: string }[] = [
    {
      day: 0,
      hour: 14,
      minute: 0,
      summary: 'Call: Jordan Hale',
      description: 'Pre-approval questions. Confirm documents before the call.',
    },
    {
      day: 1,
      hour: 10,
      minute: 0,
      summary: 'Call: Alex Buyer',
      description: 'Walk through the pre-approval checklist.',
    },
    {
      day: 3,
      hour: 11,
      minute: 30,
      summary: 'Rate review: Sam Ortiz',
      description: 'Refinance scenario. Do not quote a lock until you confirm.',
    },
  ]

  return specs
    .flatMap((spec) => {
      const start = atLocal(now, spec.day, spec.hour, spec.minute)
      const end = new Date(start.getTime() + 30 * 60_000)
      const event: HubCalendarEvent = {
        id: `cal-demo-${spec.day}-${spec.hour}`,
        summary: spec.summary,
        description: spec.description,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        allDay: false,
        source: 'demo',
      }
      return inWindow(event.startIso, now, days) ? [event] : []
    })
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/** Sample open Google Tasks. Pure — pass `now` in tests. */
export function demoGoogleTasks(now = new Date()): HubTask[] {
  return [
    {
      id: 'gtask-demo-review',
      title: 'Review rate-lock question before replying',
      notes: 'Escalate lock requests. Do not quote a lock in writing.',
      due: shiftDateKey(now, 0),
      status: 'needsAction',
      source: 'demo',
    },
    {
      id: 'gtask-demo-docs',
      title: 'Send pre-approval checklist to Alex Buyer',
      notes: 'Pay stubs, W-2s, and two months of bank statements.',
      due: shiftDateKey(now, 1),
      status: 'needsAction',
      source: 'demo',
    },
    {
      id: 'gtask-demo-call',
      title: 'Confirm refinance call with Jordan Hale',
      notes: 'They asked for a call. Hold the slot before quoting anything.',
      due: shiftDateKey(now, 2),
      status: 'needsAction',
      source: 'demo',
    },
  ]
}

type GCalEvent = {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: CalendarAttendee[]
}

export const CALENDAR_TIME_ZONE = 'America/New_York'

export function mergeAttendees(existing: CalendarAttendee[] | undefined, emails: string[]): CalendarAttendee[] {
  const wanted = [...new Set(emails.map((email) => email.trim()).filter(Boolean))]
  const byEmail = new Map((existing ?? []).map((attendee) => [attendee.email.toLowerCase(), attendee]))
  return wanted.map((email) => {
    const prev = byEmail.get(email.toLowerCase())
    if (!prev) return { email }
    return {
      email: prev.email,
      ...(prev.displayName ? { displayName: prev.displayName } : {}),
      ...(prev.responseStatus ? { responseStatus: prev.responseStatus } : {}),
      ...(prev.optional ? { optional: true } : {}),
    }
  })
}

function dateOnly(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match?.[1] ?? value.slice(0, 10)
}

function addUtcDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/** Google all-day `end.date` is exclusive. A same-day end becomes the next date. */
export function exclusiveEndDate(startIso: string, endIso: string): string {
  const startDate = dateOnly(startIso)
  const endDate = dateOnly(endIso)
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > startDate) return endDate
  return addUtcDays(startDate, 1)
}

/** Local wall clock without a Z suffix. Google rejects a UTC dateTime paired with timeZone. */
export function googleWallDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.replace(/\.\d{3}Z$/, '').replace(/Z$/, '')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`
}

export function calendarWriteBody(input: {
  summary: string
  description?: string
  location?: string
  startIso: string
  endIso: string
  allDay?: boolean
  attendees?: CalendarAttendee[]
  timeZone?: string
  /** PATCH should clear the other Google start/end field when switching timed ↔ all-day. */
  patch?: boolean
}): Record<string, unknown> {
  const timeZone = input.timeZone || CALENDAR_TIME_ZONE
  const start = input.allDay
    ? { date: dateOnly(input.startIso), ...(input.patch ? { dateTime: null } : {}) }
    : { dateTime: googleWallDateTime(input.startIso, timeZone), timeZone, ...(input.patch ? { date: null } : {}) }
  const end = input.allDay
    ? { date: exclusiveEndDate(input.startIso, input.endIso), ...(input.patch ? { dateTime: null } : {}) }
    : { dateTime: googleWallDateTime(input.endIso, timeZone), timeZone, ...(input.patch ? { date: null } : {}) }
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start,
    end,
  }
  if (input.location != null) body.location = input.location
  if (input.attendees) {
    body.attendees = input.attendees.map((attendee) => ({
      email: attendee.email,
      ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
      ...(attendee.responseStatus ? { responseStatus: attendee.responseStatus } : {}),
      ...(attendee.optional ? { optional: true } : {}),
    }))
  }
  return body
}

function mapGCal(item: GCalEvent): HubCalendarEvent | null {
  if (!item.id || item.status === 'cancelled') return null
  const startRaw = item.start?.dateTime ?? item.start?.date
  const endRaw = item.end?.dateTime ?? item.end?.date
  if (!startRaw || !endRaw) return null
  const allDay = Boolean(item.start?.date && !item.start.dateTime)
  // Noon UTC keeps the Google civil date on the Eastern calendar day.
  const startIso = allDay ? `${dateOnly(startRaw)}T12:00:00.000Z` : new Date(startRaw).toISOString()
  const endIso = allDay ? `${dateOnly(endRaw)}T12:00:00.000Z` : new Date(endRaw).toISOString()
  if (Number.isNaN(new Date(startIso).getTime())) return null
  return {
    id: item.id,
    summary: item.summary?.trim() || '(No title)',
    description: item.description,
    location: item.location,
    htmlLink: item.htmlLink,
    attendees: item.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      optional: attendee.optional,
      self: attendee.self,
      organizer: attendee.organizer,
    })),
    startIso,
    endIso,
    allDay,
    source: 'google',
  }
}

type GTask = {
  id?: string
  title?: string
  notes?: string
  status?: string
  due?: string
}

function dueKey(due?: string): string | undefined {
  if (!due) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due
  const parsed = new Date(due)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

function toGoogleDue(due?: string): string | undefined {
  if (!due) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return `${due}T00:00:00.000Z`
  const parsed = new Date(due)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function mapGTask(item: GTask): HubTask | null {
  if (!item.id) return null
  const status = item.status === 'completed' ? 'completed' : 'needsAction'
  return {
    id: item.id,
    title: item.title?.trim() || '(Untitled)',
    notes: item.notes,
    due: dueKey(item.due),
    status,
    source: 'google',
  }
}

export async function listUpcomingEvents(days = 7): Promise<{ events: HubCalendarEvent[]; demo: boolean }> {
  const safeDays = Math.min(30, Math.max(1, Math.floor(days) || 7))
  const now = new Date()
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) return { events: [], demo: false }
    const stored = await loadHubExtras()
    const hidden = new Set(stored.hiddenEventIds ?? [])
    const extras = stored.events.filter((event) => inWindow(event.startIso, now, safeDays))
    const events = [...extras, ...demoUpcomingEvents(now, safeDays)]
    const seen = new Set<string>()
    return {
      demo: true,
      events: events
        .filter((event) => {
          if (hidden.has(event.id) || seen.has(event.id)) return false
          seen.add(event.id)
          return true
        })
        .sort((a, b) => a.startIso.localeCompare(b.startIso)),
    }
  }

  const events = await listGoogleEvents(now.toISOString(), new Date(now.getTime() + safeDays * 86_400_000).toISOString(), 40)
  return { events, demo: false }
}

export async function listGoogleTasks(): Promise<{ tasks: HubTask[]; demo: boolean }> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) return { tasks: [], demo: false }
    const seen = new Set<string>()
    const tasks = [...(await loadHubExtras()).tasks, ...demoGoogleTasks()].filter((task) => {
      if (task.status === 'completed' || seen.has(task.id)) return false
      seen.add(task.id)
      return true
    })
    tasks.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title))
    return { tasks, demo: true }
  }

  const listId = encodeURIComponent(env('GOOGLE_TASKS_LIST_ID', '@default'))
  const params = new URLSearchParams({
    showCompleted: 'false',
    showHidden: 'false',
    maxResults: '40',
  })
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await googleError(res, 'Google Tasks list'))
  const data = (await res.json()) as { items?: GTask[] }
  const tasks = (data.items ?? [])
    .map(mapGTask)
    .filter((task): task is HubTask => task != null && task.status !== 'completed')
  return { tasks, demo: false }
}

export async function createGoogleTask(input: {
  title: string
  notes?: string
  due?: string
}): Promise<HubTask> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  const due = dueKey(input.due)
  if (!token) {
    if (!isDemoMode()) throw new Error('Google Tasks is not connected')
    const task: HubTask = {
      id: nextDemoId('gtask-demo'),
      title: input.title,
      notes: input.notes,
      due,
      status: 'needsAction',
      source: 'demo',
    }
    await rememberHubTask(task)
    return task
  }

  const listId = encodeURIComponent(env('GOOGLE_TASKS_LIST_ID', '@default'))
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      notes: input.notes,
      due: toGoogleDue(input.due),
    }),
  })
  if (!res.ok) throw new Error(await googleError(res, 'Google Tasks create'))
  const mapped = mapGTask((await res.json()) as GTask)
  if (!mapped) throw new Error('Google Tasks create returned no task')
  return mapped
}

async function calendarFetch(pathAndQuery: string, init?: RequestInit): Promise<Response> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) throw new Error('Google Calendar is not connected')
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

function guestEmails(input: { attendees?: string[]; attendeeEmail?: string }): string[] {
  return [...new Set([...(input.attendees ?? []), ...(input.attendeeEmail ? [input.attendeeEmail] : [])].map((email) => email.trim()).filter(Boolean))]
}

export async function createCalendarEvent(input: {
  summary: string
  description?: string
  location?: string
  startIso: string
  endIso: string
  allDay?: boolean
  attendeeEmail?: string
  attendees?: string[]
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  timeZone?: string
}): Promise<{ id: string; htmlLink?: string }> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) throw new Error('Google Calendar is not connected')
    const id = nextDemoId('cal-demo')
    const emails = guestEmails(input)
    await rememberHubEvent({
      id,
      summary: input.summary,
      description: input.description,
      location: input.location,
      startIso: input.startIso,
      endIso: input.endIso,
      htmlLink: 'https://calendar.google.com/',
      allDay: input.allDay === true,
      source: 'demo',
      attendees: emails.map((email) => ({ email })),
    })
    return { id, htmlLink: 'https://calendar.google.com/' }
  }

  const emails = guestEmails(input)
  const params = input.sendUpdates ? `?sendUpdates=${input.sendUpdates}` : ''
  const res = await calendarFetch(`/events${params}`, {
    method: 'POST',
    body: JSON.stringify(
      calendarWriteBody({
        summary: input.summary,
        description: input.description,
        location: input.location,
        startIso: input.startIso,
        endIso: input.endIso,
        allDay: input.allDay === true,
        timeZone: input.timeZone ?? env('COMMAND_TIMEZONE', CALENDAR_TIME_ZONE),
        attendees: emails.length ? emails.map((email) => ({ email })) : undefined,
      }),
    ),
  })
  if (!res.ok) throw new Error(await googleError(res, 'Calendar create'))
  const data = (await res.json()) as { id: string; htmlLink?: string }
  return { id: data.id, htmlLink: data.htmlLink }
}

/** Hold a follow-up block on the LO calendar when a lead asks to talk. */
export async function holdFollowUpSlot(input: {
  leadName: string
  hint?: string
  attendeeEmail?: string
}): Promise<{ id: string; htmlLink?: string; startIso: string }> {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(10, 0, 0, 0)
  // Skip weekends
  if (start.getDay() === 0) start.setDate(start.getDate() + 1)
  if (start.getDay() === 6) start.setDate(start.getDate() + 2)
  const end = new Date(start.getTime() + 30 * 60_000)
  const event = await createCalendarEvent({
    summary: `Call: ${input.leadName}`,
    description: input.hint ?? 'AI assistant held this slot from a lead message. Confirm or reschedule.',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    attendeeEmail: input.attendeeEmail,
  })
  return { ...event, startIso: start.toISOString() }
}

async function listGoogleEvents(timeMin: string, timeMax: string, max = 250): Promise<HubCalendarEvent[]> {
  const events: HubCalendarEvent[] = []
  let pageToken = ''
  for (let page = 0; page < 5 && events.length < max; page += 1) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      showDeleted: 'false',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await calendarFetch(`/events?${params}`)
    if (!res.ok) throw new Error(await googleError(res, 'Calendar list'))
    const data = (await res.json()) as { items?: GCalEvent[]; nextPageToken?: string }
    for (const item of data.items ?? []) {
      const mapped = mapGCal(item)
      if (mapped) events.push(mapped)
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return events.slice(0, max)
}

function overlaps(event: HubCalendarEvent, start: Date, end: Date): boolean {
  const a = new Date(event.startIso).getTime()
  const b = new Date(event.endIso).getTime()
  return a < end.getTime() && b > start.getTime()
}

export async function listEventsBetween(start: Date, end: Date): Promise<{ events: HubCalendarEvent[]; demo: boolean }> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) return { events: [], demo: false }
    const extras = await loadHubExtras()
    const hidden = new Set(extras.hiddenEventIds ?? [])
    const span = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1)
    const merged = [...extras.events, ...demoUpcomingEvents(start, span)]
    const seen = new Set<string>()
    const events = merged
      .filter((event) => {
        if (hidden.has(event.id) || seen.has(event.id) || !overlaps(event, start, end)) return false
        seen.add(event.id)
        return true
      })
      .sort((a, b) => a.startIso.localeCompare(b.startIso))
    return { events, demo: true }
  }
  const events = await listGoogleEvents(start.toISOString(), end.toISOString())
  return { events, demo: false }
}

export async function updateCalendarEvent(input: {
  id: string
  summary: string
  description?: string
  location?: string
  startIso: string
  endIso: string
  allDay?: boolean
  attendees?: string[]
  existingAttendees?: CalendarAttendee[]
  sendUpdates?: 'all' | 'none' | 'externalOnly'
  timeZone?: string
}): Promise<HubCalendarEvent> {
  const attendees = input.attendees ? mergeAttendees(input.existingAttendees, input.attendees) : undefined
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) throw new Error('Google Calendar is not connected')
    const event: HubCalendarEvent = {
      id: input.id,
      summary: input.summary,
      description: input.description,
      location: input.location,
      startIso: input.startIso,
      endIso: input.endIso,
      allDay: input.allDay === true,
      source: 'demo',
      attendees,
    }
    await rememberHubEvent(event)
    return event
  }
  const sendUpdates = input.sendUpdates ?? 'none'
  const res = await calendarFetch(`/events/${encodeURIComponent(input.id)}?sendUpdates=${sendUpdates}`, {
    method: 'PATCH',
    body: JSON.stringify(
      calendarWriteBody({
        summary: input.summary,
        description: input.description,
        location: input.location ?? '',
        startIso: input.startIso,
        endIso: input.endIso,
        allDay: input.allDay === true,
        patch: true,
        timeZone: input.timeZone ?? CALENDAR_TIME_ZONE,
        attendees,
      }),
    ),
  })
  if (!res.ok) throw new Error(await googleError(res, 'Calendar update'))
  const mapped = mapGCal((await res.json()) as GCalEvent)
  if (!mapped) throw new Error('Calendar update returned no event')
  return mapped
}

export async function deleteCalendarEvent(id: string, sendUpdates: 'all' | 'none' | 'externalOnly' = 'none'): Promise<void> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    if (!isDemoMode()) throw new Error('Google Calendar is not connected')
    await forgetHubEvent(id)
    return
  }
  const res = await calendarFetch(`/events/${encodeURIComponent(id)}?sendUpdates=${sendUpdates}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 410) throw new Error(await googleError(res, 'Calendar delete'))
}
