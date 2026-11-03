import { getStore } from '@netlify/blobs'
import { attendeesWithGuests, type GuestAttendee, type GuestEvent } from './calendarGuest'
import { env, isDemoMode } from './env'
import { fubGet } from './followupboss'
import { resolveGoogleAccessToken } from './googleAuth'

export const JOE_ATTENDEE_EMAIL = 'jcordeira@cliffcomortgage.com'
export const FRANKIE_ATTENDEE_EMAIL = 'fcordeirajr@cliffcomortgage.com'
export const JOE_ORGANIZER_EMAILS = [JOE_ATTENDEE_EMAIL, 'joseph@teamcordeira.com']
const TEAM_EMAILS = [
  JOE_ATTENDEE_EMAIL,
  FRANKIE_ATTENDEE_EMAIL,
  'joseph@teamcordeira.com',
  'debbecke@cliffcomortgage.com',
  'drose@cliffcomortgage.com',
]
const TEAM_PHONES = ['5169969070', '6315126480', '6315460457', '5165213121', '5169087631', '2013946798', '5163869773', '5163094960']
const WINDOW_DAYS = 60
const PINGTREE = 'pingtree dscr'

export type AutoEvent = GuestEvent & {
  location?: string
  organizer?: { email?: string; self?: boolean }
}

export type SourcePerson = {
  id: number
  source?: string
  sourceUrl?: string
  tags?: string[]
  leadFlowSources?: string[]
}

export type FrankieCall = 'add' | 'omit'

export type AutoaddSummary = {
  ok: true
  enabled: boolean
  backfill: boolean
  skipped?: 'disabled' | 'demo' | 'no-calendar'
  scanned: number
  patched: number
  addedJoe: number
  addedFrankie: number
  skippedByReason: Record<string, number>
  frankieByReason: Record<string, number>
  sourcesSeen: string[]
  sourcesMatched: string[]
  errors: string[]
}

type LookupResult = { people: SourcePerson[]; failed: boolean }

type Patch = (input: { event: AutoEvent; attendees: GuestAttendee[] }) => Promise<void>

type SavedState = { backfillAt?: string; last?: AutoaddSummary }

let memoryState: SavedState = {}

function store() {
  try {
    return getStore('loanpilot-calendar-attendees')
  } catch {
    return null
  }
}

export async function resetCalendarAttendeeAutoaddForTests(): Promise<void> {
  memoryState = {}
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('state')
  } catch {
    /* memory */
  }
}

async function loadState(): Promise<SavedState> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('state', { type: 'json' })) as SavedState | null
      if (raw && typeof raw === 'object') {
        memoryState = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memoryState
}

async function saveState(next: SavedState): Promise<void> {
  memoryState = next
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('state', next)
  } catch {
    /* memory */
  }
}

export async function readCalendarAttendeeAutoaddState(): Promise<SavedState> {
  return loadState()
}

export function attendeeAutoaddEnabled(): boolean {
  const raw = env('CALENDAR_ATTENDEE_AUTOADD_ENABLED', 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

function windowDays(): number {
  const days = Number(env('CALENDAR_ATTENDEE_AUTOADD_DAYS', String(WINDOW_DAYS)).trim())
  if (!Number.isInteger(days) || days < 1) return WINDOW_DAYS
  return Math.min(days, 180)
}

export function foldSource(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, ' ').trim()
}

export function isPingtreeDscr(person: SourcePerson): boolean {
  const bits = [person.source, person.sourceUrl, ...(person.tags ?? []), ...(person.leadFlowSources ?? [])]
  return bits.some((bit) => bit && foldSource(bit).includes(PINGTREE))
}

export function sourceLabels(person: SourcePerson): string[] {
  return [person.source, ...(person.tags ?? []), ...(person.leadFlowSources ?? [])]
    .map((bit) => bit?.trim() ?? '')
    .filter(Boolean)
}

/** Add Frankie for a Pingtree DSCR lead, and whenever the match is unsure. Omit only for one confirmed non-match. */
export function frankieCall(input: { contactCount: number; people: SourcePerson[]; failed: boolean }): { call: FrankieCall; reason: string } {
  if (input.failed) return { call: 'add', reason: 'lookup failed' }
  if (input.contactCount === 0) return { call: 'add', reason: 'no contact info' }
  if (input.people.length === 0) return { call: 'add', reason: 'no FUB match' }
  if (input.people.length > 1) return { call: 'add', reason: 'several FUB matches' }
  if (isPingtreeDscr(input.people[0])) return { call: 'add', reason: 'Pingtree DSCR lead' }
  return { call: 'omit', reason: 'confirmed not Pingtree DSCR' }
}

export function clientContacts(event: AutoEvent, teamEmails: Set<string>, teamPhones: Set<string>): { emails: string[]; phones: string[] } {
  const emails = new Set<string>()
  for (const attendee of event.attendees ?? []) {
    const email = attendee.email.trim().toLowerCase()
    if (email && !teamEmails.has(email)) emails.add(email)
  }
  const text = [event.summary, event.description, event.location].filter(Boolean).join('\n')
  for (const match of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
    const email = match.trim().toLowerCase()
    if (!teamEmails.has(email)) emails.add(email)
  }
  const phones = new Set<string>()
  const phoneRe = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}|\+1\d{10}/g
  for (const match of text.match(phoneRe) ?? []) {
    const digits = match.replace(/\D/g, '')
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    if (local.length === 10 && !teamPhones.has(local)) phones.add(local)
  }
  return { emails: [...emails], phones: [...phones] }
}

