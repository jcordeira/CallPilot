import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarCanWriteEvents } from '../../netlify/functions/_shared/googleAuth'
import { calendarWriteBody, createCalendarEvent, exclusiveEndDate, listEventsBetween, mergeAttendees, updateCalendarEvent } from '../../netlify/functions/_shared/calendar'
import { createCalendar } from '../../netlify/functions/_shared/calendarApi'
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
    expect(JSON.parse(String(init.body)).start.dateTime).toBe('2026-10-03T14:00:00')
    expect(JSON.parse(String(init.body)).start.date).toBeNull()
  })

  it('creates a timed event with Eastern wall time and an all-day event with an exclusive end', async () => {
    expect(exclusiveEndDate('2026-10-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z')).toBe('2026-10-04')
    expect(calendarWriteBody({
      summary: 'Timed',
      startIso: '2026-10-03T18:00:00.000Z',
      endIso: '2026-10-03T19:00:00.000Z',
      timeZone: 'America/New_York',
    })).toMatchObject({
      start: { dateTime: '2026-10-03T14:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-03T15:00:00', timeZone: 'America/New_York' },
    })
    expect(calendarWriteBody({
      summary: 'All day',
      allDay: true,
      startIso: '2026-10-03T12:00:00.000Z',
      endIso: '2026-10-05T12:00:00.000Z',
    })).toMatchObject({
      start: { date: '2026-10-03' },
      end: { date: '2026-10-05' },
    })
    expect(calendarWriteBody({
      summary: 'All day patch',
      allDay: true,
      patch: true,
      startIso: '2026-10-03',
      endIso: '2026-10-03',
    }).start).toEqual({ date: '2026-10-03', dateTime: null })

    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = 'token'
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/events?')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'ad1',
            summary: 'Inspection',
            start: { date: '2026-10-03' },
            end: { date: '2026-10-04' },
          }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        id: 'created',
        summary: 'Created',
        start: { dateTime: '2026-10-03T14:00:00-04:00' },
        end: { dateTime: '2026-10-03T15:00:00-04:00' },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await createCalendar({
      summary: 'Timed booking',
      startIso: '2026-10-03T18:00:00.000Z',
      endIso: '2026-10-03T19:00:00.000Z',
      allDay: false,
      sendUpdates: 'none',
    })
    const timed = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(timed.start).toEqual({ dateTime: '2026-10-03T14:00:00', timeZone: 'America/New_York' })
    expect(timed.end).toEqual({ dateTime: '2026-10-03T15:00:00', timeZone: 'America/New_York' })
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('sendUpdates=none')

    await createCalendarEvent({
      summary: 'Office closed',
      startIso: '2026-10-03T12:00:00.000Z',
      endIso: '2026-10-03T12:00:00.000Z',
      allDay: true,
      timeZone: 'America/New_York',
    })
    const allDay = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(allDay.start).toEqual({ date: '2026-10-03' })
    expect(allDay.end).toEqual({ date: '2026-10-04' })
    expect(allDay.start.dateTime).toBeUndefined()

    const listed = await listEventsBetween(new Date('2026-10-03T04:00:00.000Z'), new Date('2026-10-04T04:00:00.000Z'))
    expect(listed.events[0]).toMatchObject({
      id: 'ad1',
      allDay: true,
      startIso: '2026-10-03T12:00:00.000Z',
      endIso: '2026-10-04T12:00:00.000Z',
    })
  })
})
