import { readCalendarAttendeeAutoaddState } from './_shared/calendarAttendeeAutoadd'

/** Last auto-add run: counts, skip reasons, and FUB source names. No event titles or addresses. */
export default async () => {
  const state = await readCalendarAttendeeAutoaddState()
  if (!state.last) return Response.json({ ok: false, error: 'no run yet' }, { status: 404 })
  return Response.json(state.last)
}
