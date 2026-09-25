import { describe, expect, it } from 'vitest'
import { apiKeyIsValid, extractApiKey } from '../../netlify/functions/_shared/apiAuth'
import {
  createCalendarEvent,
  createGoogleTask,
  demoGoogleTasks,
  demoUpcomingEvents,
  listGoogleTasks,
  listUpcomingEvents,
} from '../../netlify/functions/_shared/calendar'

describe('apiKeyIsValid', () => {
  it('accepts the configured key', () => {
    expect(apiKeyIsValid('live-key', 'live-key', false)).toBe(true)
  })

  it('rejects a missing or wrong key', () => {
    expect(apiKeyIsValid(null, 'live-key', false)).toBe(false)
    expect(apiKeyIsValid('', 'live-key', false)).toBe(false)
    expect(apiKeyIsValid('nope', 'live-key', false)).toBe(false)
  })

  it('accepts demo-key only in demo mode', () => {
    expect(apiKeyIsValid('demo-key', '', true)).toBe(true)
    expect(apiKeyIsValid('demo-key', 'live-key', true)).toBe(true)
    expect(apiKeyIsValid('demo-key', 'live-key', false)).toBe(false)
    expect(apiKeyIsValid('demo-key', '', false)).toBe(false)
  })

  it('does not treat an empty configured key as a match', () => {
    expect(apiKeyIsValid('', '', true)).toBe(false)
  })
})

describe('extractApiKey', () => {
  it('reads bearer tokens and X-Api-Key', () => {
    expect(extractApiKey(new Headers({ Authorization: 'Bearer abc' }))).toBe('abc')
    expect(extractApiKey(new Headers({ Authorization: 'bearer abc' }))).toBe('abc')
    expect(extractApiKey(new Headers({ 'X-Api-Key': 'xyz' }))).toBe('xyz')
    expect(extractApiKey(new Headers())).toBeNull()
  })

  it('prefers the bearer token when both headers are present', () => {
    const headers = new Headers({ Authorization: 'Bearer from-auth', 'X-Api-Key': 'from-header' })
    expect(extractApiKey(headers)).toBe('from-auth')
  })
})

describe('demoGoogleTasks', () => {
  it('lists open sample tasks', () => {
    const now = new Date(2026, 8, 25, 9, 0, 0)
    const tasks = demoGoogleTasks(now)
    expect(tasks).toHaveLength(3)
    expect(tasks.every((task) => task.status === 'needsAction')).toBe(true)
    expect(tasks.some((task) => /pre-approval/i.test(task.title))).toBe(true)
    expect(tasks.map((task) => task.due)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27'])
  })
})

describe('demoUpcomingEvents', () => {
  it('keeps events inside the requested window', () => {
    const now = new Date(2026, 8, 25, 9, 0, 0)
    const week = demoUpcomingEvents(now, 7)
    const oneDay = demoUpcomingEvents(now, 1)
    expect(oneDay.map((event) => event.summary)).toEqual(['Call: Jordan Hale'])
    expect(week.map((event) => event.summary)).toEqual([
      'Call: Jordan Hale',
      'Call: Alex Buyer',
      'Rate review: Sam Ortiz',
    ])
  })
})

describe('google demo listing', () => {
  it('returns sample tasks and a newly created task when no token is set', async () => {
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    delete process.env.GOOGLE_TASKS_ACCESS_TOKEN
    process.env.ASSISTANT_DEMO_MODE = 'true'

    const created = await createGoogleTask({ title: 'Call the appraiser', due: '2026-09-28' })
    const listed = await listGoogleTasks()
    expect(listed.demo).toBe(true)
    expect(listed.tasks.some((task) => task.id === created.id && task.title === 'Call the appraiser')).toBe(true)
    expect(listed.tasks.every((task) => task.status === 'needsAction')).toBe(true)
  })

  it('includes a calendar hold created in demo mode', async () => {
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const start = new Date(Date.now() + 2 * 60 * 60_000)
    const end = new Date(start.getTime() + 30 * 60_000)
    const created = await createCalendarEvent({
      summary: 'Call: Test Lead',
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    const listed = await listUpcomingEvents(7)
    expect(listed.demo).toBe(true)
    expect(listed.events.some((event) => event.id === created.id && event.summary === 'Call: Test Lead')).toBe(true)
  })
})