export function skipReason(event: AutoEvent, joeEmails: Set<string>): string | null {
  if (event.status === 'cancelled') return 'cancelled'
  if (event.allDay) return 'all-day'
  const organizer = event.organizer?.email?.trim().toLowerCase()
  const organizerKnown = Boolean(event.organizer?.email || event.organizer?.self != null)
  const organizedByJoe = !organizerKnown || event.organizer?.self === true || (organizer ? joeEmails.has(organizer) : false)
  if (!organizedByJoe) return 'not organized by Joe'
  const declined = (event.attendees ?? []).some((attendee) => {
    if (attendee.responseStatus !== 'declined') return false
    const email = attendee.email.trim().toLowerCase()
    return attendee.self === true || joeEmails.has(email)
  })
  if (declined) return 'Joe declined'
  return null
}

function bump(bag: Record<string, number>, key: string) {
  bag[key] = (bag[key] ?? 0) + 1
}

function phoneQuery(local: string): string {
  return `+1${local}`
}

async function defaultLookup(contacts: { emails: string[]; phones: string[] }): Promise<LookupResult> {
  const people = new Map<number, SourcePerson>()
  let failed = false
  const take = (rows: SourcePerson[] | undefined) => {
    for (const person of rows ?? []) {
      if (!person?.id) continue
      const prev = people.get(person.id)
      people.set(person.id, {
        id: person.id,
        source: person.source ?? prev?.source,
        sourceUrl: person.sourceUrl ?? prev?.sourceUrl,
        tags: person.tags ?? prev?.tags,
        leadFlowSources: prev?.leadFlowSources,
      })
    }
  }
  for (const email of contacts.emails) {
    const data = (await fubGet(`/people?email=${encodeURIComponent(email)}&limit=10&fields=id,name,source,sourceUrl,tags`)) as {
      people?: SourcePerson[]
    } | null
    if (!data) failed = true
    else take(data.people)
  }
  for (const phone of contacts.phones) {
    const data = (await fubGet(`/people?phone=${encodeURIComponent(phoneQuery(phone))}&limit=10&fields=id,name,source,sourceUrl,tags`)) as {
      people?: SourcePerson[]
    } | null
    if (!data) failed = true
    else take(data.people)
  }
  if (people.size === 1) {
    const person = [...people.values()][0]
    const data = (await fubGet(`/events?personId=${person.id}&limit=20`)) as { events?: { source?: string }[] } | null
    if (!data) failed = true
    else {
      person.leadFlowSources = (data.events ?? []).map((item) => item.source?.trim() ?? '').filter(Boolean)
    }
  }
  return { people: [...people.values()], failed }
}

type Listed = {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  organizer?: { email?: string; self?: boolean }
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: GuestAttendee[]
}

function mapListed(item: Listed): AutoEvent | null {
  if (!item.id || item.status === 'cancelled') return null
  const startRaw = item.start?.dateTime ?? item.start?.date
  if (!startRaw) return null
  const allDay = Boolean(item.start?.date && !item.start.dateTime)
  const endRaw = item.end?.dateTime ?? item.end?.date
  return {
    id: item.id,
    summary: item.summary?.trim() || '(No title)',
    description: item.description,
    location: item.location,
    startIso: allDay ? `${startRaw.slice(0, 10)}T12:00:00.000Z` : new Date(startRaw).toISOString(),
    endIso: endRaw ? (allDay ? `${endRaw.slice(0, 10)}T12:00:00.000Z` : new Date(endRaw).toISOString()) : undefined,
    allDay,
    status: item.status,
    htmlLink: item.htmlLink,
    organizer: item.organizer,
    attendees: item.attendees,
  }
}

