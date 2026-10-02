import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attendeesWithGuests,
  calendarGuestSettings,
  classifyClientAppointment,
  guestAlreadyPresent,
  calendarWriteMissing,
  resetCalendarGuestStateForTests,
  runCalendarGuest,
  type GuestEvent,
} from '../../netlify/functions/_shared/calendarGuest'
import { calendarCanWriteEvents, clearGoogleTokens, getGoogleConnectionStatus, gmailCanSend, GOOGLE_SCOPES, saveGoogleTokens } from '../../netlify/functions/_shared/googleAuth'

const frankie = 'fcordeirajr@cliffcomortgage.com'
const start = '2026-10-05T15:00:00.000Z'

function event(partial: Partial<GuestEvent> & { summary: string }): GuestEvent {
  return {
    id: partial.id ?? partial.summary,
    summary: partial.summary,
    description: partial.description,
    startIso: partial.startIso ?? start,
    endIso: partial.endIso ?? '2026-10-05T15:30:00.000Z',
    allDay: partial.allDay ?? false,
    status: partial.status,
    attendees: partial.attendees ?? [{ email: 'client@example.com', responseStatus: 'accepted' }],
  }
}

beforeEach(async () => {
  process.env.CALENDAR_AUTO_GUEST_ENABLED = 'true'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  delete process.env.CALENDAR_AUTO_GUEST_DRY_RUN
  delete process.env.CALENDAR_AUTO_GUEST_EMAILS
  delete process.env.CALENDAR_AUTO_GUEST_INCLUDE
  delete process.env.CALENDAR_AUTO_GUEST_EXCLUDE
  delete process.env.CALENDAR_AUTO_GUEST_NOTIFY
  delete process.env.GMAIL_ACCESS_TOKEN
  await resetCalendarGuestStateForTests()
  await clearGoogleTokens()
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('network')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of [
    'CALENDAR_AUTO_GUEST_ENABLED',
    'CALENDAR_AUTO_GUEST_DRY_RUN',
    'CALENDAR_AUTO_GUEST_EMAILS',
    'CALENDAR_AUTO_GUEST_INCLUDE',
    'CALENDAR_AUTO_GUEST_EXCLUDE',
    'CALENDAR_AUTO_GUEST_NOTIFY',
    'GMAIL_ACCESS_TOKEN',
    'FOLLOW_UP_BOSS_API_KEY',
  ]) {
    delete process.env[key]
  }
  process.env.ASSISTANT_DEMO_MODE = 'true'
})

describe('classifyClientAppointment', () => {
  it('includes booked appointments and named client calls', () => {
    expect(
      classifyClientAppointment(
        event({
          summary: 'Joe & Emily Cordeira (Client Name)',
          description: '<b>Booked by</b> Emily Cordeira emily@example.com 516-555-0100',
        }),
      ).include,
    ).toBe(true)
    expect(classifyClientAppointment(event({ summary: 'Siddick Chowdhury call refi' })).reason).toBe('client call')
    expect(
      classifyClientAppointment(event({ summary: 'Pat Nguyen' }), ['Pat Nguyen']).reason,
    ).toBe('lead Pat Nguyen')
  })

  it('excludes internal, personal, all-day, and birthday events', () => {
    const titles = [
      'Galligan Group / Team Cordeira Weekly Meetings',
      'Week Setup',
      'Joe Cordeira + Alicia Meeting',
      'Heloc steps',
      'Eric / Joe',
    ]
    for (const summary of titles) {
      expect(classifyClientAppointment(event({ summary })).include, summary).toBe(false)
    }
    expect(classifyClientAppointment(event({ summary: 'Mom birthday dinner' })).include).toBe(false)
    expect(
      classifyClientAppointment(event({ summary: 'Siddick Chowdhury call refi', allDay: true })).include,
    ).toBe(false)
    expect(classifyClientAppointment(event({ summary: 'Call with the team' })).include).toBe(false)
  })

  it('honors include and exclude keywords from the environment', () => {
    process.env.CALENDAR_AUTO_GUEST_EXCLUDE = 'chowdhury'
    expect(classifyClientAppointment(event({ summary: 'Siddick Chowdhury call refi' })).include).toBe(false)
    process.env.CALENDAR_AUTO_GUEST_EXCLUDE = 'birthday'
    process.env.CALENDAR_AUTO_GUEST_INCLUDE = 'zoom'
    expect(classifyClientAppointment(event({ summary: 'Siddick Chowdhury zoom' })).reason).toBe('client call')
    expect(classifyClientAppointment(event({ summary: 'Siddick Chowdhury call refi' })).include).toBe(false)
  })
})

