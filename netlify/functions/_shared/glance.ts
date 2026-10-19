import { completeGoogleTask, getGoogleEvent, getGoogleTask, listEventsBetween, listGoogleTasks, reopenGoogleTask } from './calendar'
import { addDays, zonedDate, zonedParts } from './commandTime'
import { isDemoMode } from './env'
import { completeFubTask, listOpenFubTasksForUser, listRecentNotes, readFubTask, reopenFubTask } from './followupboss'
import { getGoogleConnectionStatus } from './googleAuth'
import type { HubCalendarEvent, HubTask } from './hubTypes'
import { loanOfficer } from './team'

export const GLANCE_TIME_ZONE = 'America/New_York'
export const GLANCE_CACHE_MS = 60_000
const GLANCE_DAYS = 14
const NOTE_PREVIEW = 160

export type GlanceKind = 'task' | 'appointment'
export type GlanceSource = 'google' | 'fub'

export type GlanceItem = {
  key: string
  id: string
  kind: GlanceKind
  source: GlanceSource
  title: string
  whenLabel: string
  dayKey: string
  /** Sort instant. Not shown on the row. */
  at: string
  overdue: boolean
  personId?: number
  personName?: string
}

export type GlanceNote = {
  id: string
  headline: string
  body?: string
  created?: string
  long: boolean
}

export type GlanceDetail = {
  description?: string
  notes?: string
  location?: string
  attendees?: { label: string }[]
  meetLink?: string
  htmlLink?: string
  personNotes?: GlanceNote[]
  notesError?: string
}

export type GlanceBoard = {
  today: GlanceItem[]
  all: GlanceItem[]
  warnings: string[]
  needsTasks: boolean
  todayKey: string
  generatedAt: string
}

/** Joe's Follow Up Boss user. Production id is 1 when FUB_LO_USER_ID is unset. */
export function joeTaskAssigneeId(): number {
  return loanOfficer().userId ?? 1
}

export function etDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = zonedParts(date, GLANCE_TIME_ZONE)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function formatEtClock(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-US', {
    timeZone: GLANCE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/\u202f/g, ' ')
    .replace(/\s+/g, ' ')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function shortMonthDay(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  if (!year || !month || !day) return dayKey
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)))
  return label.replace(/\u202f/g, ' ')
}

function startOfEtDay(now: Date): Date {
  const parts = zonedParts(now, GLANCE_TIME_ZONE)
  return zonedDate({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 }, GLANCE_TIME_ZONE)
}

function endOfGlanceWindow(now: Date): Date {
  const parts = zonedParts(now, GLANCE_TIME_ZONE)
  const next = addDays({ ...parts, hour: 0, minute: 0 }, GLANCE_DAYS, GLANCE_TIME_ZONE)
  return zonedDate({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0 }, GLANCE_TIME_ZONE)
}

type DueInfo = {
  dayKey?: string
  at: string
  timed: boolean
  instant?: Date
}

function googleCivilDue(due: string): boolean {
  return /T00:00:00(\.000)?Z$/.test(due)
}

function taskDue(task: HubTask, source: GlanceSource): DueInfo {
  const due = task.due?.trim()
  if (!due) return { at: '9999-99-99T99:99:99', timed: false }
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { dayKey: due, at: `${due}T23:59:59`, timed: false }
  const instant = new Date(due)
  if (Number.isNaN(instant.getTime())) return { at: '9999-99-99T99:99:99', timed: false }
  if (source === 'google' && googleCivilDue(due)) {
    const dayKey = due.slice(0, 10)
    return { dayKey, at: `${dayKey}T23:59:59`, timed: false }
  }
  const dayKey = etDateKey(instant)
  return { dayKey, at: instant.toISOString(), timed: true, instant }
}

function taskItem(task: HubTask, now: Date, todayKey: string): GlanceItem | null {
  if (task.status === 'completed') return null
  if (completedKeys.has(`${task.source === 'fub' ? 'fub' : 'google'}:${task.id}`)) return null
  const source: GlanceSource = task.source === 'fub' ? 'fub' : 'google'
  const due = taskDue(task, source)
  const overdue = due.timed && due.instant ? due.instant.getTime() < now.getTime() : Boolean(due.dayKey && due.dayKey < todayKey)
  let whenLabel = 'No due date'
  if (due.timed && due.instant) whenLabel = overdue && due.dayKey && due.dayKey < todayKey ? `${shortMonthDay(due.dayKey)}, ${formatEtClock(due.instant)}` : formatEtClock(due.instant)
  else if (due.dayKey) whenLabel = due.dayKey === todayKey ? 'Today' : shortMonthDay(due.dayKey)
  const personId = task.personId && task.personId > 0 ? task.personId : undefined
  return {
    key: `${source}:task:${task.id}`,
    id: task.id,
    kind: 'task',
    source,
    title: task.title.trim() || '(Untitled)',
    whenLabel,
    dayKey: due.dayKey ?? 'none',
    at: due.at,
    overdue,
    personId,
    personName: task.personName?.trim() || undefined,
  }
}

