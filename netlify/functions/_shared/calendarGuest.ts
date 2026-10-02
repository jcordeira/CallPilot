import { env, isDemoMode } from './env'
import { fubGet } from './followupboss'
import { gmailConfigured } from './gmail'
import { calendarCanWriteEvents, loadGoogleTokens, resolveGoogleAccessToken } from './googleAuth'
import { getStore } from '@netlify/blobs'

const DEFAULT_EMAIL = 'fcordeirajr@cliffcomortgage.com'
const DEFAULT_INCLUDE = 'call,appt,appointment,consult,refi,purchase,preapproval,pre-approval,heloc'
const DEFAULT_EXCLUDE = 'birthday,galligan group,team cordeira weekly,week setup,joe cordeira + alicia,heloc steps,eric / joe'
const NAME_STOP = new Set([
  'joe',
  'joseph',
  'cordeira',
  'frank',
  'frankie',
  'call',
  'calls',
  'appt',
  'appointment',
  'appointments',
  'consult',
  'consultation',
  'refi',
  'refinance',
  'purchase',
  'preapproval',
  'pre-approval',
  'heloc',
  'meeting',
  'meetings',
  'weekly',
  'group',
  'team',
  'setup',
  'steps',
  'client',
  'with',
  'and',
  'the',
])

export type GuestAttendee = {
  email: string
  responseStatus?: string
  displayName?: string
  optional?: boolean
  comment?: string
  additionalGuests?: number
  id?: string
}

export type GuestEvent = {
  id: string
  summary: string
  description?: string
  startIso: string
  endIso?: string
  allDay: boolean
  status?: string
  htmlLink?: string
  attendees?: GuestAttendee[]
}

export type GuestDecision = { include: boolean; reason: string }

export type GuestPreview = {
  id: string
  summary: string
  startIso: string
  htmlLink?: string
  action: 'add' | 'already' | 'skip'
  reason: string
}

export type GuestLog = {
  id: string
  at: string
  eventId: string
  summary: string
  status: 'added' | 'preview' | 'already' | 'skipped' | 'error'
  detail: string
}

type GuestState = { recent: GuestLog[] }

let memory: GuestState = { recent: [] }

function store() {
  try {
    return getStore('loanpilot-calendar-guests')
  } catch {
    return null
  }
}

export async function resetCalendarGuestStateForTests() {
  memory = { recent: [] }
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory is clear */
  }
}

async function loadState(): Promise<GuestState> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('state', { type: 'json' })) as GuestState | null
      if (raw && Array.isArray(raw.recent)) {
        memory = { recent: raw.recent.slice(0, 40) }
        return memory
      }
    } catch {
      /* memory */
    }
  }
  return { recent: [...memory.recent] }
}

async function saveState(next: GuestState) {
  memory = { recent: next.recent.slice(0, 40) }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', memory)
  } catch {
    /* memory holds it */
  }
}

function listEnv(key: string, fallback: string): string[] {
  return (env(key).trim() || fallback)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function calendarGuestSettings() {
  const notify = env('CALENDAR_AUTO_GUEST_NOTIFY', 'ics').trim().toLowerCase()
  const mode = notify === 'all' || notify === 'externalonly' ? (notify === 'externalonly' ? 'externalOnly' : 'all') : 'ics'
  const days = Number(env('CALENDAR_AUTO_GUEST_DAYS', '60').trim())
  return {
    enabled: env('CALENDAR_AUTO_GUEST_ENABLED', 'false').trim().toLowerCase() === 'true',
    dryRun: env('CALENDAR_AUTO_GUEST_DRY_RUN', 'false').trim().toLowerCase() === 'true',
    emails: listEnv('CALENDAR_AUTO_GUEST_EMAILS', DEFAULT_EMAIL),
    include: listEnv('CALENDAR_AUTO_GUEST_INCLUDE', DEFAULT_INCLUDE),
    exclude: listEnv('CALENDAR_AUTO_GUEST_EXCLUDE', DEFAULT_EXCLUDE),
    days: Number.isInteger(days) && days > 0 ? Math.min(days, 180) : 60,
    notify: mode as 'ics' | 'all' | 'externalOnly',
  }
}

function plain(value: string | undefined): string {
  return (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase()
  return phrases.some((phrase) => lower.includes(phrase))
}

function hasKeyword(title: string, words: string[]): boolean {
  const lower = title.toLowerCase()
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(lower)
  })
}

