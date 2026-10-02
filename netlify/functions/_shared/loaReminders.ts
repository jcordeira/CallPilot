import { listGoogleTasks } from './calendar'
import { env, isDemoMode } from './env'
import { addNote, fubGet } from './followupboss'
import { loadReminderState, saveReminderState, type ReminderLog, type ReminderState } from './loaReminderStore'
import { sendSmsIfConfigured } from './quo'
import { loanOfficer, loanOfficerAssistant } from './team'

/**
 * Follow Up Boss @mention contract
 * --------------------------------
 * Official POST /v1/notes schema (https://docs.followupboss.com/reference/notes-post)
 * accepts only personId, subject, body, and isHtml. There is no documented mentions field.
 * The Help Center "Team Mentions" article says typing @ in the yellow note emails that person:
 * https://help.followupboss.com/hc/en-us/articles/4402379946007-Team-Mentions
 *
 * A public integration smoke-tested the live API on 2026-05-06
 * (github.com/sarathkumar365/FUB-Automation, Docs/features/agent-followup-enforcement/plan.md):
 * - Plain `@Name` (notes 21233 / 21234) renders as text and does not notify.
 * - `mentions.user` without a span (notes 21255 / 21256) can add a collaborator and does not email.
 * - The shape the FUB app itself posts does both, and the chip + notification fired (note 21240):
 *     isHtml: true
 *     mentions: { user: [16] }
 *     body: <p><span data-user-id="16">Frankie Cordeira</span> …</p>
 * The span text is the display name, not `@Name`. Mentioning an agent also adds them as a collaborator.
 */

export const FUB_MENTION_NOTE_SUBJECT = 'LoanPilot reminder'

export const GOOGLE_MISSED_CALLS_NOTE =
  'Google Calendar has no missed-call feed in LoanPilot. The loan officer digest includes overdue Google Tasks. Past calendar events are not treated as missed calls.'

const DEFAULT_LOOKBACK_HOURS = 24
const DEFAULT_TEXT_WINDOW_MINUTES = 120
const DEFAULT_CALL_GRACE_MINUTES = 15
const DEFAULT_MAX_NOTES = 15
const DEFAULT_MAX_PEOPLE = 8
const DEFAULT_TIMEZONE = 'America/New_York'
const PERSON_URL_BASE = 'https://teamcordeira.followupboss.com/2/people/view'
const MAX_REMINDED = 4000
const MAX_RECENT = 40
const MISSED_CALL_OUTCOMES = new Set([
  'no answer',
  'left message',
  'busy',
  'missed',
  'voicemail',
  'left voicemail',
  'noanswer',
])

export type ReminderSeat = {
  role: 'lo' | 'loa'
  userId: number
  name: string
  phone?: string
  /** LOA notes @mention them. The loan officer gets SMS only. */
  fubNote: boolean
}

export type ReminderTask = {
  id: number
  name?: string
  isCompleted?: boolean | number | string
  dueDate?: string
  dueDateTime?: string
  personId?: number
  personName?: string
  assignedUserId?: number
}

export type ReminderPerson = {
  id: number
  name?: string
  assignedUserId?: number
}

export type ReminderText = {
  id: number
  personId?: number
  isIncoming?: boolean | number | string
  created?: string
  sent?: string
  message?: string
}

export type ReminderCall = {
  id: number
  personId?: number
  isIncoming?: boolean | number | string
  outcome?: string | null
  duration?: number | null
  created?: string
}

export type ReminderGoogleTask = {
  id: string
  title?: string
  due?: string
  status?: string
}

export type ReminderSource = {
  tasks: ReminderTask[]
  people: ReminderPerson[]
  texts: ReminderText[]
  calls: ReminderCall[]
  googleTasks: ReminderGoogleTask[]
}

export type MissedKind = 'task' | 'text' | 'call' | 'google_task'

export type MissedItem = {
  key: string
  kind: MissedKind
  seatUserId: number
  personId?: number
  personName: string
  title: string
  line: string
  missedAt: string
  href?: string
}

export type NotePayload = {
  personId: number
  subject: string
  body: string
  isHtml: true
  mentionUserIds: number[]
}

export type Delivery = {
  seatUserId: number
  seatName: string
  seatRole: 'lo' | 'loa'
  channel: 'note' | 'sms'
  personId?: number
  personName?: string
  summary: string
  itemKeys: string[]
  smsBody?: string
  phoneLast4?: string
  status: 'preview' | 'sent' | 'skipped' | 'error'
  error?: string
}