function eventItem(event: HubCalendarEvent, todayKey: string, horizonKey: string): GlanceItem | null {
  const start = new Date(event.startIso)
  if (Number.isNaN(start.getTime())) return null
  const dayKey = event.allDay ? event.startIso.slice(0, 10) : etDateKey(start)
  if (dayKey < todayKey || dayKey >= horizonKey) return null
  return {
    key: `google:appointment:${event.id}`,
    id: event.id,
    kind: 'appointment',
    source: 'google',
    title: event.summary.trim() || '(No title)',
    whenLabel: event.allDay ? 'All day' : formatEtClock(start),
    dayKey,
    at: event.allDay ? `${dayKey}T12:00:00.000Z` : start.toISOString(),
    overdue: false,
  }
}

function sortAll(items: GlanceItem[]): GlanceItem[] {
  return [...items].sort((a, b) => {
    const aNone = a.dayKey === 'none' ? 1 : 0
    const bNone = b.dayKey === 'none' ? 1 : 0
    if (aNone !== bNone) return aNone - bNone
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey)
    return a.at.localeCompare(b.at) || a.title.localeCompare(b.title)
  })
}

function sortToday(items: GlanceItem[]): GlanceItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    return a.at.localeCompare(b.at) || a.title.localeCompare(b.title)
  })
}

export function buildGlanceBoard(input: {
  tasks: HubTask[]
  fubTasks: HubTask[]
  events: HubCalendarEvent[]
  now?: Date
  needsTasks?: boolean
  warnings?: string[]
}): GlanceBoard {
  const now = input.now ?? new Date()
  const todayKey = etDateKey(now)
  const horizonKey = addCivilDays(todayKey, GLANCE_DAYS)
  const tasks = [...input.tasks, ...input.fubTasks]
    .map((task) => taskItem(task, now, todayKey))
    .filter((item): item is GlanceItem => item != null)
  const events = input.events
    .map((event) => eventItem(event, todayKey, horizonKey))
    .filter((item): item is GlanceItem => item != null)
  const all = sortAll([...tasks, ...events])
  const today = sortToday(
    all.filter((item) => (item.kind === 'appointment' ? item.dayKey === todayKey : item.overdue || item.dayKey === todayKey)),
  )
  return {
    today,
    all,
    warnings: input.warnings ?? [],
    needsTasks: input.needsTasks === true,
    todayKey,
    generatedAt: now.toISOString(),
  }
}

function addCivilDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

type Slot<T> = { at: number; value: T }

let boardCache: Slot<GlanceBoard> | null = null
let googleTaskCache: Slot<HubTask[]> | null = null
let fubTaskCache: Slot<HubTask[]> | null = null
let eventCache: Slot<HubCalendarEvent[]> | null = null
const completedKeys = new Set<string>()

function fresh<T>(slot: Slot<T> | null, nowMs: number): slot is Slot<T> {
  return slot != null && nowMs - slot.at < GLANCE_CACHE_MS
}

export function resetGlanceForTests(): void {
  boardCache = null
  googleTaskCache = null
  fubTaskCache = null
  eventCache = null
  completedKeys.clear()
}

/** Drop the assembled board and one source so the next read refetches only that source. */
export function bustGlanceSource(source: GlanceSource): void {
  boardCache = null
  if (source === 'google') googleTaskCache = null
  else fubTaskCache = null
}

export async function loadGlance(now = new Date()): Promise<GlanceBoard> {
  const nowMs = Date.now()
  const userId = joeTaskAssigneeId()
  const googleNow = googleTaskCache
  const fubNow = fubTaskCache
  const eventsNow = eventCache
  const googleCached = fresh(googleNow, nowMs)
  const fubCached = fresh(fubNow, nowMs)
  const eventsCached = fresh(eventsNow, nowMs)
  const [tasksResult, fubResult, eventsResult, googleResult] = await Promise.allSettled([
    googleCached ? Promise.resolve(googleNow.value) : listGoogleTasks(100).then((result) => result.tasks),
    fubCached ? Promise.resolve(fubNow.value) : listOpenFubTasksForUser(userId),
    eventsCached
      ? Promise.resolve(eventsNow.value)
      : listEventsBetween(startOfEtDay(now), endOfGlanceWindow(now)).then((result) => result.events),
    getGoogleConnectionStatus(),
  ])
  if (tasksResult.status === 'fulfilled' && !googleCached) googleTaskCache = { at: Date.now(), value: tasksResult.value }
  if (fubResult.status === 'fulfilled' && !fubCached) fubTaskCache = { at: Date.now(), value: fubResult.value }
  if (eventsResult.status === 'fulfilled' && !eventsCached) eventCache = { at: Date.now(), value: eventsResult.value }
  const warnings: string[] = []
  if (tasksResult.status === 'rejected' || eventsResult.status === 'rejected') warnings.push('Google unavailable')
  if (fubResult.status === 'rejected') warnings.push('Follow Up Boss unavailable')
  return buildGlanceBoard({
    tasks: tasksResult.status === 'fulfilled' ? tasksResult.value : [],
    fubTasks: fubResult.status === 'fulfilled' ? fubResult.value : [],
    events: eventsResult.status === 'fulfilled' ? eventsResult.value : [],
    now,
    needsTasks: googleResult.status === 'fulfilled' ? googleResult.value.needsTasks : false,
    warnings: warnings.filter((warning) => warning === 'Google unavailable' || warning === 'Follow Up Boss unavailable'),
  })
}

