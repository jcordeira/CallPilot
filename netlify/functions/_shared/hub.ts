import { createCalendarEvent, createGoogleTask, holdFollowUpSlot, listGoogleTasks, listUpcomingEvents } from './calendar'
import { isDemoMode } from './env'
import { getGoogleConnectionStatus, resolveGoogleAccessToken } from './googleAuth'
import { createTask, listOpenFubTasks } from './followupboss'
import { listLeadHeat, rescoreOpenLeads } from './leadHeat'
import { loanOfficer, loanOfficerAssistant } from './team'
import { ApiError, optionalNumber, optionalString } from './http'
import type { HubCalendarEvent, HubEventInput, HubSummary, HubTask, HubTaskInput, ScoredLead } from './hubTypes'
import { listActivity } from './store'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function assertIso(value: string, key: string): string {
  if (Number.isNaN(new Date(value).getTime())) throw new ApiError(400, `${key} must be an ISO date`)
  return value
}

export function taskInputFromBody(body: Record<string, unknown>): HubTaskInput {
  const title = optionalString(body, 'title')?.trim()
  if (!title) throw new ApiError(400, 'Title is required')
  const source = optionalString(body, 'source') ?? 'google'
  if (source !== 'google' && source !== 'fub' && source !== 'both') {
    throw new ApiError(400, 'source must be google, fub, or both')
  }
  const due = optionalString(body, 'due')
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due) && Number.isNaN(new Date(due).getTime())) {
    throw new ApiError(400, 'due must be a date')
  }
  return {
    title,
    notes: optionalString(body, 'notes')?.trim(),
    due,
    source,
    personId: optionalNumber(body, 'personId'),
    personName: optionalString(body, 'personName')?.trim(),
  }
}

export function eventInputFromBody(body: Record<string, unknown>): HubEventInput {
  return {
    summary: optionalString(body, 'summary')?.trim(),
    description: optionalString(body, 'description')?.trim(),
    startIso: optionalString(body, 'startIso'),
    endIso: optionalString(body, 'endIso'),
    attendeeEmail: optionalString(body, 'attendeeEmail')?.trim(),
    leadName: optionalString(body, 'leadName')?.trim(),
    hint: optionalString(body, 'hint')?.trim(),
  }
}

export async function getHubSummary(): Promise<HubSummary> {
  const warnings: string[] = []

  const [eventsResult, googleResult, fubTasks, activity, google] = await Promise.all([
    listUpcomingEvents(7).catch((err: unknown) => {
      warnings.push(errorMessage(err, 'Calendar unavailable'))
      return { events: [] as HubCalendarEvent[], demo: true }
    }),
    listGoogleTasks().catch((err: unknown) => {
      warnings.push(errorMessage(err, 'Google Tasks unavailable'))
      return { tasks: [] as HubTask[], demo: true }
    }),
    listOpenFubTasks().catch((err: unknown) => {
      warnings.push(errorMessage(err, 'Follow Up Boss tasks unavailable'))
      return [] as HubTask[]
    }),
    listActivity(12).catch((err: unknown) => {
      warnings.push(errorMessage(err, 'Activity unavailable'))
      return []
    }),
    getGoogleConnectionStatus(),
  ])

  if (!google.connected) {
    warnings.push('Google Calendar is not connected — connect it from the Hub to sync live events and tasks.')
  } else if (!google.configured && google.source === 'env') {
    warnings.push('Google is using a static access token. Prefer Connect Google (OAuth) so tokens refresh automatically.')
  }

  const tasks = [...googleResult.tasks, ...fubTasks]
  const calendarDemo = eventsResult.demo || googleResult.demo
  const heat = await listLeadHeat().catch(() => ({ leads: [], demo: isDemoMode() }))
  return {
    events: eventsResult.events,
    tasks,
    activity,
    warnings,
    google: {
      configured: google.configured,
      connected: google.connected,
      email: google.email,
      source: google.source,
    },
    leads: heat.leads,
    stats: {
      upcomingEvents: eventsResult.events.length,
      openTasks: tasks.filter((task) => task.status !== 'completed').length,
      recentReplies: activity.filter((item) => item.decision === 'replied').length,
      escalations: activity.filter((item) => item.decision === 'escalated').length,
      demo: calendarDemo,
    },
  }
}

export async function createHubTask(input: HubTaskInput): Promise<{ tasks: HubTask[] }> {
  const tasks: HubTask[] = []
  if (input.source === 'google' || input.source === 'both') {
    tasks.push(await createGoogleTask({ title: input.title, notes: input.notes, due: input.due }))
  }
  if (input.source === 'fub' || input.source === 'both') {
    const personId = input.personId ?? (isDemoMode() ? 1001 : undefined)
    if (!personId) throw new ApiError(400, 'personId is required to create a Follow Up Boss task')
    const teammate = /\bcall\b|appointment/i.test(input.title) ? loanOfficer() : loanOfficerAssistant()
    const created = await createTask({
      personId,
      name: input.title,
      type: /\bcall\b|appointment/i.test(input.title) ? 'Call' : 'Follow Up',
      dueDate: input.due?.slice(0, 10),
      assignedTo: teammate.name,
      assignedUserId: teammate.userId,
      personName: input.personName ?? (isDemoMode() ? 'Demo Lead' : undefined),
    })
    tasks.push({
      id: String(created.id),
      title: input.title,
      notes: input.notes,
      due: input.due?.slice(0, 10),
      status: 'needsAction',
      source: 'fub',
      personName: input.personName ?? (isDemoMode() ? 'Demo Lead' : undefined),
      personId,
      assignedTo: teammate.name,
    })
  }
  return { tasks }
}

export async function scoreHubLeads(): Promise<{ leads: ScoredLead[]; demo: boolean }> {
  await rescoreOpenLeads()
  return listLeadHeat()
}

export async function createHubEvent(input: HubEventInput): Promise<{ event: HubCalendarEvent }> {
  if (!input.startIso && input.leadName) {
    const held = await holdFollowUpSlot({
      leadName: input.leadName,
      hint: input.hint ?? input.description,
      attendeeEmail: input.attendeeEmail,
    })
    const start = new Date(held.startIso)
    return {
      event: {
        id: held.id,
        summary: `Call: ${input.leadName}`,
        description: input.hint ?? input.description,
        startIso: held.startIso,
        endIso: new Date(start.getTime() + 30 * 60_000).toISOString(),
        htmlLink: held.htmlLink,
        allDay: false,
        source: (await resolveGoogleAccessToken()).accessToken ? 'google' : 'demo',
      },
    }
  }

  if (!input.summary || !input.startIso || !input.endIso) {
    throw new ApiError(400, 'summary, startIso, and endIso are required')
  }
  const startIso = assertIso(input.startIso, 'startIso')
  const endIso = assertIso(input.endIso, 'endIso')
  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    throw new ApiError(400, 'endIso must be after startIso')
  }
  const created = await createCalendarEvent({
    summary: input.summary,
    description: input.description,
    startIso,
    endIso,
    attendeeEmail: input.attendeeEmail,
  })
  return {
    event: {
      id: created.id,
      summary: input.summary,
      description: input.description,
      startIso,
      endIso,
      htmlLink: created.htmlLink,
      allDay: false,
      source: (await resolveGoogleAccessToken()).accessToken ? 'google' : 'demo',
    },
  }
}