function bookedAppointment(event: GuestEvent): boolean {
  const title = event.summary.trim()
  if (/^joe\s*&\s+.+\([^)]+\)\s*$/i.test(title)) return true
  const description = plain(event.description)
  return /^booked by\b/i.test(description)
}

function internalPair(title: string): boolean {
  const trimmed = title.trim()
  if (/^[^()/]{2,60}\s\/\s[^()/]{2,60}$/.test(trimmed)) return true
  return /\+\s*[A-Za-z]+(?:\s+[A-Za-z]+)?\s+meeting\b/i.test(trimmed)
}

function personName(title: string): boolean {
  const words = title
    .replace(/[()[\]&,/+.:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  for (let i = 0; i < words.length - 1; i += 1) {
    const a = words[i]
    const b = words[i + 1]
    if (!/^[A-Z][a-z'’-]{1,}$/.test(a) || !/^[A-Z][a-z'’-]{1,}$/.test(b)) continue
    if (NAME_STOP.has(a.toLowerCase()) || NAME_STOP.has(b.toLowerCase())) continue
    return true
  }
  return false
}

function leadHit(title: string, leadNames: string[]): string | null {
  const lower = title.toLowerCase()
  for (const name of leadNames) {
    const trimmed = name.trim()
    if (trimmed.split(/\s+/).length < 2) continue
    if (NAME_STOP.has(trimmed.split(/\s+/)[0]?.toLowerCase() ?? '')) {
      const rest = trimmed.split(/\s+/).slice(1).join(' ')
      if (['cordeira'].includes(rest.toLowerCase())) continue
    }
    if (['joseph cordeira', 'joe cordeira', 'frank cordeira', 'frankie cordeira'].includes(trimmed.toLowerCase())) continue
    if (lower.includes(trimmed.toLowerCase())) return trimmed
  }
  return null
}

/** Timed client appointments only. Exclude keywords and internal titles win. */
export function classifyClientAppointment(event: GuestEvent, leadNames: string[] = []): GuestDecision {
  if (event.status === 'cancelled') return { include: false, reason: 'cancelled' }
  if (event.allDay || !event.startIso) return { include: false, reason: 'all-day' }
  const settings = calendarGuestSettings()
  const title = event.summary.trim()
  if (!title) return { include: false, reason: 'no title' }
  if (hasPhrase(`${title} ${plain(event.description)}`, settings.exclude)) return { include: false, reason: 'exclude keyword' }
  if (bookedAppointment(event)) return { include: true, reason: 'booked appointment' }
  if (internalPair(title)) return { include: false, reason: 'internal meeting' }
  if (hasKeyword(title, settings.include) && personName(title)) return { include: true, reason: 'client call' }
  const lead = leadHit(title, leadNames)
  if (lead) return { include: true, reason: `lead ${lead}` }
  return { include: false, reason: 'not a client appointment' }
}

export function guestAlreadyPresent(event: GuestEvent, emails: string[]): boolean {
  const have = new Set((event.attendees ?? []).map((attendee) => attendee.email.trim().toLowerCase()))
  return emails.every((email) => have.has(email.toLowerCase()))
}

function attendeePayload(attendee: GuestAttendee): GuestAttendee {
  return {
    email: attendee.email,
    ...(attendee.responseStatus ? { responseStatus: attendee.responseStatus } : {}),
    ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
    ...(attendee.optional ? { optional: true } : {}),
    ...(attendee.comment ? { comment: attendee.comment } : {}),
    ...(typeof attendee.additionalGuests === 'number' ? { additionalGuests: attendee.additionalGuests } : {}),
    ...(attendee.id ? { id: attendee.id } : {}),
  }
}

export function attendeesWithGuests(event: GuestEvent, emails: string[]): GuestAttendee[] {
  const existing = event.attendees ?? []
  const have = new Set(existing.map((attendee) => attendee.email.trim().toLowerCase()))
  const next = existing.map((attendee) => attendeePayload(attendee))
  for (const email of emails) {
    if (!have.has(email.toLowerCase())) next.push({ email })
  }
  return next
}

function icsStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function guestInviteIcs(event: GuestEvent, guestEmail: string, organizer?: string): string {
  const uid = `${event.id}@loanpilot`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LoanPilot//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(event.startIso)}`,
    event.endIso ? `DTEND:${icsStamp(event.endIso)}` : '',
    `SUMMARY:${event.summary.replace(/\r?\n/g, ' ')}`,
    organizer ? `ORGANIZER:mailto:${organizer}` : '',
    `ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${guestEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.join('\r\n')
}

type PatchGuest = (input: {
  event: GuestEvent
  attendees: GuestAttendee[]
  sendUpdates: 'none' | 'all' | 'externalOnly'
}) => Promise<void>

type SendInvite = (input: { to: string; subject: string; ics: string }) => Promise<void>

async function loadLeadNames(): Promise<string[]> {
  if (isDemoMode()) return []
  const data = (await fubGet('/people?limit=100&fields=name&sort=-updated')) as { people?: { name?: string }[] } | null
  return (data?.people ?? []).map((person) => person.name?.trim() ?? '').filter(Boolean)
}

type GCal = {
  id?: string
  status?: string
  summary?: string
  description?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: GuestAttendee[]
}

function mapEvent(item: GCal): GuestEvent | null {
  if (!item.id || item.status === 'cancelled') return null
  const startRaw = item.start?.dateTime ?? item.start?.date
  if (!startRaw) return null
  const allDay = Boolean(item.start?.date && !item.start.dateTime)
  const startIso = allDay ? `${startRaw}T00:00:00.000Z` : new Date(startRaw).toISOString()
  const endRaw = item.end?.dateTime ?? item.end?.date
  const endIso = endRaw ? (allDay ? `${endRaw}T00:00:00.000Z` : new Date(endRaw).toISOString()) : undefined
  return {
    id: item.id,
    summary: item.summary?.trim() || '',
    description: item.description,
    startIso,
    endIso,
    allDay,
    status: item.status,
    htmlLink: item.htmlLink,
    attendees: item.attendees,
  }
}

async function listLiveEvents(days: number, now: Date): Promise<GuestEvent[]> {
  const { accessToken } = await resolveGoogleAccessToken()
  if (!accessToken) return []
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const events: GuestEvent[] = []
  let pageToken = ''
  for (let page = 0; page < 5 && events.length < 200; page += 1) {
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      showDeleted: 'false',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`)
    const data = (await res.json()) as { items?: GCal[]; nextPageToken?: string }
    for (const item of data.items ?? []) {
      const mapped = mapEvent(item)
      if (mapped) events.push(mapped)
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return events
}

async function defaultPatch(input: {
  event: GuestEvent
  attendees: GuestAttendee[]
  sendUpdates: 'none' | 'all' | 'externalOnly'
}): Promise<void> {
  const { accessToken } = await resolveGoogleAccessToken()
  if (!accessToken) throw new Error('Google Calendar is not connected')
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const params = new URLSearchParams({ sendUpdates: input.sendUpdates })
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(input.event.id)}?${params}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendees: input.attendees.map((attendee) => attendeePayload(attendee)),
      }),
    },
  )
  if (!res.ok) throw new Error(`Calendar patch failed: ${res.status}`)
}