export type ReminderRunResult = {
  ok: true
  skipped?: 'disabled' | 'demo'
  enabled: boolean
  dryRun: boolean
  trigger: string
  watermark?: string
  deliveries: Delivery[]
  deferred: number
  warnings: string[]
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

type PostNote = (input: NotePayload) => Promise<void>
type SendText = (input: { to: string; content: string }) => Promise<{ id: string } | { skipped: 'not_configured' }>

export function remindersEnabled(): boolean {
  return env('LOA_REMINDERS_ENABLED', 'false').trim().toLowerCase() === 'true'
}

export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+') && digits.length >= 8) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return undefined
}

function intEnv(key: string, fallback: number): number {
  const parsed = Number(env(key).trim())
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function reminderSettings() {
  return {
    lookbackHours: intEnv('LOA_REMINDER_LOOKBACK_HOURS', DEFAULT_LOOKBACK_HOURS),
    textWindowMinutes: intEnv('LOA_REMINDER_TEXT_WINDOW_MINUTES', DEFAULT_TEXT_WINDOW_MINUTES),
    callGraceMinutes: intEnv('LOA_REMINDER_CALL_GRACE_MINUTES', DEFAULT_CALL_GRACE_MINUTES),
    maxNotes: intEnv('LOA_REMINDER_MAX_NOTES', DEFAULT_MAX_NOTES),
    maxPeople: intEnv('LOA_REMINDER_MAX_PEOPLE', DEFAULT_MAX_PEOPLE),
    timezone: env('LOA_REMINDER_TIMEZONE', DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    dryRun: env('LOA_REMINDERS_DRY_RUN', 'false').trim().toLowerCase() === 'true',
  }
}

function userIdList(key: string): number[] {
  return env(key)
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
}

/** LO + every configured LOA. Routing still uses the single FUB_LOA_USER_ID. */
export function reminderSeats(): ReminderSeat[] {
  const seats: ReminderSeat[] = []
  const lo = loanOfficer()
  const loPhone = normalizePhone(env('FUB_LO_PHONE'))
  if (lo.userId || loPhone) {
    seats.push({
      role: 'lo',
      userId: lo.userId ?? 0,
      name: lo.name,
      phone: loPhone,
      fubNote: false,
    })
  }

  const assistant = loanOfficerAssistant()
  const ids = new Set<number>(userIdList('FUB_LOA_USER_IDS'))
  if (assistant.userId) ids.add(assistant.userId)
  for (const userId of ids) {
    const named = env(`FUB_LOA_NAME_${userId}`).trim()
    const phone =
      normalizePhone(env(`FUB_LOA_PHONE_${userId}`)) ??
      (assistant.userId === userId ? normalizePhone(env('FUB_LOA_PHONE')) : undefined)
    seats.push({
      role: 'loa',
      userId,
      name: named || (assistant.userId === userId ? assistant.name : `LOA ${userId}`),
      phone,
      fubNote: true,
    })
  }
  return seats
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function mentionNoteHtml(userId: number, name: string, lines: string[]): string {
  const items = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
  return `<p><span data-user-id="${userId}">${escapeHtml(name)}</span> LoanPilot reminder — this lead still needs you:</p><ul>${items}</ul>`
}

export function personLink(personId: number): string {
  const base = env('FUB_PERSON_URL_BASE', PERSON_URL_BASE).replace(/\/$/, '')
  return `${base}/${personId}`
}

/** Convert a wall-clock time in `timeZone` to UTC. */
export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcGuess))
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  let zonedHour = read('hour')
  if (zonedHour === 24) zonedHour = 0
  const zonedAsUtc = Date.UTC(read('year'), read('month') - 1, read('day'), zonedHour, read('minute'), read('second'))
  return new Date(utcGuess - (zonedAsUtc - utcGuess))
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return parts
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return next.toISOString().slice(0, 10)
}

function taskDone(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

/** Date-only tasks become missed at local midnight after the due date. A timestamp is missed when it is past. */
export function taskMissedAt(task: { dueDate?: string; dueDateTime?: string; isCompleted?: unknown }, now: Date, timeZone: string): Date | null {
  if (taskDone(task.isCompleted)) return null
  if (task.dueDateTime) {
    const at = new Date(task.dueDateTime)
    if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime()) return null
    return at
  }
  const due = task.dueDate?.slice(0, 10)
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  if (due >= localDateKey(now, timeZone)) return null
  return zonedDateTimeToUtc(nextDateKey(due), '00:00:00', timeZone)
}

function incomingFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return null
}