export async function getGlanceBoard(now = new Date()): Promise<GlanceBoard> {
  const cached = boardCache
  if (fresh(cached, Date.now())) return cached.value
  const board = await loadGlance(now)
  boardCache = { at: Date.now(), value: board }
  return board
}

function plainText(value: string | undefined): string {
  return (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function noteView(note: { id?: number; subject?: string; body?: string; created?: string }, index: number): GlanceNote {
  const subject = note.subject?.trim()
  const body = plainText(note.body)
  const headline = subject || body.slice(0, 80) || 'Note'
  const rest = subject ? body : body.slice(headline.length).trim()
  return {
    id: String(note.id ?? index),
    headline,
    body: rest || undefined,
    created: note.created,
    long: rest.length > NOTE_PREVIEW,
  }
}

async function personNotes(personId: number | undefined): Promise<{ personNotes?: GlanceNote[]; notesError?: string }> {
  if (!personId || personId <= 0) return {}
  if (isDemoMode()) {
    return {
      personNotes: [
        { id: 'demo-note-1', headline: 'Docs requested', body: 'Pay stubs and two months of bank statements.', long: false },
        {
          id: 'demo-note-2',
          headline: 'Older rate conversation',
          body: 'They asked about a refinance and want a call before anything is quoted. '.repeat(6).trim(),
          long: true,
        },
        { id: 'demo-note-3', headline: 'First inquiry', body: 'Inbound from the website form.', long: false },
      ],
    }
  }
  try {
    const notes = await listRecentNotes(personId)
    return { personNotes: notes.slice(0, 8).map(noteView) }
  } catch {
    return { notesError: 'Notes unavailable' }
  }
}

export async function getGlanceDetail(query: {
  source: GlanceSource
  kind: GlanceKind
  id: string
  personId?: number
}): Promise<GlanceDetail> {
  const personId = query.personId && query.personId > 0 ? query.personId : undefined
  if (query.kind === 'appointment') {
    const event = await getGoogleEvent(query.id)
    const notes = await personNotes(personId)
    return {
      description: event?.description?.trim() || undefined,
      location: event?.location?.trim() || undefined,
      attendees: event?.attendees
        ?.map((attendee) => ({ label: attendee.displayName?.trim() || attendee.email }))
        .filter((attendee) => attendee.label),
      meetLink: event?.meetLink,
      htmlLink: event?.htmlLink,
      ...notes,
    }
  }
  if (query.source === 'fub') {
    let description: string | undefined
    let linked = personId
    if (!isDemoMode()) {
      try {
        const task = await readFubTask(query.id)
        description = task?.description?.trim() || undefined
        if (!linked && task?.personId && task.personId > 0) linked = task.personId
      } catch {
        description = undefined
      }
    }
    const notes = await personNotes(linked ?? (isDemoMode() ? 1 : undefined))
    return { description, ...notes }
  }
  const task = await getGoogleTask(query.id)
  const notes = await personNotes(personId)
  return {
    notes: task?.notes?.trim() || undefined,
    ...notes,
  }
}

function taskKey(source: GlanceSource, id: string): string {
  return `${source}:${id.trim()}`
}

export async function completeGlanceTask(input: { source: GlanceSource; id: string }): Promise<{ done: true }> {
  const id = input.id.trim()
  if (!id) throw new Error('Task id is required')
  if (input.source === 'google') await completeGoogleTask(id)
  else await completeFubTask(id)
  completedKeys.add(taskKey(input.source, id))
  bustGlanceSource(input.source)
  return { done: true }
}

export async function undoGlanceTask(input: { source: GlanceSource; id: string }): Promise<{ done: true }> {
  const id = input.id.trim()
  if (!id) throw new Error('Task id is required')
  if (input.source === 'google') await reopenGoogleTask(id)
  else await reopenFubTask(id)
  completedKeys.delete(taskKey(input.source, id))
  bustGlanceSource(input.source)
  return { done: true }
}
