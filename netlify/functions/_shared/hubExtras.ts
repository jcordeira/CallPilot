import { getStore } from '@netlify/blobs'
import { hideEventInLive, hideLeadInLive, hideTaskInLive } from './demoData'
import { isDemoMode } from './env'
import type { HubCalendarEvent, HubTask, ScoredLead } from './hubTypes'

type Extras = {
  events: HubCalendarEvent[]
  tasks: HubTask[]
  fubTasks: HubTask[]
  scoredLeads: ScoredLead[]
  hiddenEventIds?: string[]
  /** Set after the one-time removal of legacy colliding sample person ids. */
  demoPurged?: boolean
}

const empty = (): Extras => ({ events: [], tasks: [], fubTasks: [], scoredLeads: [] })
let memory: Extras = empty()

export function resetHubExtrasForTests() {
  memory = empty()
}

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
    scoredLeads: Array.isArray(raw.scoredLeads) ? raw.scoredLeads : [],
    hiddenEventIds: Array.isArray(raw.hiddenEventIds) ? raw.hiddenEventIds.filter((id) => typeof id === 'string') : [],
    demoPurged: raw.demoPurged === true,
  }
}

function clone(raw: Extras): Extras {
  return {
    events: [...raw.events],
    tasks: [...raw.tasks],
    fubTasks: [...raw.fubTasks],
    scoredLeads: [...raw.scoredLeads],
    hiddenEventIds: [...(raw.hiddenEventIds ?? [])],
    demoPurged: raw.demoPurged === true,
  }
}

/** Live reads drop sample calendar rows. Blob fubTasks are demo-only; live tasks come from the FUB API. */
export function projectLiveExtras(raw: Extras): Extras {
  const dropLegacy = raw.demoPurged !== true
  return {
    events: raw.events.filter((event) => !hideEventInLive(event)),
    tasks: raw.tasks.filter((task) => !hideTaskInLive(task)),
    fubTasks: [],
    scoredLeads: raw.scoredLeads.filter((lead) => !hideLeadInLive(lead, dropLegacy)),
    hiddenEventIds: raw.hiddenEventIds ?? [],
    demoPurged: raw.demoPurged === true,
  }
}

export async function loadHubExtrasRaw(): Promise<Extras> {
  const blob = store()
  if (blob) {
    try {
      const raw = normalize((await blob.get('extras', { type: 'json' })) as Partial<Extras> | null)
      if (raw) {
        memory = raw
        return clone(raw)
      }
    } catch {
      /* memory fallback */
    }
  }
  return clone(memory)
}

export async function loadHubExtras(): Promise<Extras> {
  const raw = await loadHubExtrasRaw()
  if (isDemoMode()) return raw
  return projectLiveExtras(raw)
}

export async function saveHubExtras(next: Extras) {
  memory = {
    events: next.events.slice(0, 40),
    tasks: next.tasks.slice(0, 40),
    fubTasks: next.fubTasks.slice(0, 40),
    scoredLeads: next.scoredLeads.slice(0, 40),
    hiddenEventIds: (next.hiddenEventIds ?? []).slice(0, 80),
    demoPurged: next.demoPurged === true,
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
  await saveHubExtras({ ...current, events: [event, ...current.events.filter((item) => item.id !== event.id)] })
}

export async function forgetHubEvent(id: string) {
  const current = await loadHubExtras()
  const hiddenEventIds = [...new Set([...(current.hiddenEventIds ?? []), id])].slice(0, 80)
  await saveHubExtras({
    ...current,
    events: current.events.filter((item) => item.id !== id),
    hiddenEventIds,
  })
}

export async function rememberHubTask(task: HubTask) {
  const current = await loadHubExtras()
  await saveHubExtras({ ...current, tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)] })
}

export async function rememberFubTask(task: HubTask) {
  const current = await loadHubExtras()
  await saveHubExtras({ ...current, fubTasks: [task, ...current.fubTasks.filter((item) => item.id !== task.id)] })
}

export async function loadScoredLeads(): Promise<ScoredLead[]> {
  const current = await loadHubExtras()
  return [...current.scoredLeads].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export async function rememberScoredLead(lead: ScoredLead) {
  const current = await loadHubExtras()
  const scoredLeads = [lead, ...current.scoredLeads.filter((item) => item.personId !== lead.personId)].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  )
  await saveHubExtras({ ...current, scoredLeads })
}
