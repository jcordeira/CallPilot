import { listUpcomingEvents } from './calendar'
import { isDemoMode } from './env'
import { fubGet } from './followupboss'
import {
  FRANKIE_LISTS,
  FRANKIE_USER_ID,
  etDayKey,
  latestOutbound,
  rankFrankieToday,
  type CalendarAppointment,
  type FrankieBoard,
  type FrankieCandidate,
  type TouchRecord,
} from './frankieToday'
import { getStore } from '@netlify/blobs'
import { loanOfficerAssistant } from './team'

const FRESH_MS = 40 * 60_000
const ROSTER_MS = 30 * 60_000
const PEOPLE_FIELDS = 'id,name,source,created,assignedTo,assignedUserId,emails,phones,collaborators,lastActivity'
const TOUCH_CONCURRENCY = 3

type RawPerson = {
  id?: number
  name?: string
  source?: string
  created?: string
  assignedTo?: string
  assignedUserId?: number
  emails?: { value?: string }[]
  phones?: { value?: string }[]
  collaborators?: { id?: number }[]
  lastActivity?: string
}

type TouchHit = { at: string; lastTouch: string | null }

type Saved = {
  at: string
  rosterAt: string
  todayKey: string
  roster: FrankieCandidate[]
  touches: Record<string, TouchHit>
  board: FrankieBoard
}

let memory: Saved | null = null

function store() {
  try {
    return getStore('loanpilot-frankie-today')
  } catch {
    return null
  }
}

export function resetFrankieTodayForTests(): void {
  memory = null
}

function frankieId(): number {
  return loanOfficerAssistant().userId ?? FRANKIE_USER_ID
}

function mapPerson(raw: RawPerson, listIds: number[]): FrankieCandidate | null {
  if (!raw.id || !raw.name?.trim()) return null
  return {
    id: raw.id,
    name: raw.name.trim(),
    source: raw.source,
    created: raw.created,
    assignedTo: raw.assignedTo,
    assignedUserId: raw.assignedUserId,
    collaboratorIds: (raw.collaborators ?? []).map((person) => person.id).filter((id): id is number => typeof id === 'number'),
    emails: (raw.emails ?? []).map((email) => email.value ?? '').filter(Boolean),
    phones: (raw.phones ?? []).map((phone) => phone.value ?? '').filter(Boolean),
    lastActivity: raw.lastActivity,
    listIds,
    lastTouch: null,
  }
}

function pagesFor(listId: number): number {
  if (listId === 56 || listId === 65 || listId === 74 || listId === 75) return 6
  return 3
}

async function listPeople(query: string, pages: number): Promise<{ people: RawPerson[]; truncated: boolean }> {
  const people: RawPerson[] = []
  let truncated = false
  for (let page = 0; page < pages; page += 1) {
    const data = (await fubGet(`/people?${query}&limit=100&offset=${page * 100}&fields=${PEOPLE_FIELDS}`)) as { people?: RawPerson[] } | null
    const batch = data?.people ?? []
    people.push(...batch)
    if (batch.length < 100) return { people, truncated }
    truncated = page === pages - 1
  }
  return { people, truncated }
}

async function lastTouchFor(personId: number): Promise<string | null | undefined> {
  const [calls, texts] = await Promise.all([
    fubGet(`/calls?personId=${personId}&limit=10`) as Promise<{ calls?: TouchRecord[] } | null>,
    fubGet(`/textMessages?personId=${personId}&limit=10`) as Promise<{ textmessages?: TouchRecord[]; textMessages?: TouchRecord[] } | null>,
  ])
  if (!calls || !texts) return undefined
  return latestOutbound(calls.calls ?? [], texts.textmessages ?? texts.textMessages ?? [])
}

async function buildRoster(now: Date, id: number): Promise<{ roster: FrankieCandidate[]; warnings: string[] }> {
  const warnings: string[] = []
  const since = new Date(now.getTime() - 4 * 86_400_000).toISOString()
  const grouped = new Map<number, FrankieCandidate>()
  const add = (raw: RawPerson, listId: number | null) => {
    const existing = raw.id ? grouped.get(raw.id) : undefined
    const mapped = mapPerson(raw, existing ? existing.listIds : [])
    if (!mapped) return
    if (existing) mapped.listIds = [...new Set([...existing.listIds, ...(listId ? [listId] : [])])]
    else if (listId) mapped.listIds = [listId]
    grouped.set(mapped.id, mapped)
  }
  const recent = await listPeople(`createdAfter=${encodeURIComponent(since)}&sort=-created`, 2)
  if (recent.truncated) warnings.push('Some new leads were past the page limit.')
  for (const person of recent.people) add(person, null)
  for (const list of FRANKIE_LISTS) {
    const page = await listPeople(`smartListId=${list.id}&sort=-created`, pagesFor(list.id))
    if (page.truncated) warnings.push(`${list.label} has more people than this refresh loaded.`)
    for (const person of page.people) add(person, list.id)
  }
  const roster = [...grouped.values()].filter((person) => person.assignedUserId === id || person.collaboratorIds?.includes(id))
  return { roster, warnings }
}