function stamp(value: string | undefined): number | null {
  if (!value) return null
  const at = new Date(value).getTime()
  return Number.isNaN(at) ? null : at
}

function textAt(text: ReminderText): number | null {
  return stamp(text.sent) ?? stamp(text.created)
}

function callAt(call: ReminderCall): number | null {
  return stamp(call.created)
}

export function isMissedInboundCall(call: ReminderCall, now: Date, graceMinutes: number): boolean {
  if (incomingFlag(call.isIncoming) !== true) return false
  if (!call.personId || call.personId <= 0) return false
  const at = callAt(call)
  if (at == null || at > now.getTime()) return false
  const outcome = (call.outcome ?? '').trim().toLowerCase()
  if (outcome) return MISSED_CALL_OUTCOMES.has(outcome)
  const duration = call.duration
  const unanswered = duration == null || duration === 0
  if (!unanswered) return false
  return now.getTime() - at >= graceMinutes * 60_000
}

function followedUp(personId: number, after: number, texts: ReminderText[], calls: ReminderCall[]): boolean {
  for (const text of texts) {
    if (text.personId !== personId || incomingFlag(text.isIncoming) !== false) continue
    const at = textAt(text)
    if (at != null && at > after) return true
  }
  for (const call of calls) {
    if (call.personId !== personId || incomingFlag(call.isIncoming) !== false) continue
    const at = callAt(call)
    if (at != null && at > after) return true
  }
  return false
}

/** Latest inbound in the current unanswered streak, once the reply window has elapsed. A newer inbound starts a new window. */
export function unansweredText(texts: ReminderText[], calls: ReminderCall[], personId: number, now: Date, windowMinutes: number): ReminderText | null {
  type Point = { at: number; incoming: boolean; text?: ReminderText }
  const points: Point[] = []
  for (const text of texts) {
    if (text.personId !== personId) continue
    const incoming = incomingFlag(text.isIncoming)
    const at = textAt(text)
    if (incoming == null || at == null) continue
    points.push({ at, incoming, text })
  }
  for (const call of calls) {
    if (call.personId !== personId || incomingFlag(call.isIncoming) !== false) continue
    const at = callAt(call)
    if (at == null) continue
    points.push({ at, incoming: false })
  }
  points.sort((a, b) => a.at - b.at)
  let open: ReminderText | null = null
  for (const point of points) {
    if (point.incoming && point.text) open = point.text
    else open = null
  }
  if (!open) return null
  const at = textAt(open)
  if (at == null || now.getTime() - at < windowMinutes * 60_000) return null
  return open
}

function nameFor(personId: number | undefined, people: ReminderPerson[], fallback?: string): string {
  if (personId != null) {
    const found = people.find((person) => person.id === personId)
    if (found?.name?.trim()) return found.name.trim()
  }
  if (fallback?.trim()) return fallback.trim()
  return personId ? `Lead ${personId}` : 'Lead'
}

function assignedTo(personId: number | undefined, people: ReminderPerson[]): number | undefined {
  if (personId == null) return undefined
  return people.find((person) => person.id === personId)?.assignedUserId
}

