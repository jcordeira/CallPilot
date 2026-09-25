import { getStore } from '@netlify/blobs'
import type { HubCalendarEvent, HubTask } from './hubTypes'

type Extras = {
  events: HubCalendarEvent[]
  tasks: HubTask[]
  fubTasks: HubTask[]
}

const empty = (): Extras => ({ events: [], tasks: [], fubTasks: [] })
let memory: Extras = empty()

function store() {
  try {
    return getStore('loanpilot-hub')
  } catch {
    return null
  }
}

function normalize(raw: Partial<Extras> | null | undefined): Extras | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    events: Array.isArray(raw.events) ? raw.events : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    fubTasks: Array.isArray(raw.fubTasks) ? raw.fubTasks : [],
  }
}

export async function loadHubExtras(): Promise<Extras> {
  const blob = store()
  if (blob) {
    try {
      const raw = normalize((await blob.get('extras', { type: 'json' })) as Partial<Extras> | null)
      if (raw) {
        memory = raw
        return {
          events: [...raw.events],
          tasks: [...raw.tasks],
          fubTasks: [...raw.fubTasks],
        }
      }
    } catch {
      /* memory fallback */
    }
  }
  return {
    events: [...memory.events],
    tasks: [...memory.tasks],
    fubTasks: [...memory.fubTasks],
  }
}

async function save(next: Extras) {
  memory = {
    events: next.events.slice(0, 40),
    tasks: next.tasks.slice(0, 40),
    fubTasks: next.fubTasks.slice(0, 40),
  }
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('extras', memory)
  } catch {
    /* memory fallback */
  }
}

export async function rememberHubEvent(event: HubCalendarEvent) {
  const current = await loadHubExtras()
  await save({ ...current, events: [event, ...current.events.filter((item) => item.id !== event.id)] })
}

export async function rememberHubTask(task: HubTask) {
  const current = await loadHubExtras()
  await save({ ...current, tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)] })
}

export async function rememberFubTask(task: HubTask) {
  const current = await loadHubExtras()
  await save({ ...current, fubTasks: [task, ...current.fubTasks.filter((item) => item.id !== task.id)] })
}