function touchOrder(roster: FrankieCandidate[], known: Record<string, TouchHit>, now: Date): number[] {
  const recentCutoff = new Date(now.getTime() - 4 * 86_400_000).toISOString()
  const pending = roster.filter((person) => !known[String(person.id)])
  pending.sort((a, b) => {
    const aNew = (a.created ?? '') >= recentCutoff
    const bNew = (b.created ?? '') >= recentCutoff
    if (aNew !== bNew) return aNew ? -1 : 1
    return aNew ? (b.created ?? '').localeCompare(a.created ?? '') : (a.created ?? '').localeCompare(b.created ?? '')
  })
  if (pending.length) return pending.map((person) => person.id)
  return [...roster]
    .filter((person) => known[String(person.id)])
    .sort((a, b) => (known[String(a.id)]?.at ?? '').localeCompare(known[String(b.id)]?.at ?? ''))
    .map((person) => person.id)
}

async function fillTouches(ids: number[], budgetMs: number, started: number): Promise<Map<number, string | null>> {
  const found = new Map<number, string | null>()
  const queue = [...ids]
  if (!queue.length) return found
  const workers = Array.from({ length: Math.min(TOUCH_CONCURRENCY, queue.length) }, async () => {
    while (Date.now() - started < budgetMs) {
      const personId = queue.shift()
      if (personId == null) return
      const lastTouch = await lastTouchFor(personId)
      if (lastTouch !== undefined) found.set(personId, lastTouch)
    }
  })
  await Promise.all(workers)
  return found
}

async function calendarEvents(): Promise<{ events: CalendarAppointment[]; warning?: string }> {
  try {
    const calendar = await listUpcomingEvents(21)
    return {
      events: calendar.events.map((event) => ({
        summary: event.summary,
        description: event.description,
        attendees: event.attendees,
      })),
    }
  } catch (err) {
    return { events: [], warning: err instanceof Error ? err.message : 'Calendar unavailable' }
  }
}

export async function computeFrankieToday(now = new Date(), options?: { budgetMs?: number; refreshRoster?: boolean }): Promise<FrankieBoard> {
  if (isDemoMode()) {
    const ranked = rankFrankieToday([], [], now)
    return { ...ranked, updatedAt: now.toISOString(), warnings: ['Follow Up Boss is not connected.'] }
  }
  const started = Date.now()
  const budgetMs = options?.budgetMs ?? 22_000
  const todayKey = etDayKey(now)
  const saved = await readSaved()
  const sameDay = saved?.todayKey === todayKey
  const rosterFresh = Boolean(sameDay && saved && now.getTime() - Date.parse(saved.rosterAt) < ROSTER_MS)
  let roster = rosterFresh && saved ? saved.roster : []
  const warnings: string[] = []
  if (!rosterFresh || options?.refreshRoster) {
    const built = await buildRoster(now, frankieId())
    roster = built.roster
    warnings.push(...built.warnings)
  }
  const touches: Record<string, TouchHit> = sameDay && saved ? { ...saved.touches } : {}
  const rosterIds = new Set(roster.map((person) => String(person.id)))
  for (const key of Object.keys(touches)) if (!rosterIds.has(key)) delete touches[key]
  const order = touchOrder(roster, touches, now)
  const found = await fillTouches(order, budgetMs, started)
  const checkedAt = new Date().toISOString()
  for (const [personId, lastTouch] of found) touches[String(personId)] = { at: checkedAt, lastTouch }
  const checked: FrankieCandidate[] = []
  for (const person of roster) {
    const hit = touches[String(person.id)]
    if (!hit) continue
    checked.push({ ...person, lastTouch: hit.lastTouch })
  }
  const calendar = await calendarEvents()
  if (calendar.warning) warnings.push(calendar.warning)
  const ranked = rankFrankieToday(checked, calendar.events, now, frankieId())
  const unchecked = roster.filter((person) => !touches[String(person.id)]).length
  if (unchecked > 0) warnings.push(`Still checking ${unchecked} of ${roster.length} people.`)
  const rebuilt = !rosterFresh || Boolean(options?.refreshRoster)
  const board = { ...ranked, updatedAt: new Date().toISOString(), warnings }
  await writeSaved({
    at: board.updatedAt,
    rosterAt: rebuilt ? board.updatedAt : (saved?.rosterAt ?? board.updatedAt),
    todayKey,
    roster,
    touches,
    board,
  })
  return board
}

async function readSaved(): Promise<Saved | null> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('progress', { type: 'json' })) as Saved | null
      if (raw?.board && raw.at && raw.roster && raw.touches) {
        memory = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memory
}

async function writeSaved(saved: Saved): Promise<void> {
  memory = saved
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('progress', saved)
  } catch {
    /* memory */
  }
}

export async function loadFrankieToday(options?: { refresh?: boolean; now?: Date; budgetMs?: number }): Promise<FrankieBoard> {
  const now = options?.now ?? new Date()
  const saved = await readSaved()
  const fresh = saved ? now.getTime() - Date.parse(saved.at) < FRESH_MS : false
  if (saved && fresh && !options?.refresh) return saved.board
  try {
    return await computeFrankieToday(now, { budgetMs: options?.budgetMs, refreshRoster: options?.refresh && !fresh })
  } catch (err) {
    if (saved) return { ...saved.board, warnings: [...saved.board.warnings, err instanceof Error ? err.message : 'Refresh failed'] }
    throw err
  }
}

export function frankieTodaySummary(board: FrankieBoard) {
  return {
    ok: true as const,
    updatedAt: board.updatedAt,
    todayKey: board.todayKey,
    totalDue: board.totalDue,
    cap: board.cap,
    sections: board.sections,
    uncalled: board.people
      .filter((person) => person.sectionId === 'uncalled')
      .slice(0, 8)
      .map((person) => ({ id: person.id, name: person.name, missedYesterday: person.missedYesterday, daysSinceTouch: person.daysSinceTouch })),
    warnings: board.warnings,
  }
}
