import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as calendar from '../../netlify/functions/_shared/calendar'
import * as followupboss from '../../netlify/functions/_shared/followupboss'
import {
  buildGlanceBoard,
  completeGlanceTask,
  formatEtClock,
  getGlanceBoard,
  getGlanceDetail,
  joeTaskAssigneeId,
  loadGlance,
  resetGlanceForTests,
  undoGlanceTask,
} from '../../netlify/functions/_shared/glance'
import { clearGoogleTokens, getGoogleConnectionStatus, GOOGLE_SCOPES, saveGoogleTokens, tasksCanRead } from '../../netlify/functions/_shared/googleAuth'
import type { HubCalendarEvent, HubTask } from '../../netlify/functions/_shared/hubTypes'

const NOW = new Date('2026-10-19T15:00:00.000Z')

function task(partial: Partial<HubTask> & Pick<HubTask, 'id' | 'title' | 'source'>): HubTask {
  return { status: 'needsAction', ...partial }
}

function event(partial: Partial<HubCalendarEvent> & Pick<HubCalendarEvent, 'id' | 'summary' | 'startIso'>): HubCalendarEvent {
  return {
    endIso: new Date(new Date(partial.startIso).getTime() + 30 * 60_000).toISOString(),
    allDay: false,
    source: 'google',
    ...partial,
  }
}

beforeEach(() => {
  resetGlanceForTests()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetGlanceForTests()
  await clearGoogleTokens()
  delete process.env.ASSISTANT_DEMO_MODE
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  delete process.env.GOOGLE_TASKS_ACCESS_TOKEN
  delete process.env.FUB_LO_USER_ID
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
})

describe('glance clock', () => {
  it('formats 12-hour America/New_York times', () => {
    expect(formatEtClock('2026-10-19T18:00:00.000Z')).toBe('2:00 PM')
    expect(formatEtClock('2026-01-15T15:00:00.000Z')).toBe('10:00 AM')
    expect(joeTaskAssigneeId()).toBe(1)
  })
})

describe('glance board', () => {
  it('puts overdue tasks first, keeps today compact, and holds the next 14 days', () => {
    const board = buildGlanceBoard({
      now: NOW,
      tasks: [
        task({
          id: 'g-today',
          title: 'Review the lock',
          source: 'google',
          due: '2026-10-19T00:00:00.000Z',
          notes: 'SECRET GOOGLE NOTES',
        }),
        task({ id: 'g-later', title: 'Next month docs', source: 'google', due: '2026-11-20' }),
        task({ id: 'g-open', title: 'Someday', source: 'demo', due: undefined }),
      ],
      fubTasks: [
        task({
          id: 'f-over',
          title: 'Call Alex',
          source: 'fub',
          due: '2026-10-18',
          personId: 1001,
          personName: 'Alex Buyer',
          notes: 'SECRET FUB NOTES',
        }),
        task({
          id: 'f-am',
          title: 'Morning follow up',
          source: 'fub',
          due: '2026-10-19T14:00:00.000Z',
          personId: 1001,
          personName: 'Alex Buyer',
        }),
        task({ id: 'f-pm', title: 'Evening follow up', source: 'fub', due: '2026-10-19T22:00:00.000Z' }),
        task({ id: 'f-frank', title: 'Frankie only', source: 'fub', due: '2026-10-19' }),
      ],
      events: [
        event({
          id: 'e-today',
          summary: 'Call Jordan',
          startIso: '2026-10-19T18:00:00.000Z',
          description: 'SECRET EVENT',
          location: 'Office',
          meetLink: 'https://meet.google.com/abc',
          attendees: [{ email: 'alex@example.com', displayName: 'Alex Buyer' }],
        }),
        event({ id: 'e-edge', summary: 'Day 14', startIso: '2026-11-01T15:00:00.000Z' }),
        event({ id: 'e-late', summary: 'Day 15', startIso: '2026-11-02T15:00:00.000Z' }),
        event({ id: 'e-old', summary: 'Yesterday', startIso: '2026-10-18T15:00:00.000Z' }),
      ],
    })

    expect(JSON.stringify(board)).not.toContain('SECRET')
    expect(board.today.map((item) => item.title)).toEqual([
      'Call Alex',
      'Morning follow up',
      'Call Jordan',
      'Evening follow up',
      'Frankie only',
      'Review the lock',
    ])
    expect(board.today.find((item) => item.title === 'Call Alex')).toMatchObject({
      overdue: true,
      whenLabel: 'Oct 18',
      personName: 'Alex Buyer',
      personId: 1001,
      source: 'fub',
    })
    expect(board.today.find((item) => item.title === 'Morning follow up')).toMatchObject({
      overdue: true,
      whenLabel: '10:00 AM',
    })
    expect(board.today.find((item) => item.title === 'Call Jordan')).toMatchObject({
      kind: 'appointment',
      whenLabel: '2:00 PM',
      overdue: false,
    })
    expect(board.today.find((item) => item.title === 'Review the lock')).toMatchObject({
      whenLabel: 'Today',
      overdue: false,
      source: 'google',
    })
    expect(board.today.find((item) => item.title === 'Evening follow up')?.overdue).toBe(false)
    expect(board.today.map((item) => item.title)).not.toContain('Next month docs')
    expect(board.today.map((item) => item.title)).not.toContain('Someday')
    expect(board.today.map((item) => item.title)).not.toContain('Day 15')
    expect(board.today.map((item) => item.title)).not.toContain('Yesterday')
    expect(board.all.map((item) => item.title)).toContain('Day 14')
    expect(board.all.map((item) => item.title)).toContain('Next month docs')
    expect(board.all.map((item) => item.title)).toContain('Someday')
    expect(board.all.map((item) => item.title)).not.toContain('Day 15')
    expect(board.all.map((item) => item.title)).not.toContain('Yesterday')
    expect(board.todayKey).toBe('2026-10-19')
  })
})