export function collectMissedItems(input: {
  seats: ReminderSeat[]
  source: ReminderSource
  now: Date
  cutoff: Date
  timeZone: string
  textWindowMinutes: number
  callGraceMinutes: number
  already: Record<string, string>
}): MissedItem[] {
  const items: MissedItem[] = []
  const seen = new Set<string>()
  const loaIds = new Set(input.seats.filter((seat) => seat.role === 'loa' && seat.userId > 0).map((seat) => seat.userId))
  const lo = input.seats.find((seat) => seat.role === 'lo' && seat.userId > 0)

  const push = (item: MissedItem) => {
    const at = new Date(item.missedAt).getTime()
    if (Number.isNaN(at) || at < input.cutoff.getTime() || at > input.now.getTime()) return
    if (input.already[item.key] || seen.has(item.key)) return
    seen.add(item.key)
    items.push(item)
  }

  for (const task of input.source.tasks) {
    const missed = taskMissedAt(task, input.now, input.timeZone)
    if (!missed || task.assignedUserId == null) continue
    const seat = input.seats.find((candidate) => candidate.userId === task.assignedUserId)
    if (!seat) continue
    const personName = nameFor(task.personId, input.source.people, task.personName)
    const title = task.name?.trim() || 'Follow up'
    push({
      key: `fub-task:${task.id}`,
      kind: 'task',
      seatUserId: seat.userId,
      personId: task.personId && task.personId > 0 ? task.personId : undefined,
      personName,
      title,
      line: `Overdue task: ${title}${task.dueDate ? ` (due ${task.dueDate.slice(0, 10)})` : ''}`,
      missedAt: missed.toISOString(),
      href: task.personId && task.personId > 0 ? personLink(task.personId) : undefined,
    })
  }

  const personIds = new Set<number>()
  for (const person of input.source.people) personIds.add(person.id)
  for (const text of input.source.texts) if (text.personId) personIds.add(text.personId)
  for (const call of input.source.calls) if (call.personId) personIds.add(call.personId)

  for (const personId of personIds) {
    const owner = assignedTo(personId, input.source.people)
    if (owner == null) continue
    const seatIsLoa = loaIds.has(owner)
    const seatIsLo = lo?.userId === owner
    if (!seatIsLoa && !seatIsLo) continue
    const personName = nameFor(personId, input.source.people)

    if (seatIsLoa) {
      const text = unansweredText(input.source.texts, input.source.calls, personId, input.now, input.textWindowMinutes)
      const at = text ? textAt(text) : null
      if (text && at != null) {
        push({
          key: `fub-text:${text.id}`,
          kind: 'text',
          seatUserId: owner,
          personId,
          personName,
          title: 'Unanswered text',
          line: 'Unanswered inbound text',
          missedAt: new Date(at + input.textWindowMinutes * 60_000).toISOString(),
          href: personLink(personId),
        })
      }
    }

    if (seatIsLoa || seatIsLo) {
      for (const call of input.source.calls) {
        if (call.personId !== personId || !isMissedInboundCall(call, input.now, input.callGraceMinutes)) continue
        const at = callAt(call)
        if (at == null || followedUp(personId, at, input.source.texts, input.source.calls)) continue
        const outcome = call.outcome?.trim() || 'no answer'
        push({
          key: `fub-call:${call.id}`,
          kind: 'call',
          seatUserId: owner,
          personId,
          personName,
          title: 'Missed call',
          line: `Missed inbound call (${outcome})`,
          missedAt: new Date(at).toISOString(),
          href: personLink(personId),
        })
      }
    }
  }

  const loSeat = input.seats.find((seat) => seat.role === 'lo')
  if (loSeat) {
    for (const task of input.source.googleTasks) {
      if (task.status === 'completed' || !task.id) continue
      const missed = taskMissedAt({ dueDate: task.due?.slice(0, 10), isCompleted: task.status === 'completed' }, input.now, input.timeZone)
      if (!missed) continue
      const title = task.title?.trim() || 'Google Task'
      push({
        key: `google-task:${task.id}`,
        kind: 'google_task',
        seatUserId: loSeat.userId,
        personName: 'Google Tasks',
        title,
        line: `Google Task overdue: ${title}${task.due ? ` (due ${task.due.slice(0, 10)})` : ''}`,
        missedAt: missed.toISOString(),
        href: undefined,
      })
    }
  }

  return items.sort((a, b) => a.missedAt.localeCompare(b.missedAt) || a.key.localeCompare(b.key))
}

export function digestSms(name: string, items: MissedItem[]): string {
  const count = items.length
  const header = `LoanPilot: ${name}, ${count} ${count === 1 ? 'item needs' : 'items need'} you.`
  const shown = items.slice(0, 8)
  const lines = shown.map((item) => {
    const label = item.kind === 'google_task' ? item.line : `${item.personName} — ${item.line}`
    return `- ${label}${item.href ? ` ${item.href}` : ''}`
  })
  const hidden = items.length - shown.length
  const more = hidden > 0 ? `\n+ ${hidden} more` : ''
  const body = [header, ...lines].join('\n') + more
  return body.length > 640 ? `${body.slice(0, 620)}…` : body
}

type NoteGroup = { personId: number; items: MissedItem[] }

function groupForSeat(items: MissedItem[], seat: ReminderSeat, maxNotes: number): {
  notes: NoteGroup[]
  smsItems: MissedItem[]
  deferred: number
} {
  const mine = items.filter((item) => item.seatUserId === seat.userId)
  if (!seat.fubNote) return { notes: [], smsItems: mine, deferred: 0 }
  const byPerson = new Map<number, MissedItem[]>()
  const noPerson: MissedItem[] = []
  for (const item of mine) {
    if (!item.personId) {
      noPerson.push(item)
      continue
    }
    const list = byPerson.get(item.personId) ?? []
    list.push(item)
    byPerson.set(item.personId, list)
  }
  const groups = [...byPerson.entries()].map(([personId, groupItems]) => ({ personId, items: groupItems }))
  groups.sort((a, b) => (b.items[b.items.length - 1]?.missedAt ?? '').localeCompare(a.items[a.items.length - 1]?.missedAt ?? ''))
  const notes = groups.slice(0, maxNotes)
  const deferredGroups = groups.slice(maxNotes)
  const deferred = deferredGroups.reduce((sum, group) => sum + group.items.length, 0)
  const smsItems = [...notes.flatMap((group) => group.items), ...noPerson]
  return { notes, smsItems, deferred }
}

