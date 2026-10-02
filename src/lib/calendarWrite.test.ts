import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarCanWriteEvents } from '../../netlify/functions/_shared/googleAuth'
import { calendarWriteBody, mergeAttendees, updateCalendarEvent } from '../../netlify/functions/_shared/calendar'
import { clientCallTitle, externalGuestEmails } from './calendarGuests'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  delete process.env.ASSISTANT_DEMO_MODE
  delete process.env.FOLLOW_UP_BOSS_API_KEY
})

describe('calendar writes', () => {
  it('keeps the full guest list when an event is patched', async () => {
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar')).toBe(true)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.events')).toBe(true)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
    expect(mergeAttendees(
      [{ email: 'fcordeirajr@cliffcomortgage.com', responseStatus: 'accepted' }, { email: 'old@example.com' }],
      ['fcordeirajr@cliffcomortgage.com', 'alex.buyer@gmail.com'],
    )).toEqual([
      { email: 'fcordeirajr@cliffcomortgage.com', responseStatus: 'accepted' },
      { email: 'alex.buyer@gmail.com' },
    ])
    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = 'token'
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'evt-1',
      summary: 'Alex Buyer call refi',
      start: { dateTime: '2026-10-03T18:00:00.000Z' },
      end: { dateTime: '2026-10-03T18:30:00.000Z' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await updateCalendarEvent({
      id: 'evt-1',
      summary: 'Alex Buyer call refi',
      startIso: '2026-10-03T18:00:00.000Z',
      endIso: '2026-10-03T18:30:00.000Z',
      attendees: ['fcordeirajr@cliffcomortgage.com', 'alex.buyer@gmail.com'],
      existingAttendees: [{ email: 'fcordeirajr@cliffcomortgage.com', responseStatus: 'accepted' }],
      sendUpdates: 'none',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/events/evt-1?sendUpdates=none')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(String(init.body))
    expect(body.attendees).toEqual([
      { email: 'fcordeirajr@cliffcomortgage.com', responseStatus: 'accepted' },
      { email: 'alex.buyer@gmail.com' },
    ])
    expect(body.start.timeZone).toBe('America/New_York')
    expect(calendarWriteBody({ summary: 'A', startIso: '2026-10-03T18:00:00.000Z', endIso: '2026-10-03T18:30:00.000Z' }).summary).toBe('A')
    expect(clientCallTitle('Alex Buyer', 'refi call')).toBe('Alex Buyer call refi')
    expect(externalGuestEmails(['Joseph@teamcordeira.com', 'drose@cliffcomortgage.com'])).toEqual(['drose@cliffcomortgage.com'])
  })
})