async function listUpcoming(now: Date, days: number): Promise<AutoEvent[]> {
  const { accessToken } = await resolveGoogleAccessToken()
  if (!accessToken) throw new Error('Google Calendar is not connected')
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const events: AutoEvent[] = []
  let pageToken = ''
  for (let page = 0; page < 20 && events.length < 1000; page += 1) {
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
    const data = (await res.json()) as { items?: Listed[]; nextPageToken?: string }
    for (const item of data.items ?? []) {
      const mapped = mapListed(item)
      if (mapped) events.push(mapped)
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return events
}

async function defaultPatch(input: { event: AutoEvent; attendees: GuestAttendee[] }): Promise<void> {
  const { accessToken } = await resolveGoogleAccessToken()
  if (!accessToken) throw new Error('Google Calendar is not connected')
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(input.event.id)}?sendUpdates=none`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendees: input.attendees }),
    },
  )
  if (!res.ok) throw new Error(`Calendar patch failed: ${res.status}`)
}

function hasEmail(event: AutoEvent, email: string): boolean {
  return (event.attendees ?? []).some((attendee) => attendee.email.trim().toLowerCase() === email)
}

export async function runCalendarAttendeeAutoadd(options?: {
  now?: Date
  trigger?: string
  events?: AutoEvent[]
  lookup?: (contacts: { emails: string[]; phones: string[] }) => Promise<LookupResult>
  patch?: Patch
}): Promise<AutoaddSummary> {
  const now = options?.now ?? new Date()
  const summary: AutoaddSummary = {
    ok: true,
    enabled: attendeeAutoaddEnabled(),
    backfill: false,
    scanned: 0,
    patched: 0,
    addedJoe: 0,
    addedFrankie: 0,
    skippedByReason: {},
    frankieByReason: {},
    sourcesSeen: [],
    sourcesMatched: [],
    errors: [],
  }
  if (!summary.enabled) {
    summary.skipped = 'disabled'
    return summary
  }
  if (!options?.events && isDemoMode()) {
    summary.skipped = 'demo'
    return summary
  }

  const joeEmails = new Set(JOE_ORGANIZER_EMAILS.map((email) => email.toLowerCase()))
  const teamEmails = new Set(TEAM_EMAILS.map((email) => email.toLowerCase()))
  const teamPhones = new Set(TEAM_PHONES)
  const lookup = options?.lookup ?? defaultLookup
  const patch = options?.patch ?? defaultPatch
  let events: AutoEvent[]
  try {
    events = options?.events ?? (await listUpcoming(now, windowDays()))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calendar list failed'
    if (message.includes('not connected')) summary.skipped = 'no-calendar'
    summary.errors.push(message)
    console.log(`[calendar-attendee] ${message}`)
    return summary
  }

  const seen = new Set<string>()
  const matched = new Set<string>()
  const prior = await loadState()
  summary.backfill = !prior.backfillAt
  summary.scanned = events.length

  for (const event of events) {
    const skip = skipReason(event, joeEmails)
    if (skip) {
      bump(summary.skippedByReason, skip)
      console.log(`[calendar-attendee] skip ${event.id} ${skip}`)
      continue
    }
    const contacts = clientContacts(event, teamEmails, teamPhones)
    let looked: LookupResult
    try {
      looked = await lookup(contacts)
    } catch (err) {
      looked = { people: [], failed: true }
      const message = err instanceof Error ? err.message : 'FUB lookup failed'
      if (!summary.errors.includes(message)) summary.errors.push(message)
    }
    for (const person of looked.people) {
      for (const label of sourceLabels(person)) {
        seen.add(label)
        if (isPingtreeDscr({ ...person, source: label, tags: [], leadFlowSources: [] }) || foldSource(label).includes(PINGTREE)) {
          matched.add(label)
        }
      }
    }
    const frankie = frankieCall({
      contactCount: contacts.emails.length + contacts.phones.length,
      people: looked.failed ? [] : looked.people,
      failed: looked.failed,
    })
    bump(summary.frankieByReason, frankie.reason)
    const want = [JOE_ATTENDEE_EMAIL]
    if (frankie.call === 'add') want.push(FRANKIE_ATTENDEE_EMAIL)
    const missing = want.filter((email) => !hasEmail(event, email))
    if (!missing.length) {
      bump(summary.skippedByReason, 'already set')
      continue
    }
    const attendees = attendeesWithGuests(event, missing)
    try {
      await patch({ event, attendees })
      summary.patched += 1
      if (missing.includes(JOE_ATTENDEE_EMAIL)) summary.addedJoe += 1
      if (missing.includes(FRANKIE_ATTENDEE_EMAIL)) summary.addedFrankie += 1
      console.log(`[calendar-attendee] patched ${event.id} added=${missing.join(',')} frankie=${frankie.reason}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calendar patch failed'
      bump(summary.skippedByReason, 'patch failed')
      if (!summary.errors.includes(message)) summary.errors.push(message)
      console.log(`[calendar-attendee] skip ${event.id} patch failed`)
    }
  }

  summary.sourcesSeen = [...seen].sort()
  summary.sourcesMatched = [...matched].sort()
  const nextState: SavedState = { ...prior, last: summary }
  if (summary.backfill && summary.errors.length === 0 && !summary.skipped) nextState.backfillAt = now.toISOString()
  await saveState(nextState)
  console.log(`[calendar-attendee] ${JSON.stringify({
    trigger: options?.trigger ?? 'run',
    backfill: summary.backfill,
    scanned: summary.scanned,
    patched: summary.patched,
    addedJoe: summary.addedJoe,
    addedFrankie: summary.addedFrankie,
    skippedByReason: summary.skippedByReason,
    frankieByReason: summary.frankieByReason,
    sourcesSeen: summary.sourcesSeen,
    sourcesMatched: summary.sourcesMatched,
  })}`)
  return summary
}
