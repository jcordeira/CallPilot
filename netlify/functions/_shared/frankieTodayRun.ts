import { listUpcomingEvents } from './calendar'
import { isDemoMode } from './env'
import { fubGet } from './followupboss'
import {
  FRANKIE_LISTS,
  FRANKIE_USER_ID,
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
const PEOPLE_FIELDS = 'id,name,source,created,assignedTo,assignedUserId,emails,phones,collaborators,lastActivity'
const TOUCH_CAP = 120

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

type Cache = { at: string; board: FrankieBoard }

let memory: Cache | null = null

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

async function listPeople(query: string, pages = 3): Promise<RawPerson[]> {
  const people: RawPerson[] = []
  for (let page = 0; page < pages; page += 1) {
    const data = (await fubGet(`/people?${query}&limit=100&offset=${page * 100}&fields=${PEOPLE_FIELDS}`)) as { people?: RawPerson[] } | null
    const batch = data?.people ?? []
    people.push(...batch)
    if (batch.length < 100) break
  }
  return people
}

async function lastTouchFor(personId: number): Promise<string | null | undefined> {
  const [calls, texts] = await Promise.all([
    fubGet(`/calls?personId=${personId}&limit=20`) as Promise<{ calls?: TouchRecord[] } | null>,
    fubGet(`/textMessages?personId=${personId}&limit=20`) as Promise<{ textmessages?: TouchRecord[]; textMessages?: TouchRecord[] } | null>,
  ])
  if (!calls && !texts) return undefined
  return latestOutbound(calls?.calls ?? [], texts?.textmessages ?? texts?.textMessages ?? [])
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await fn(items[index] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export async function computeFrankieToday(now = new Date()): Promise<FrankieBoard> {
  const warnings: string[] = []
  if (isDemoMode()) {
    const ranked = rankFrankieToday([], [], now)
    return { ...ranked, updatedAt: now.toISOString(), warnings: ['Follow Up Boss is not connected.'] }
  }
  const id = frankieId()
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
  for (const person of recent) add(person, null)
  for (const list of FRANKIE_LISTS) {
    const people = await listPeople(`smartListId=${list.id}&sort=-created`, list.id === 56 ? 4 : 2)
    for (const person of people) add(person, list.id)
  }
  const scoped = [...grouped.values()]
    .filter((person) => person.assignedUserId === id || person.collaboratorIds?.includes(id))
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  const touchIds = scoped.slice(0, TOUCH_CAP).map((person) => person.id)
  if (scoped.length > TOUCH_CAP) warnings.push(`Touch checks stopped at ${TOUCH_CAP} of ${scoped.length} people.`)
  const touches = await pool(touchIds, 6, async (personId) => ({ personId, lastTouch: await lastTouchFor(personId) }))
  const byId = new Map(touches.map((row) => [row.personId, row.lastTouch]))
  const checked: FrankieCandidate[] = []
  for (const person of scoped) {
    const touch = byId.get(person.id)
    if (touch === undefined && !byId.has(person.id)) continue
    if (touch === undefined) continue
    person.lastTouch = touch
    checked.push(person)
  }
  let events: CalendarAppointment[] = []
  try {
    const calendar = await listUpcomingEvents(21)
    events = calendar.events.map((event) => ({
      summary: event.summary,
      description: event.description,
      attendees: event.attendees,
    }))
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : 'Calendar unavailable')
  }
  const ranked = rankFrankieToday(checked, events, now, id)
  return { ...ranked, updatedAt: now.toISOString(), warnings }
}

async function readCache(): Promise<Cache | null> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('board', { type: 'json' })) as Cache | null
      if (raw?.board && raw.at) {
        memory = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memory
}

async function writeCache(board: FrankieBoard): Promise<void> {
  memory = { at: board.updatedAt, board }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('board', memory)
  } catch {
    /* memory */
  }
}

export async function loadFrankieToday(options?: { refresh?: boolean; now?: Date }): Promise<FrankieBoard> {
  const now = options?.now ?? new Date()
  const cached = await readCache()
  const fresh = cached ? now.getTime() - Date.parse(cached.at) < FRESH_MS : false
  if (cached && fresh && !options?.refresh) return cached.board
  try {
    const board = await computeFrankieToday(now)
    await writeCache(board)
    return board
  } catch (err) {
    if (cached) return { ...cached.board, warnings: [...cached.board.warnings, err instanceof Error ? err.message : 'Refresh failed'] }
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
