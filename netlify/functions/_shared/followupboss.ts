import { env, isDemoMode } from './env'
import { loadHubExtras, rememberFubTask } from './hubExtras'
import type { HubTask } from './hubTypes'
import { shiftDateKey } from './hubTypes'

const FUB_BASE = 'https://api.followupboss.com/v1'

export type FubPerson = {
  id: number
  name: string
  emails?: { value: string }[]
  phones?: { value: string }[]
  stage?: string
  tags?: string[]
  lastActivity?: string
  updated?: string
  background?: string
}

export type FubEvent = {
  id?: number
  created?: string
  type?: string
  message?: string
  description?: string
  personId?: number
}

export type FubNote = {
  id: number
  personId?: number
  subject?: string
  body?: string
}

function authHeader(): string {
  const key = env('FOLLOW_UP_BOSS_API_KEY')
  // FUB uses HTTP Basic: API key as username, empty password
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

function systemHeader(): Record<string, string> {
  return {
    Authorization: authHeader(),
    'Content-Type': 'application/json',
    'X-System': env('FOLLOW_UP_BOSS_SYSTEM', 'LoanPilot'),
    'X-System-Key': env('FOLLOW_UP_BOSS_SYSTEM_KEY', 'loanpilot-local'),
  }
}

async function fubFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${FUB_BASE}${path}`, {
    ...init,
    headers: { ...systemHeader(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Follow Up Boss ${path} failed: ${res.status} ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export async function findPersonByEmail(email: string): Promise<FubPerson | null> {
  if (isDemoMode()) {
    if (!email || email.includes('ops@') || email.includes('title.')) return null
    const local = email.split('@')[0]?.replace(/[._]+/g, ' ').trim()
    const name = local ? local.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Demo Lead'
    return {
      id: 2101,
      name,
      emails: [{ value: email }],
      stage: 'Lead',
      tags: ['lead'],
    }
  }
  const data = (await fubFetch(`/people?email=${encodeURIComponent(email)}&limit=1`)) as {
    people?: FubPerson[]
  }
  return data.people?.[0] ?? null
}

export async function findPersonByPhone(phone: string): Promise<FubPerson | null> {
  if (isDemoMode()) {
    return {
      id: 2102,
      name: 'Demo SMS Lead',
      phones: [{ value: phone }],
      stage: 'Lead',
      tags: ['lead'],
    }
  }
  const data = (await fubFetch(`/people?phone=${encodeURIComponent(phone)}&limit=1`)) as {
    people?: FubPerson[]
  }
  return data.people?.[0] ?? null
}

/** Stages / tags that indicate a borrower lead rather than an ops contact. */
export function personLooksLikeLead(person: FubPerson | null): boolean | null {
  if (!person) return null
  const stage = (person.stage ?? '').toLowerCase()
  const tags = (person.tags ?? []).map((t) => t.toLowerCase())
  const opsStages = ['trash', 'sphere', 'vendor', 'agent', 'partner']
  if (opsStages.some((s) => stage.includes(s) || tags.includes(s))) return false
  if (tags.includes('ops') || tags.includes('vendor') || tags.includes('title')) return false
  return true
}

/** Open Follow Up Boss tasks for the hub. Demo fixtures when credentials are missing. */
export function demoFubTasks(now = new Date()): HubTask[] {
  return [
    {
      id: 'fub-5102',
      title: 'Follow up: pre-approval documents',
      due: shiftDateKey(now, 1),
      status: 'needsAction',
      source: 'fub',
      personName: 'Alex Buyer',
    },
    {
      id: 'fub-5103',
      title: 'Appointment: refinance call',
      due: shiftDateKey(now, 1),
      status: 'needsAction',
      source: 'fub',
      personName: 'Jordan Hale',
    },
  ]
}

function fubTaskIsDone(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

export async function listOpenFubTasks(): Promise<HubTask[]> {
  if (isDemoMode()) {
    const seen = new Set<string>()
    const extras = (await loadHubExtras()).fubTasks
    return [...extras, ...demoFubTasks()].filter((task) => {
      if (seen.has(task.id)) return false
      seen.add(task.id)
      return task.status !== 'completed'
    })
  }

  const data = (await fubFetch('/tasks?limit=50')) as {
    tasks?: {
      id: number
      name?: string
      isCompleted?: boolean | number | string
      dueDate?: string
      personId?: number
      personName?: string
      assignedTo?: string
    }[]
  }
  return (data?.tasks ?? [])
    .filter((task) => task?.id != null && !fubTaskIsDone(task.isCompleted))
    .map((task) => ({
      id: String(task.id),
      title: task.name?.trim() || 'Follow up',
      due: task.dueDate,
      status: 'needsAction' as const,
      source: 'fub' as const,
      personName: task.personName,
      personId: task.personId,
      assignedTo: typeof task.assignedTo === 'string' ? task.assignedTo : undefined,
    }))
}

function resolveAssignee(input: { assignedUserId?: number; assignedTo?: string }): { name: string; userId?: number } {
  if (input.assignedUserId && input.assignedUserId > 0) {
    return {
      userId: input.assignedUserId,
      name: input.assignedTo?.trim() || env('FOLLOW_UP_BOSS_ASSIGNED_TO', 'Me'),
    }
  }
  if (input.assignedTo?.trim()) return { name: input.assignedTo.trim() }
  const fallbackId = Number(env('FOLLOW_UP_BOSS_USER_ID') || '')
  if (Number.isInteger(fallbackId) && fallbackId > 0) {
    return { userId: fallbackId, name: env('FOLLOW_UP_BOSS_ASSIGNED_TO', 'Me') }
  }
  return { name: env('FOLLOW_UP_BOSS_ASSIGNED_TO', 'Me') }
}

export async function createTask(input: {
  personId: number
  name: string
  type?: string
  dueDate?: string
  assignedUserId?: number
  assignedTo?: string
  personName?: string
}): Promise<{ id: number }> {
  const assignee = resolveAssignee(input)
  if (isDemoMode()) {
    const id = Math.floor(Math.random() * 10_000) + 5000
    await rememberFubTask({
      id: String(id),
      title: input.name,
      due: input.dueDate,
      status: 'needsAction',
      source: 'fub',
      personName: input.personName ?? 'Demo Lead',
      personId: input.personId,
      assignedTo: assignee.name,
    })
    return { id }
  }
  const body: Record<string, unknown> = {
    personId: input.personId,
    name: input.name,
    type: input.type ?? 'Follow Up',
    dueDate: input.dueDate,
  }
  if (assignee.userId) body.assignedUserId = assignee.userId
  else body.assignedTo = assignee.name

  const data = (await fubFetch('/tasks', { method: 'POST', body: JSON.stringify(body) })) as {
    id: number
  }
  return { id: data.id }
}

export async function addNote(input: {
  personId: number
  subject: string
  body: string
}): Promise<void> {
  if (isDemoMode()) return
  await fubFetch('/notes', {
    method: 'POST',
    body: JSON.stringify({
      personId: input.personId,
      subject: input.subject,
      body: input.body,
      isHtml: false,
    }),
  })
}

export async function listPeople(limit = 30): Promise<FubPerson[]> {
  if (isDemoMode()) return []
  const data = (await fubFetch(`/people?limit=${limit}&sort=-updated`)) as { people?: FubPerson[] }
  return data.people ?? []
}

export async function getPerson(id: number): Promise<FubPerson | null> {
  if (isDemoMode() || !id) return null
  try {
    const data = (await fubFetch(`/people/${id}`)) as FubPerson & { person?: FubPerson }
    const person = data.person ?? data
    return person?.id ? person : null
  } catch {
    return null
  }
}

export async function listRecentEvents(personId: number): Promise<FubEvent[]> {
  if (isDemoMode() || !personId) return []
  try {
    const data = (await fubFetch(`/events?personId=${personId}&limit=8`)) as { events?: FubEvent[] }
    return data?.events ?? []
  } catch {
    return []
  }
}

export async function getNote(id: number): Promise<FubNote | null> {
  if (isDemoMode() || !id) return null
  try {
    const data = (await fubFetch(`/notes/${id}`)) as FubNote & { note?: FubNote }
    const note = data.note ?? data
    if (!note) return null
    return { id: note.id ?? id, personId: note.personId, subject: note.subject, body: note.body }
  } catch {
    return null
  }
}

/** Best-effort custom field. Missing fields are ignored so scoring still notes and tasks. */
export async function setLoanPilotScore(personId: number, score: number): Promise<boolean> {
  if (isDemoMode() || !personId) return false
  try {
    await fubFetch(`/people/${personId}`, {
      method: 'PUT',
      body: JSON.stringify({ customLoanPilotScore: score }),
    })
    return true
  } catch {
    return false
  }
}

export async function fubGet(path: string): Promise<unknown | null> {
  if (isDemoMode()) return null
  try {
    return await fubFetch(path)
  } catch {
    return null
  }
}