function phoneLast4(phone: string | undefined): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-4) || undefined
}

function trimReminded(reminded: Record<string, string>): Record<string, string> {
  const entries = Object.entries(reminded)
  if (entries.length <= MAX_REMINDED) return reminded
  entries.sort((a, b) => a[1].localeCompare(b[1]))
  return Object.fromEntries(entries.slice(entries.length - MAX_REMINDED))
}

export async function getReminderPanel(): Promise<ReminderPanel> {
  const settings = reminderSettings()
  const state = await loadReminderState()
  const smsConfigured = env('QUO_API_KEY').trim() !== '' && env('QUO_FROM_NUMBER').trim() !== ''
  return {
    enabled: remindersEnabled(),
    dryRun: settings.dryRun,
    lookbackHours: settings.lookbackHours,
    textWindowMinutes: settings.textWindowMinutes,
    timezone: settings.timezone,
    smsConfigured,
    quoFromConfigured: env('QUO_FROM_NUMBER').trim() !== '',
    googleMissedCalls: GOOGLE_MISSED_CALLS_NOTE,
    seats: reminderSeats().map((seat) => ({
      userId: seat.userId,
      name: seat.name,
      role: seat.role,
      phoneSet: Boolean(seat.phone),
      fubNote: seat.fubNote,
    })),
    recent: state.recent,
    watermark: state.watermark,
    subscribe: ['callsCreated', 'callsUpdated'],
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(workers)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function listFrom(value: unknown, keys: string[]): Record<string, unknown>[] {
  const record = asRecord(value)
  if (!record) return []
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key].filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  }
  return []
}

function mapTask(raw: Record<string, unknown>): ReminderTask | null {
  const id = Number(raw.id)
  if (!Number.isInteger(id)) return null
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    isCompleted: raw.isCompleted as ReminderTask['isCompleted'],
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : undefined,
    dueDateTime: typeof raw.dueDateTime === 'string' ? raw.dueDateTime : undefined,
    personId: typeof raw.personId === 'number' ? raw.personId : undefined,
    personName: typeof raw.personName === 'string' ? raw.personName : undefined,
    assignedUserId: typeof raw.assignedUserId === 'number' ? raw.assignedUserId : undefined,
  }
}

function mapPerson(raw: Record<string, unknown>): ReminderPerson | null {
  const id = Number(raw.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    assignedUserId: typeof raw.assignedUserId === 'number' ? raw.assignedUserId : undefined,
  }
}

function mapText(raw: Record<string, unknown>): ReminderText | null {
  const id = Number(raw.id)
  if (!Number.isInteger(id)) return null
  return {
    id,
    personId: typeof raw.personId === 'number' ? raw.personId : undefined,
    isIncoming: raw.isIncoming as ReminderText['isIncoming'],
    created: typeof raw.created === 'string' ? raw.created : undefined,
    sent: typeof raw.sent === 'string' ? raw.sent : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  }
}

function mapCall(raw: Record<string, unknown>): ReminderCall | null {
  const id = Number(raw.id)
  if (!Number.isInteger(id)) return null
  return {
    id,
    personId: typeof raw.personId === 'number' ? raw.personId : undefined,
    isIncoming: raw.isIncoming as ReminderCall['isIncoming'],
    outcome: typeof raw.outcome === 'string' ? raw.outcome : raw.outcome == null ? null : undefined,
    duration: typeof raw.duration === 'number' ? raw.duration : raw.duration == null ? null : undefined,
    created: typeof raw.created === 'string' ? raw.created : undefined,
  }
}

async function enrichSeatPhones(seats: ReminderSeat[]): Promise<ReminderSeat[]> {
  const next: ReminderSeat[] = []
  for (const seat of seats) {
    if ((seat.phone && !seat.name.startsWith('LOA ')) || seat.userId <= 0) {
      next.push(seat)
      continue
    }
    const data = await fubGet(`/users/${seat.userId}?fields=id,name,phone`)
    const record = asRecord(data)
    const user = asRecord(record?.user) ?? record
    const apiName = typeof user?.name === 'string' ? user.name.trim() : ''
    const apiPhone = normalizePhone(typeof user?.phone === 'string' ? user.phone : undefined)
    next.push({
      ...seat,
      name: seat.name.startsWith('LOA ') && apiName ? apiName : seat.name,
      phone: seat.phone ?? apiPhone,
    })
  }
  return next
}