function encodeRaw(headers: Record<string, string>, body: string): string {
  const raw = `${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n${body}`
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function defaultSendInvite(input: { to: string; subject: string; ics: string }): Promise<void> {
  if (!gmailConfigured() || isDemoMode()) throw new Error('Gmail is not connected')
  const token = env('GMAIL_ACCESS_TOKEN')
  const raw = encodeRaw(
    {
      To: input.to,
      Subject: input.subject,
      'Content-Type': 'text/calendar; method=REQUEST; charset="UTF-8"',
    },
    input.ics,
  )
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) throw new Error(`Gmail invite failed: ${res.status}`)
}

export async function calendarWriteMissing(): Promise<boolean> {
  const stored = await loadGoogleTokens()
  if (!stored?.accessToken) return false
  return !calendarCanWriteEvents(stored.scope)
}

export async function getCalendarGuestPanel(): Promise<{
  enabled: boolean
  dryRun: boolean
  emails: string[]
  days: number
  notify: string
  gmailCanInvite: boolean
  needsCalendarWrite: boolean
  recent: GuestLog[]
}> {
  const settings = calendarGuestSettings()
  const state = await loadState()
  return {
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    emails: settings.emails,
    days: settings.days,
    notify: settings.notify,
    gmailCanInvite: gmailConfigured() && !isDemoMode(),
    needsCalendarWrite: await calendarWriteMissing(),
    recent: state.recent,
  }
}

