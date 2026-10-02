import { CALENDAR_TIME_ZONE, deleteCalendarEvent, listEventsBetween, updateCalendarEvent, createCalendarEvent } from './calendar'
import { searchPeople } from './followupboss'
import { getGoogleConnectionStatus } from './googleAuth'
import { ApiError, jsonOk, optionalString } from './http'
import { listLeadHeat } from './leadHeat'

function requireString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key)?.trim()
  if (!value) throw new ApiError(400, `${key} is required`)
  return value
}

function iso(value: string, key: string): string {
  if (Number.isNaN(new Date(value).getTime())) throw new ApiError(400, `${key} must be a date`)
  return new Date(value).toISOString()
}

function emails(body: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(body.attendees)) return undefined
  return body.attendees.filter((item): item is string => typeof item === 'string')
}

function sendUpdates(body: Record<string, unknown>): 'all' | 'none' {
  return body.sendUpdates === 'all' ? 'all' : 'none'
}

export async function readCalendar(url: URL) {
  const start = new Date(url.searchParams.get('start') ?? '')
  const end = new Date(url.searchParams.get('end') ?? '')
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new ApiError(400, 'start and end must be a date range')
  }
  const [{ events, demo }, google, heat] = await Promise.all([
    listEventsBetween(start, end),
    getGoogleConnectionStatus(),
    listLeadHeat().catch(() => ({ leads: [], demo: true })),
  ])
  return {
    events,
    demo,
    timezone: CALENDAR_TIME_ZONE,
    google,
    leads: heat.leads.map((lead) => ({ personId: lead.personId, name: lead.name })),
  }
}

export async function createCalendar(body: Record<string, unknown>) {
  const summary = requireString(body, 'summary')
  const startIso = iso(requireString(body, 'startIso'), 'startIso')
  const endIso = iso(requireString(body, 'endIso'), 'endIso')
  if (new Date(endIso) <= new Date(startIso)) throw new ApiError(400, 'end must be after start')
  const created = await createCalendarEvent({
    summary,
    description: optionalString(body, 'description'),
    location: optionalString(body, 'location'),
    startIso,
    endIso,
    attendees: emails(body),
    sendUpdates: sendUpdates(body),
    timeZone: CALENDAR_TIME_ZONE,
  })
  return created
}

export async function patchCalendar(body: Record<string, unknown>) {
  const id = requireString(body, 'id')
  const summary = requireString(body, 'summary')
  const startIso = iso(requireString(body, 'startIso'), 'startIso')
  const endIso = iso(requireString(body, 'endIso'), 'endIso')
  if (new Date(endIso) <= new Date(startIso)) throw new ApiError(400, 'end must be after start')
  const event = await updateCalendarEvent({
    id,
    summary,
    description: optionalString(body, 'description'),
    location: optionalString(body, 'location'),
    startIso,
    endIso,
    attendees: emails(body) ?? [],
    sendUpdates: sendUpdates(body),
    timeZone: CALENDAR_TIME_ZONE,
  })
  return { event }
}

export async function removeCalendar(url: URL) {
  const id = url.searchParams.get('id')?.trim()
  if (!id) throw new ApiError(400, 'id is required')
  const notify = url.searchParams.get('sendUpdates') === 'all' ? 'all' : 'none'
  await deleteCalendarEvent(id, notify)
  return { deleted: id }
}

export async function peopleQuery(url: URL) {
  const people = await searchPeople(url.searchParams.get('q') ?? '')
  return { people }
}

export function calendarOk(data: unknown, status = 200) {
  return jsonOk(data, status)
}