async function loadLiveSource(seats: ReminderSeat[], cutoff: Date, now: Date, focus: { callIds: number[]; textIds: number[] }, maxPeople: number): Promise<{ source: ReminderSource; warnings: string[] }> {
  const warnings: string[] = []
  const tasks: ReminderTask[] = []
  const people: ReminderPerson[] = []
  const texts: ReminderText[] = []
  const calls: ReminderCall[] = []

  for (const seat of seats) {
    if (seat.userId <= 0) continue
    const params = new URLSearchParams({
      assignedUserId: String(seat.userId),
      isCompleted: '0',
      dueStart: cutoff.toISOString(),
      dueEnd: now.toISOString(),
      limit: '100',
      sort: 'dueDate',
    })
    const taskData = await fubGet(`/tasks?${params}`)
    tasks.push(...listFrom(taskData, ['tasks']).map(mapTask).filter((task): task is ReminderTask => task != null))

    const peopleParams = new URLSearchParams({
      assignedUserId: String(seat.userId),
      lastActivityAfter: cutoff.toISOString(),
      limit: String(maxPeople),
      fields: 'id,name,assignedUserId',
      sort: '-lastActivity',
    })
    const peopleData = await fubGet(`/people?${peopleParams}`)
    people.push(...listFrom(peopleData, ['people']).map(mapPerson).filter((person): person is ReminderPerson => person != null))
  }

  const known = new Set(people.map((person) => person.id))
  const extraPersonIds = new Set<number>()
  for (const task of tasks) if (task.personId && task.personId > 0 && !known.has(task.personId)) extraPersonIds.add(task.personId)

  for (const id of focus.callIds) {
    const data = await fubGet(`/calls/${id}`)
    const record = asRecord(data)
    const call = record ? mapCall(asRecord(record.call) ?? record) : null
    if (call) {
      calls.push(call)
      if (call.personId && call.personId > 0) extraPersonIds.add(call.personId)
    }
  }
  for (const id of focus.textIds) {
    const data = await fubGet(`/textMessages/${id}`)
    const record = asRecord(data)
    const text = record ? mapText(asRecord(record.textMessage) ?? asRecord(record.textmessage) ?? record) : null
    if (text) {
      texts.push(text)
      if (text.personId && text.personId > 0) extraPersonIds.add(text.personId)
    }
  }

  if (extraPersonIds.size) {
    const ids = [...extraPersonIds].slice(0, 40)
    const data = await fubGet(`/people?id=${ids.join(',')}&fields=id,name,assignedUserId&limit=${ids.length}`)
    for (const person of listFrom(data, ['people']).map(mapPerson)) {
      if (person && !known.has(person.id)) {
        people.push(person)
        known.add(person.id)
      }
    }
  }

  const scanIds = [...known]
  await mapPool(scanIds, 4, async (personId) => {
    const [textData, callData] = await Promise.all([
      fubGet(`/textMessages?personId=${personId}&limit=30`),
      fubGet(`/calls?personId=${personId}&limit=20`),
    ])
    texts.push(...listFrom(textData, ['textmessages', 'textMessages']).map(mapText).filter((text): text is ReminderText => text != null))
    calls.push(...listFrom(callData, ['calls']).map(mapCall).filter((call): call is ReminderCall => call != null))
  })

  const recentCalls = await fubGet('/calls?limit=25')
  const polledCalls = listFrom(recentCalls, ['calls']).map(mapCall).filter((call): call is ReminderCall => call != null)
  calls.push(...polledCalls)
  const missingPeople = [...new Set(polledCalls.map((call) => call.personId).filter((id): id is number => id != null && id > 0 && !known.has(id)))].slice(0, 20)
  if (missingPeople.length) {
    const data = await fubGet(`/people?id=${missingPeople.join(',')}&fields=id,name,assignedUserId&limit=${missingPeople.length}`)
    const added: number[] = []
    for (const person of listFrom(data, ['people']).map(mapPerson)) {
      if (person && !known.has(person.id)) {
        people.push(person)
        known.add(person.id)
        added.push(person.id)
      }
    }
    await mapPool(added, 4, async (personId) => {
      const [textData, callData] = await Promise.all([
        fubGet(`/textMessages?personId=${personId}&limit=20`),
        fubGet(`/calls?personId=${personId}&limit=10`),
      ])
      texts.push(...listFrom(textData, ['textmessages', 'textMessages']).map(mapText).filter((text): text is ReminderText => text != null))
      calls.push(...listFrom(callData, ['calls']).map(mapCall).filter((call): call is ReminderCall => call != null))
    })
  }

  let googleTasks: ReminderGoogleTask[] = []
  try {
    const listed = await listGoogleTasks()
    if (!listed.demo) {
      googleTasks = listed.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        due: task.due,
        status: task.status,
      }))
    }
  } catch (err) {
    warnings.push(err instanceof Error && err.message ? err.message : 'Google Tasks unavailable')
  }

  return { source: { tasks, people, texts, calls, googleTasks }, warnings }
}