describe('glance loading', () => {
  it('asks Follow Up Boss for Joe only and still shows his tasks when Google fails', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    process.env.FUB_LO_USER_ID = '1'
    vi.spyOn(calendar, 'listGoogleTasks').mockRejectedValue(new Error('tasks down'))
    vi.spyOn(calendar, 'listEventsBetween').mockRejectedValue(new Error('calendar down'))
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('followupboss.com/v1/tasks')) {
          return new Response(
            JSON.stringify({
              tasks: [
                { id: 9, name: 'Joe task', isCompleted: 0, dueDate: '2026-10-18', personId: 1001, assignedUserId: 1 },
                { id: 8, name: 'Frankie task', isCompleted: 0, dueDate: '2026-10-19', personId: 1002, assignedUserId: 16 },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.includes('followupboss.com/v1/people')) {
          return new Response(JSON.stringify({ people: [{ id: 1001, name: 'Alex Buyer' }] }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }),
    )
    const board = await loadGlance(NOW)
    expect(board.warnings).toEqual(['Google unavailable'])
    expect(urls.some((url) => url.includes('assignedUserId=1'))).toBe(true)
    expect(urls.some((url) => url.includes('assignedUserId=16'))).toBe(false)
    expect(board.today.map((item) => item.title)).toEqual(['Joe task'])
    expect(board.all.map((item) => item.title)).not.toContain('Frankie task')
    expect(board.today[0]).toMatchObject({ personName: 'Alex Buyer', personId: 1001, overdue: true, source: 'fub' })
  })

  it('caches each source for 60 seconds and refetches only the one that changed', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const tasks = vi.spyOn(calendar, 'listGoogleTasks')
    const events = vi.spyOn(calendar, 'listEventsBetween')
    const fub = vi.spyOn(followupboss, 'listOpenFubTasksForUser')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'))
    await getGlanceBoard()
    await getGlanceBoard()
    expect(tasks).toHaveBeenCalledTimes(1)
    expect(tasks).toHaveBeenCalledWith(100)
    expect(events).toHaveBeenCalledTimes(1)
    expect(fub).toHaveBeenCalledTimes(1)
    await completeGlanceTask({ source: 'google', id: 'gtask-demo-review' })
    await getGlanceBoard()
    expect(tasks).toHaveBeenCalledTimes(2)
    expect(events).toHaveBeenCalledTimes(1)
    expect(fub).toHaveBeenCalledTimes(1)
    await undoGlanceTask({ source: 'google', id: 'gtask-demo-review' })
    const restored = await getGlanceBoard()
    expect(tasks).toHaveBeenCalledTimes(3)
    expect(fub).toHaveBeenCalledTimes(1)
    expect(restored.all.some((item) => item.id === 'gtask-demo-review')).toBe(true)
    vi.setSystemTime(new Date('2026-10-19T15:01:01.000Z'))
    await getGlanceBoard()
    expect(tasks).toHaveBeenCalledTimes(4)
    expect(events).toHaveBeenCalledTimes(2)
    expect(fub).toHaveBeenCalledTimes(2)
  })

  it('loads task notes and the Meet link only on the detail call', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const taskDetail = await getGlanceDetail({ source: 'google', kind: 'task', id: 'gtask-demo-review' })
    expect(taskDetail.notes).toMatch(/Escalate lock/)
    const notes = await getGlanceDetail({ source: 'fub', kind: 'task', id: 'fub-5102', personId: 1001 })
    expect(notes.personNotes?.map((note) => note.headline)).toEqual([
      'Docs requested',
      'Older rate conversation',
      'First inquiry',
    ])
    expect(notes.personNotes?.[1]?.long).toBe(true)

    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = 'tok'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/events/evt-1')) {
          return new Response(
            JSON.stringify({
              id: 'evt-1',
              summary: 'Closing',
              description: 'Bring the folder',
              location: 'Office',
              hangoutLink: 'https://meet.google.com/abc-defg-hij',
              htmlLink: 'https://calendar.google.com/event?eid=evt-1',
              start: { dateTime: '2026-10-19T18:00:00-04:00' },
              end: { dateTime: '2026-10-19T18:30:00-04:00' },
              attendees: [{ email: 'alex@example.com', displayName: 'Alex Buyer' }],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ notes: [] }), { status: 200 })
      }),
    )
    const detail = await getGlanceDetail({ source: 'google', kind: 'appointment', id: 'evt-1', personId: 1001 })
    expect(detail).toMatchObject({
      description: 'Bring the folder',
      location: 'Office',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      attendees: [{ label: 'Alex Buyer' }],
    })
    expect(detail.personNotes).toEqual([])
  })

  it('marks a Google task and a FUB task done', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    process.env.GOOGLE_TASKS_ACCESS_TOKEN = 'tok'
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? init.body : '',
        })
        return new Response('{}', { status: 200 })
      }),
    )
    await completeGlanceTask({ source: 'google', id: 'task-9' })
    await completeGlanceTask({ source: 'fub', id: '42' })
    const google = calls.find((call) => call.url.includes('/tasks/task-9'))
    expect(google?.method).toBe('PATCH')
    expect(google?.body).toContain('completed')
    const fub = calls.find((call) => call.url.includes('/v1/tasks/42'))
    expect(fub?.method).toBe('PUT')
    expect(fub?.body).toContain('"isCompleted":true')
    await undoGlanceTask({ source: 'google', id: 'task-9' })
    await undoGlanceTask({ source: 'fub', id: '42' })
    const reopened = calls.filter((call) => call.url.includes('/tasks/task-9') && call.method === 'PATCH')
    expect(reopened.at(-1)?.body).toContain('needsAction')
    const fubUndo = calls.find((call) => call.url.includes('/v1/tasks/42') && call.body.includes('false'))
    expect(fubUndo?.method).toBe('PUT')
    expect(fubUndo?.body).toContain('"isCompleted":false')
  })

  it('hides a demo task after it is marked done', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const before = await getGlanceBoard(new Date('2026-10-19T15:00:00.000Z'))
    expect(before.all.some((item) => item.id === 'gtask-demo-review')).toBe(true)
    await completeGlanceTask({ source: 'google', id: 'gtask-demo-review' })
    const after = await getGlanceBoard(new Date('2026-10-19T15:00:00.000Z'))
    expect(after.all.some((item) => item.id === 'gtask-demo-review')).toBe(false)
    await undoGlanceTask({ source: 'google', id: 'gtask-demo-review' })
    const undone = await getGlanceBoard(new Date('2026-10-19T15:00:00.000Z'))
    expect(undone.all.some((item) => item.id === 'gtask-demo-review')).toBe(true)
  })
})

describe('tasks scope', () => {
  it('asks for a reconnect when the saved grant cannot read Google Tasks', async () => {
    expect(tasksCanRead(GOOGLE_SCOPES)).toBe(true)
    expect(tasksCanRead('openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send')).toBe(false)
    await saveGoogleTokens({
      accessToken: 'oauth-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
      email: 'joseph@teamcordeira.com',
      connectedAt: new Date().toISOString(),
    })
    const missing = await getGoogleConnectionStatus()
    expect(missing.needsTasks).toBe(true)
    expect(missing.reconnect).toBe(true)
    expect(missing.canWrite).toBe(true)

    await saveGoogleTokens({
      accessToken: 'oauth-token',
      expiresAt: Date.now() + 3_600_000,
      scope: GOOGLE_SCOPES,
      email: 'joseph@teamcordeira.com',
      connectedAt: new Date().toISOString(),
    })
    const full = await getGoogleConnectionStatus()
    expect(full.needsTasks).toBe(false)
    expect(full.reconnect).toBe(false)
  })
})
