/** Frankie Today cadence rules. Read-only: no texts, emails, or Follow Up Boss writes. */

export const FRANKIE_USER_ID = 16
export const FRANKIE_DAILY_CAP = 30
export const PINGTREE_SOURCE = 'pingtree dscr form'
const TZ = 'America/New_York'

export type SectionId =
  | 'uncalled'
  | 'realtor'
  | 'todays-leads'
  | 'leads-daily'
  | 'doc-checklist'
  | 'docs-followup'
  | 'preapprovals'
  | 'aged-doc'
  | 'expired-preapproval'

export type FrankieList = { id: number; label: string; section: SectionId }

export const FRANKIE_LISTS: FrankieList[] = [
  { id: 56, label: 'Realtor Referrals', section: 'realtor' },
  { id: 1, label: "Today's Leads", section: 'todays-leads' },
  { id: 3, label: 'Leads/Daily', section: 'leads-daily' },
  { id: 66, label: 'Doc Checklist Sent', section: 'doc-checklist' },
  { id: 77, label: 'Missing Docs', section: 'docs-followup' },
  { id: 26, label: 'Docs In', section: 'docs-followup' },
  { id: 85, label: 'Preapproval Ready', section: 'docs-followup' },
  { id: 88, label: 'Pre-approval Review', section: 'docs-followup' },
  { id: 65, label: 'Pre-Approvals', section: 'preapprovals' },
  { id: 75, label: 'Aged Doc Checklist', section: 'aged-doc' },
  { id: 74, label: 'Expired Pre-Approval', section: 'expired-preapproval' },
]

const SECTION_ORDER: { id: SectionId; label: string }[] = [
  { id: 'uncalled', label: 'Uncalled new leads' },
  { id: 'realtor', label: 'Realtor Referrals' },
  { id: 'todays-leads', label: "Today's Leads" },
  { id: 'leads-daily', label: 'Leads/Daily' },
  { id: 'doc-checklist', label: 'Doc Checklist Sent' },
  { id: 'docs-followup', label: 'Docs follow-up' },
  { id: 'preapprovals', label: 'Pre-Approvals' },
  { id: 'aged-doc', label: 'Aged Doc Checklist' },
  { id: 'expired-preapproval', label: 'Expired Pre-Approval' },
]

export type TouchRecord = { created?: string; isIncoming?: boolean }

export type FrankieCandidate = {
  id: number
  name: string
  source?: string
  created?: string
  assignedTo?: string
  assignedUserId?: number
  collaboratorIds?: number[]
  emails?: string[]
  phones?: string[]
  lastActivity?: string
  listIds: number[]
  /** Latest outbound call or text. Null means none. */
  lastTouch: string | null
}

export type CalendarAppointment = {
  summary?: string
  description?: string
  attendees?: { email?: string; displayName?: string }[]
}

export type FrankieRow = {
  id: number
  name: string
  sectionId: SectionId
  reason: string
  tags: string[]
  daysSinceTouch: number | null
  missedYesterday: boolean
  source: string
  assignedTo: string
}

export type FrankieBoard = {
  updatedAt: string
  todayKey: string
  totalDue: number
  cap: number
  sections: { id: SectionId; label: string; total: number }[]
  people: FrankieRow[]
  warnings: string[]
}

export function etDayKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const utc = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days, 15))
  return etDayKey(utc)
}

export function shiftMonths(dayKey: string, months: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const utc = new Date(Date.UTC(year, (month ?? 1) - 1 + months, day ?? 1, 15))
  return etDayKey(utc)
}

export function daySpan(earlierKey: string, laterKey: string): number {
  const earlier = Date.parse(`${earlierKey}T00:00:00Z`)
  const later = Date.parse(`${laterKey}T00:00:00Z`)
  return Math.round((later - earlier) / 86_400_000)
}

export function inFrankieScope(person: Pick<FrankieCandidate, 'assignedUserId' | 'collaboratorIds'>, frankieId = FRANKIE_USER_ID): boolean {
  if (person.assignedUserId === frankieId) return true
  return (person.collaboratorIds ?? []).includes(frankieId)
}

export function isPingtreeSource(source: string | undefined): boolean {
  return (source ?? '').trim().toLowerCase() === PINGTREE_SOURCE
}

export function phoneKey(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.length >= 10 ? digits.slice(-10) : ''
}

/** Latest outbound call or text. Incoming messages and notes are not a touch. */
export function latestOutbound(calls: TouchRecord[], texts: TouchRecord[]): string | null {
  const stamps = [...calls, ...texts]
    .filter((row) => row.isIncoming === false && row.created)
    .map((row) => row.created as string)
  if (!stamps.length) return null
  return stamps.sort().at(-1) ?? null
}

export function calendarExempt(person: Pick<FrankieCandidate, 'name' | 'emails' | 'phones'>, events: CalendarAppointment[]): boolean {
  const emails = new Set((person.emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))
  const phones = new Set((person.phones ?? []).map((phone) => phoneKey(phone)).filter(Boolean))
  const name = person.name.trim().toLowerCase()
  for (const event of events) {
    const blob = `${event.summary ?? ''}\n${event.description ?? ''}`.toLowerCase()
    const digits = blob.replace(/\D/g, '')
    for (const attendee of event.attendees ?? []) {
      const email = attendee.email?.trim().toLowerCase()
      if (email && emails.has(email)) return true
      if (name.length > 2 && attendee.displayName?.trim().toLowerCase() === name) return true
    }
    if (name.length > 2 && blob.includes(name)) return true
    for (const email of emails) if (blob.includes(email)) return true
    for (const phone of phones) if (phone && digits.includes(phone)) return true
  }
  return false
}

