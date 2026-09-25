import { env } from './env'
import { resolveGoogleAccessToken } from './googleAuth'
import { loadHubExtras, rememberHubEvent, rememberHubTask } from './hubExtras'
import type { HubCalendarEvent, HubTask } from './hubTypes'
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
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

function mapGCal(item: GCalEvent): HubCalendarEvent | null {
  if (!item.id || item.status === 'cancelled') return null
  const startRaw = item.start?.dateTime ?? item.start?.date
  const endRaw = item.end?.dateTime ?? item.end?.date
  if (!startRaw || !endRaw) return null
  const allDay = Boolean(item.start?.date && !item.start.dateTime)
  const startIso = allDay ? new Date(`${startRaw}T00:00:00`).toISOString() : new Date(startRaw).toISOString()
  const endIso = allDay ? new Date(`${endRaw}T00:00:00`).toISOString() : new Date(endRaw).toISOString()
  if (Number.isNaN(new Date(startIso).getTime())) return null
  return {
    id: item.id,
    summary: item.summary?.trim() || '(No title)',
    description: item.description,
    htmlLink: item.htmlLink,
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
    const extras = (await loadHubExtras()).events.filter((event) => inWindow(event.startIso, now, safeDays))
    const events = [...extras, ...demoUpcomingEvents(now, safeDays)]
    const seen = new Set<string>()
    return {
      demo: true,
      events: events
        .filter((event) => {
          if (seen.has(event.id)) return false
          seen.add(event.id)
          return true
        })
        .sort((a, b) => a.startIso.localeCompare(b.startIso)),
    }
  }

  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + safeDays * 86_400_000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '40',
  })
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(await googleError(res, 'Calendar list'))
  const data = (await res.json()) as { items?: GCalEvent[] }
  const events = (data.items ?? [])
    .map(mapGCal)
    .filter((event): event is HubCalendarEvent => event != null)
  return { events, demo: false }
}

export async function listGoogleTasks(): Promise<{ tasks: HubTask[]; demo: boolean }> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
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

export async function createCalendarEvent(input: {
  summary: string
  description?: string
  startIso: string
  endIso: string
  attendeeEmail?: string
}): Promise<{ id: string; htmlLink?: string }> {
  const { accessToken: token } = await resolveGoogleAccessToken()
  if (!token) {
    const id = nextDemoId('cal-demo')
    await rememberHubEvent({
      id,
      summary: input.summary,
      description: input.description,
      startIso: input.startIso,
      endIso: input.endIso,
      htmlLink: 'https://calendar.google.com/',
      allDay: false,
      source: 'demo',
    })
    return { id, htmlLink: 'https://calendar.google.com/' }
  }

  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
    }),
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
