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
    return {
      id: 1001,
      name: 'Demo Lead',
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
      id: 1002,
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
    }))
}

export async function createTask(input: {
  personId: number
  name: string
  type?: string
  dueDate?: string
  assignedUserId?: number
}): Promise<{ id: number }> {
  if (isDemoMode()) {
    const id = Math.floor(Math.random() * 10_000) + 5000
    await rememberFubTask({
      id: String(id),
      title: input.name,
      due: input.dueDate,
      status: 'needsAction',
      source: 'fub',
      personName: 'Demo Lead',
    })
    return { id }
  }
  const assignedUserId = input.assignedUserId ?? Number(env('FOLLOW_UP_BOSS_USER_ID') || 0)
  const body: Record<string, unknown> = {
    personId: input.personId,
    name: input.name,
    type: input.type ?? 'Follow Up',
    dueDate: input.dueDate,
  }
  if (assignedUserId) body.assignedUserId = assignedUserId
  else body.assignedTo = env('FOLLOW_UP_BOSS_ASSIGNED_TO', 'Me')

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