function touchDays(lastTouch: string | null, todayKey: string): number | null {
  if (!lastTouch) return null
  return daySpan(etDayKey(lastTouch), todayKey)
}

function activityWithin(person: FrankieCandidate, todayKey: string, days: number): boolean {
  if (!person.lastActivity) return false
  const span = daySpan(etDayKey(person.lastActivity), todayKey)
  return span >= 0 && span <= days
}

type Hit = { section: SectionId; reason: string; priority: number; days: number | null; missedYesterday: boolean }

function consider(person: FrankieCandidate, todayKey: string, exempt: boolean): Hit[] {
  const hits: Hit[] = []
  const days = touchDays(person.lastTouch, todayKey)
  const createdKey = person.created ? etDayKey(person.created) : ''
  const age = createdKey ? daySpan(createdKey, todayKey) : null
  const lists = new Set(person.listIds)

  if (age != null && age >= 0 && age <= 3 && days == null && !isPingtreeSource(person.source) && !exempt) {
    hits.push({
      section: 'uncalled',
      reason: age === 0 ? 'Uncalled new lead' : 'Uncalled new lead',
      priority: 1,
      days,
      missedYesterday: age >= 1,
    })
  }
  if (lists.has(56) && createdKey && createdKey >= shiftMonths(todayKey, -6) && (days == null || days >= 7)) {
    hits.push({ section: 'realtor', reason: 'Realtor Referrals', priority: 2, days, missedYesterday: false })
  }
  if (lists.has(1) && (days == null || days >= 1)) {
    hits.push({ section: 'todays-leads', reason: "Today's Leads", priority: 3, days, missedYesterday: false })
  }
  if (lists.has(3) && (days == null || days >= 3)) {
    hits.push({ section: 'leads-daily', reason: 'Leads/Daily', priority: 4, days, missedYesterday: false })
  }
  if (lists.has(66) && (days == null || days >= 2)) {
    hits.push({ section: 'doc-checklist', reason: 'Doc Checklist Sent', priority: 5, days, missedYesterday: false })
  }
  for (const list of FRANKIE_LISTS.filter((item) => item.section === 'docs-followup')) {
    if (lists.has(list.id) && (days == null || days >= 3)) {
      hits.push({ section: 'docs-followup', reason: list.label, priority: 6, days, missedYesterday: false })
    }
  }
  if (lists.has(65) && (days == null || days >= 14)) {
    hits.push({ section: 'preapprovals', reason: 'Pre-Approvals', priority: 7, days, missedYesterday: false })
  }
  if (lists.has(75)) {
    const active = (days != null && days <= 90) || activityWithin(person, todayKey, 90)
    const min = active ? 30 : 90
    if (days == null || days >= min) {
      hits.push({ section: 'aged-doc', reason: 'Aged Doc Checklist', priority: 8, days, missedYesterday: false })
    }
  }
  if (lists.has(74) && (days == null || days >= 60)) {
    hits.push({ section: 'expired-preapproval', reason: 'Expired Pre-Approval', priority: 9, days, missedYesterday: false })
  }
  return hits
}

function sortDays(days: number | null): number {
  return days == null ? Number.POSITIVE_INFINITY : days
}

/** Rank Frankie's due people. Highest-priority list wins; the others stay as tags. */
export function rankFrankieToday(
  people: FrankieCandidate[],
  events: CalendarAppointment[],
  now: Date,
  frankieId = FRANKIE_USER_ID,
): Omit<FrankieBoard, 'updatedAt' | 'warnings'> {
  const todayKey = etDayKey(now)
  const rows: FrankieRow[] = []
  for (const person of people) {
    if (!inFrankieScope(person, frankieId)) continue
    const hits = consider(person, todayKey, calendarExempt(person, events))
    if (!hits.length) continue
    hits.sort((a, b) => a.priority - b.priority || sortDays(b.days) - sortDays(a.days))
    const primary = hits[0]
    if (!primary) continue
    const tags = [...new Set(hits.slice(1).map((hit) => hit.reason))]
    rows.push({
      id: person.id,
      name: person.name,
      sectionId: primary.section,
      reason: primary.missedYesterday ? `${primary.reason} · missed yesterday` : primary.reason,
      tags,
      daysSinceTouch: primary.days,
      missedYesterday: primary.missedYesterday,
      source: person.source?.trim() || '—',
      assignedTo: person.assignedTo?.trim() || '—',
    })
  }
  rows.sort((a, b) => {
    const sectionA = SECTION_ORDER.findIndex((section) => section.id === a.sectionId)
    const sectionB = SECTION_ORDER.findIndex((section) => section.id === b.sectionId)
    return sectionA - sectionB || sortDays(b.daysSinceTouch) - sortDays(a.daysSinceTouch) || a.name.localeCompare(b.name)
  })
  const sections = SECTION_ORDER.map((section) => ({
    id: section.id,
    label: section.label,
    total: rows.filter((row) => row.sectionId === section.id).length,
  })).filter((section) => section.total > 0)
  return { todayKey, totalDue: rows.length, cap: FRANKIE_DAILY_CAP, sections, people: rows }
}