function emptySource(): ReminderSource {
  return { tasks: [], people: [], texts: [], calls: [], googleTasks: [] }
}

export async function runLoaReminders(options?: {
  now?: Date
  trigger?: string
  dryRun?: boolean
  callIds?: number[]
  textIds?: number[]
  source?: ReminderSource
  postNote?: PostNote
  sendText?: SendText
}): Promise<ReminderRunResult> {
  const now = options?.now ?? new Date()
  const trigger = options?.trigger ?? 'schedule'
  const settings = reminderSettings()
  const enabled = remindersEnabled()
  const dryRun = options?.dryRun === true || (enabled && settings.dryRun)
  const base = {
    ok: true as const,
    enabled,
    dryRun,
    trigger,
    deliveries: [] as Delivery[],
    deferred: 0,
    warnings: [] as string[],
  }
  if (!enabled && options?.dryRun !== true) return { ...base, skipped: 'disabled' }
  if (!options?.source && isDemoMode()) return { ...base, skipped: 'demo' }

  const settingsNow = reminderSettings()
  let seats = reminderSeats()
  let source = options?.source ?? emptySource()
  const warnings = [...base.warnings]
  if (!options?.source) {
    seats = await enrichSeatPhones(seats)
    const lookbackFloor = new Date(now.getTime() - settingsNow.lookbackHours * 3_600_000)
    const loaded = await loadLiveSource(
      seats,
      lookbackFloor,
      now,
      { callIds: options?.callIds ?? [], textIds: options?.textIds ?? [] },
      settingsNow.maxPeople,
    )
    source = loaded.source
    warnings.push(...loaded.warnings)
  }

  const state = await loadReminderState()
  let watermark = state.watermark
  if (enabled && !watermark) watermark = new Date(now.getTime() - settingsNow.lookbackHours * 3_600_000).toISOString()
  const lookbackFloor = new Date(now.getTime() - settingsNow.lookbackHours * 3_600_000)
  const watermarkAt = watermark ? new Date(watermark) : lookbackFloor
  const cutoff = new Date(Math.max(watermarkAt.getTime(), lookbackFloor.getTime()))

  const items = collectMissedItems({
    seats,
    source,
    now,
    cutoff,
    timeZone: settingsNow.timezone,
    textWindowMinutes: settingsNow.textWindowMinutes,
    callGraceMinutes: settingsNow.callGraceMinutes,
    already: state.reminded,
  })

  const postNote: PostNote = options?.postNote ?? (async (input) => {
    await addNote(input)
  })
  const sendText: SendText = options?.sendText ?? (async (input) => sendSmsIfConfigured(input))

  const deliveries: Delivery[] = []
  const reminded = { ...state.reminded }
  let deferred = 0
  const logs: ReminderLog[] = []

  for (const seat of seats) {
    const grouped = groupForSeat(items, seat, settingsNow.maxNotes)
    deferred += grouped.deferred
    const notedKeys = new Set<string>()

    for (const group of grouped.notes) {
      const payload: NotePayload = {
        personId: group.personId,
        subject: FUB_MENTION_NOTE_SUBJECT,
        body: mentionNoteHtml(seat.userId, seat.name, group.items.map((item) => item.line)),
        isHtml: true,
        mentionUserIds: [seat.userId],
      }
      const summary = `${group.items.length} item${group.items.length === 1 ? '' : 's'} on ${group.items[0]?.personName ?? 'lead'}`
      if (dryRun) {
        deliveries.push({
          seatUserId: seat.userId,
          seatName: seat.name,
          seatRole: seat.role,
          channel: 'note',
          personId: group.personId,
          personName: group.items[0]?.personName,
          summary,
          itemKeys: group.items.map((item) => item.key),
          status: 'preview',
        })
        continue
      }
      try {
        await postNote(payload)
        for (const item of group.items) {
          reminded[item.key] = now.toISOString()
          notedKeys.add(item.key)
        }
        deliveries.push({
          seatUserId: seat.userId,
          seatName: seat.name,
          seatRole: seat.role,
          channel: 'note',
          personId: group.personId,
          personName: group.items[0]?.personName,
          summary,
          itemKeys: group.items.map((item) => item.key),
          status: 'sent',
        })
      } catch (err) {
        const error = err instanceof Error && err.message ? err.message : 'Note failed'
        deliveries.push({
          seatUserId: seat.userId,
          seatName: seat.name,
          seatRole: seat.role,
          channel: 'note',
          personId: group.personId,
          summary,
          itemKeys: group.items.map((item) => item.key),
          status: 'error',
          error,
        })
      }
    }

    if (!grouped.smsItems.length) continue
    const smsBody = digestSms(seat.name, grouped.smsItems)
    const summary = smsBody.split('\n')[0] ?? 'Reminder'
    const keys = grouped.smsItems.map((item) => item.key)
    if (!seat.phone) {
      deliveries.push({
        seatUserId: seat.userId,
        seatName: seat.name,
        seatRole: seat.role,
        channel: 'sms',
        summary: `${summary} (no mobile configured)`,
        itemKeys: keys,
        smsBody,
        status: 'skipped',
      })
      continue
    }
    if (dryRun) {
      deliveries.push({
        seatUserId: seat.userId,
        seatName: seat.name,
        seatRole: seat.role,
        channel: 'sms',
        summary,
        itemKeys: keys,
        smsBody,
        phoneLast4: phoneLast4(seat.phone),
        status: 'preview',
      })
      continue
    }
    try {
      const sent = await sendText({ to: seat.phone, content: smsBody })
      if ('skipped' in sent) {
        deliveries.push({
          seatUserId: seat.userId,
          seatName: seat.name,
          seatRole: seat.role,
          channel: 'sms',
          summary: `${summary} (Quo is not configured)`,
          itemKeys: keys,
          smsBody,
          phoneLast4: phoneLast4(seat.phone),
          status: 'skipped',
        })
        continue
      }
      for (const item of grouped.smsItems) {
        if (!seat.fubNote || notedKeys.has(item.key) || !item.personId) reminded[item.key] = now.toISOString()
      }
      deliveries.push({
        seatUserId: seat.userId,
        seatName: seat.name,
        seatRole: seat.role,
        channel: 'sms',
        summary,
        itemKeys: keys,
        smsBody,
        phoneLast4: phoneLast4(seat.phone),
        status: 'sent',
      })
    } catch (err) {
      const error = err instanceof Error && err.message ? err.message : 'SMS failed'
      deliveries.push({
        seatUserId: seat.userId,
        seatName: seat.name,
        seatRole: seat.role,
        channel: 'sms',
        summary,
        itemKeys: keys,
        smsBody,
        phoneLast4: phoneLast4(seat.phone),
        status: 'error',
        error,
      })
    }
  }

  for (const delivery of deliveries) {
    logs.push({
      id: `${now.getTime()}-${delivery.seatUserId}-${delivery.channel}-${delivery.personId ?? 'x'}-${delivery.itemKeys[0] ?? 'none'}`,
      at: now.toISOString(),
      trigger,
      dryRun,
      seatUserId: delivery.seatUserId,
      seatName: delivery.seatName,
      seatRole: delivery.seatRole,
      channel: delivery.channel,
      personId: delivery.personId,
      personName: delivery.personName,
      summary: delivery.summary,
      itemKeys: delivery.itemKeys,
      status: delivery.status === 'sent' ? 'sent' : delivery.status === 'error' ? 'error' : delivery.status === 'skipped' ? 'skipped' : 'preview',
      error: delivery.error,
    })
  }

  const next: ReminderState = {
    watermark: enabled ? watermark : state.watermark,
    reminded: trimReminded(reminded),
    recent: [...logs.reverse(), ...state.recent].slice(0, MAX_RECENT),
  }
  if (enabled || logs.length) await saveReminderState(next)

  console.log(`[loa-reminders] ${dryRun ? 'dry-run' : 'run'} trigger=${trigger} deliveries=${deliveries.length} deferred=${deferred}`)

  return {
    ...base,
    dryRun,
    watermark: next.watermark,
    deliveries,
    deferred,
    warnings,
  }
}