describe('calendar guest updates', () => {
  it('appends Frankie once and does not patch when she is already a guest', async () => {
    const patches: { emails: string[]; sendUpdates: string }[] = []
    const invites: string[] = []
    const client = event({ id: 'evt-1', summary: 'Siddick Chowdhury call refi' })
    const first = await runCalendarGuest({
      events: [client],
      patch: async (input) => {
        patches.push({ emails: input.attendees.map((attendee) => attendee.email), sendUpdates: input.sendUpdates })
      },
      sendInvite: async (input) => {
        invites.push(input.to)
      },
    })
    expect(first.added).toBe(1)
    expect(patches).toEqual([{ emails: ['client@example.com', frankie], sendUpdates: 'none' }])
    expect(invites).toEqual([frankie])
    expect(fetch).not.toHaveBeenCalled()

    const second = await runCalendarGuest({
      events: [{ ...client, attendees: attendeesWithGuests(client, [frankie]) }],
      patch: async () => {
        throw new Error('should not patch')
      },
      sendInvite: async () => {
        throw new Error('should not email')
      },
    })
    expect(second.added).toBe(0)
    expect(second.previews[0]?.action).toBe('already')
    expect(guestAlreadyPresent(second.previews[0] ? { ...client, attendees: attendeesWithGuests(client, [frankie]) } : client, [frankie])).toBe(true)
  })

  it('keeps the existing guest response when appending', () => {
    const next = attendeesWithGuests(
      event({
        summary: 'Siddick Chowdhury call refi',
        attendees: [{ email: 'client@example.com', responseStatus: 'accepted', optional: true, additionalGuests: 1 }],
      }),
      [frankie],
    )
    expect(next[0]).toMatchObject({
      email: 'client@example.com',
      responseStatus: 'accepted',
      optional: true,
      additionalGuests: 1,
    })
    expect(next.map((attendee) => attendee.email)).toEqual(['client@example.com', frankie])
  })

  it('does not patch or email during a dry run', async () => {
    const patch = vi.fn()
    const sendInvite = vi.fn()
    const result = await runCalendarGuest({
      dryRun: true,
      events: [event({ id: 'evt-dry', summary: 'Siddick Chowdhury call refi' })],
      patch,
      sendInvite,
    })
    expect(result.dryRun).toBe(true)
    expect(result.added).toBe(0)
    expect(result.previews[0]?.action).toBe('add')
    expect(patch).not.toHaveBeenCalled()
    expect(sendInvite).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses Google notifications only when notify is all', async () => {
    process.env.CALENDAR_AUTO_GUEST_NOTIFY = 'all'
    expect(calendarGuestSettings().notify).toBe('all')
    const seen: string[] = []
    const sendInvite = vi.fn(async () => undefined)
    await runCalendarGuest({
      events: [event({ id: 'evt-2', summary: 'Siddick Chowdhury call refi' })],
      patch: async (input) => {
        seen.push(input.sendUpdates)
      },
      sendInvite,
    })
    expect(seen).toEqual(['all'])
    expect(sendInvite).not.toHaveBeenCalled()
  })
})

describe('calendar write scope', () => {
  it('accepts calendar and calendar.events, and rejects readonly grants', () => {
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks')).toBe(true)
    expect(calendarCanWriteEvents('openid https://www.googleapis.com/auth/calendar.events')).toBe(true)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.events.readonly')).toBe(false)
    expect(calendarCanWriteEvents(undefined)).toBe(false)
    expect(calendarCanWriteEvents('')).toBe(false)
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(gmailCanSend(GOOGLE_SCOPES)).toBe(true)
    expect(gmailCanSend('https://www.googleapis.com/auth/calendar')).toBe(false)
  })

  it('refuses to patch when the stored OAuth grant cannot write events', async () => {
    await saveGoogleTokens({
      accessToken: 'readonly-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      connectedAt: new Date().toISOString(),
    })
    expect(await calendarWriteMissing()).toBe(true)
    const result = await runCalendarGuest({
      events: [event({ id: 'evt-scope', summary: 'Siddick Chowdhury call refi' })],
    })
    expect(result.skipped).toBe('scope')
    expect(result.added).toBe(0)
    expect(fetch).not.toHaveBeenCalled()

    await saveGoogleTokens({
      accessToken: 'write-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks',
      connectedAt: new Date().toISOString(),
    })
    expect(await calendarWriteMissing()).toBe(false)
  })

  it('emails Frankie from the OAuth token when gmail.send is granted', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    await saveGoogleTokens({
      accessToken: 'oauth-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
      email: 'joseph@teamcordeira.com',
      connectedAt: new Date().toISOString(),
    })
    const calls: { url: string; auth: string | null; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({ url: String(input), auth: headers.get('authorization'), body: typeof init?.body === 'string' ? init.body : '' })
      return new Response('{}', { status: 200 })
    }))
    const result = await runCalendarGuest({
      events: [event({ id: 'evt-ics', summary: 'Siddick Chowdhury call refi' })],
      patch: async () => undefined,
    })
    expect(result.added).toBe(1)
    const gmail = calls.find((call) => call.url.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send'))
    expect(gmail?.auth).toBe('Bearer oauth-token')
    expect(gmail?.body).toContain('"raw"')
    expect(calls.some((call) => call.url.includes('sendUpdates=all'))).toBe(false)
  })

  it('adds Frankie quietly when the stored grant cannot send mail', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    await saveGoogleTokens({
      accessToken: 'oauth-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid email https://www.googleapis.com/auth/calendar',
      email: 'joseph@teamcordeira.com',
      connectedAt: new Date().toISOString(),
    })
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response('{}', { status: 200 })
    }))
    const status = await getGoogleConnectionStatus()
    expect(status.canWrite).toBe(true)
    expect(status.needsGmailSend).toBe(true)
    expect(status.reconnect).toBe(true)
    const result = await runCalendarGuest({
      events: [event({ id: 'evt-quiet', summary: 'Siddick Chowdhury call refi' })],
      patch: async () => undefined,
    })
    expect(result.added).toBe(1)
    expect(urls.some((url) => url.includes('gmail.googleapis.com'))).toBe(false)
  })
})
