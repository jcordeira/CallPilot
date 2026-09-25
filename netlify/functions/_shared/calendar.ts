import { env, isDemoMode } from './env'

export async function createCalendarEvent(input: {
  summary: string
  description?: string
  startIso: string
  endIso: string
  attendeeEmail?: string
}): Promise<{ id: string; htmlLink?: string }> {
  if (isDemoMode() || !env('GOOGLE_CALENDAR_ACCESS_TOKEN')) {
    return { id: `cal-demo-${Date.now()}`, htmlLink: 'https://calendar.google.com/' }
  }

  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('GOOGLE_CALENDAR_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
    }),
  })
  if (!res.ok) throw new Error(`Calendar create failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { id: string; htmlLink?: string }
  return { id: data.id, htmlLink: data.htmlLink }
}

/** Hold a follow-up block on the LO calendar when a lead asks to talk. */
export async function holdFollowUpSlot(input: {
  leadName: string
  hint?: string
  attendeeEmail?: string
}): Promise<{ id: string; htmlLink?: string; startIso: string }> {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(10, 0, 0, 0)
  // Skip weekends
  if (start.getDay() === 0) start.setDate(start.getDate() + 1)
  if (start.getDay() === 6) start.setDate(start.getDate() + 2)
  const end = new Date(start.getTime() + 30 * 60_000)
  const event = await createCalendarEvent({
    summary: `Call: ${input.leadName}`,
    description: input.hint ?? 'AI assistant held this slot from a lead message. Confirm or reschedule.',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    attendeeEmail: input.attendeeEmail,
  })
  return { ...event, startIso: start.toISOString() }
}