export async function runCalendarGuest(options?: {
  now?: Date
  trigger?: string
  dryRun?: boolean
  events?: GuestEvent[]
  leadNames?: string[]
  patch?: PatchGuest
  sendInvite?: SendInvite
}): Promise<{
  ok: true
  enabled: boolean
  dryRun: boolean
  skipped?: 'disabled' | 'demo' | 'scope'
  previews: GuestPreview[]
  added: number
}> {
  const now = options?.now ?? new Date()
  const settings = calendarGuestSettings()
  const dryRun = options?.dryRun === true || (settings.enabled && settings.dryRun)
  const base = { ok: true as const, enabled: settings.enabled, dryRun, previews: [] as GuestPreview[], added: 0 }
  if (!settings.enabled && options?.dryRun !== true) return { ...base, skipped: 'disabled' }
  if (!options?.events && isDemoMode()) return { ...base, skipped: 'demo' }
  if (!dryRun && !options?.patch && (await calendarWriteMissing())) return { ...base, skipped: 'scope' }

  const events = options?.events ?? (await listLiveEvents(settings.days, now))
  const leadNames = options?.leadNames ?? (options?.events ? [] : await loadLeadNames().catch(() => []))
  const patch = options?.patch ?? defaultPatch
  const sendInvite = options?.sendInvite ?? defaultSendInvite
  const organizer = (await loadGoogleTokens())?.email
  const previews: GuestPreview[] = []
  const logs: GuestLog[] = []
  let added = 0

  for (const event of events) {
    const decision = classifyClientAppointment(event, leadNames)
    if (!decision.include) {
      previews.push({ id: event.id, summary: event.summary, startIso: event.startIso, htmlLink: event.htmlLink, action: 'skip', reason: decision.reason })
      continue
    }
    if (guestAlreadyPresent(event, settings.emails)) {
      previews.push({ id: event.id, summary: event.summary, startIso: event.startIso, htmlLink: event.htmlLink, action: 'already', reason: 'guest already on the event' })
      continue
    }
    previews.push({ id: event.id, summary: event.summary, startIso: event.startIso, htmlLink: event.htmlLink, action: 'add', reason: decision.reason })
    if (dryRun) continue
    try {
      const attendees = attendeesWithGuests(event, settings.emails)
      const sendUpdates = settings.notify === 'ics' ? 'none' : settings.notify
      await patch({ event, attendees, sendUpdates })
      let detail = decision.reason
      if (settings.notify === 'ics') {
        const fresh = settings.emails.filter(
          (email) => !(event.attendees ?? []).some((attendee) => attendee.email.trim().toLowerCase() === email.toLowerCase()),
        )
        if (fresh.length && (options?.sendInvite || (gmailConfigured() && !isDemoMode()))) {
          for (const email of fresh) {
            await sendInvite({
              to: email,
              subject: `Invitation: ${event.summary}`,
              ics: guestInviteIcs(event, email, organizer),
            })
          }
          detail = `${decision.reason}; invite emailed`
        } else {
          detail = `${decision.reason}; added without an email (Gmail is not connected)`
        }
      }
      added += 1
      logs.push({
        id: `${now.getTime()}-add-${event.id}`,
        at: now.toISOString(),
        eventId: event.id,
        summary: event.summary,
        status: 'added',
        detail,
      })
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Calendar update failed'
      logs.push({
        id: `${now.getTime()}-err-${event.id}`,
        at: now.toISOString(),
        eventId: event.id,
        summary: event.summary,
        status: 'error',
        detail: message,
      })
    }
  }

  if (logs.length) {
    const state = await loadState()
    await saveState({ recent: [...logs.reverse(), ...state.recent].slice(0, 40) })
  }
  const actionable = previews.filter((item) => item.action === 'add').length
  console.log(`[calendar-guest] ${dryRun ? 'dry-run' : 'run'} trigger=${options?.trigger ?? 'schedule'} add=${actionable} wrote=${added}`)
  return { ...base, previews: previews.filter((item) => item.action !== 'skip'), added }
}
