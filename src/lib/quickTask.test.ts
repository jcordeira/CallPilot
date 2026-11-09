import { afterEach, describe, expect, it, vi } from 'vitest'
import * as calendar from '../../netlify/functions/_shared/calendar'
import * as followupboss from '../../netlify/functions/_shared/followupboss'
import { createHubTask, etTaskStart, taskInputFromBody } from '../../netlify/functions/_shared/hub'
import { buildGlanceBoard } from '../../netlify/functions/_shared/glance'
import { nextOpenSlots } from './openSlots'
import { nextQuarterHourEt } from './quickTaskTime'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ASSISTANT_DEMO_MODE
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.FUB_LO_USER_ID
})

describe('quick task time', () => {
  it('defaults to the next Eastern quarter hour and keeps an exact boundary', () => {
    expect(nextQuarterHourEt(new Date('2026-11-09T19:07:00.000Z'))).toEqual({ date: '2026-11-09', time: '14:15' })
    expect(nextQuarterHourEt(new Date('2026-11-09T19:15:00.000Z'))).toEqual({ date: '2026-11-09', time: '14:15' })
    expect(nextQuarterHourEt(new Date('2026-11-09T19:15:30.000Z'))).toEqual({ date: '2026-11-09', time: '14:30' })
    expect(etTaskStart('2026-11-09', '14:15')).toBe('2026-11-09T19:15:00.000Z')
  })

  it('shows a timed Follow Up Boss task and a timed Google task on the glance', () => {
    const board = buildGlanceBoard({
      now: new Date('2026-11-09T15:00:00.000Z'),
      tasks: [{ id: 'g1', title: 'Lock the rate', due: '2026-11-09T19:15:00.000Z', status: 'needsAction', source: 'google' }],
      fubTasks: [{ id: 'f1', title: 'Call Alex', due: '2026-11-09T19:15:00.000Z', status: 'needsAction', source: 'fub' }],
      events: [],
    })
    expect(board.today.map((item) => [item.title, item.whenLabel])).toEqual([
      ['Call Alex', '2:15 PM'],
      ['Lock the rate', '2:15 PM'],
    ])
  })
})

describe('open calendar slots', () => {
  it('lists the next free 15-minute starts between 8 AM and 7 PM', () => {
    const slots = nextOpenSlots(new Date('2026-10-02T18:07:00.000Z'), [
      { startIso: '2026-10-02T18:00:00.000Z', endIso: '2026-10-02T18:30:00.000Z', allDay: false },
    ])
    expect(slots.slice(0, 3).map((slot) => slot.label)).toEqual(['Today 2:30 PM', 'Today 2:45 PM', 'Today 3 PM'])
    expect(slots).toHaveLength(5)
  })
})

describe('createHubTask', () => {
  it('gives Follow Up Boss a due time and Google a 15-minute calendar event', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    process.env.FUB_LO_USER_ID = '1'
    const events: { startIso?: string; endIso?: string; sendUpdates?: string; summary?: string }[] = []
    const google: { due?: string; dueAt?: string; notes?: string }[] = []
    const fub: { dueDate?: string; dueDateTime?: string }[] = []
    vi.spyOn(calendar, 'createGoogleTask').mockImplementation(async (input) => {
      google.push(input)
      return { id: 'gt-1', title: input.title, notes: input.notes, due: input.dueAt ?? input.due, status: 'needsAction', source: 'google' }
    })
    vi.spyOn(calendar, 'createCalendarEvent').mockImplementation(async (input) => {
      events.push(input)
      return { id: 'evt-1' }
    })
    vi.spyOn(followupboss, 'createTask').mockImplementation(async (input) => {
      fub.push(input)
      return { id: 42 }
    })

    const input = taskInputFromBody({
      title: 'Send the checklist',
      due: '2026-11-09',
      time: '14:15',
      allDay: false,
      source: 'both',
      personId: 1001,
    })
    const created = await createHubTask(input)
    expect(google[0]).toMatchObject({ due: '2026-11-09', dueAt: '2026-11-09T19:15:00.000Z' })
    expect(events[0]).toMatchObject({
      summary: 'Send the checklist',
      startIso: '2026-11-09T19:15:00.000Z',
      endIso: '2026-11-09T19:30:00.000Z',
      sendUpdates: 'none',
      quickTask: true,
    })
    expect(calendar.calendarWriteBody({
      summary: 'Send the checklist',
      startIso: '2026-11-09T19:15:00.000Z',
      endIso: '2026-11-09T19:30:00.000Z',
      quickTask: true,
    }).extendedProperties).toEqual({ private: { loanpilotQuickTask: '1' } })
    expect(fub[0]).toMatchObject({ dueDate: '2026-11-09', dueDateTime: '2026-11-09T19:15:00.000Z' })
    expect(created.tasks.map((task) => task.due)).toEqual(['2026-11-09T19:15:00.000Z', '2026-11-09T19:15:00.000Z'])

    events.length = 0
    await createHubTask({ ...input, source: 'google', allDay: true, time: undefined })
    expect(events).toHaveLength(0)
  })

  it('keeps a Google task time in notes because the Tasks API drops the clock', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const task = await calendar.createGoogleTask({ title: 'Call lender', notes: 'Bring the file', due: '2026-11-09', dueAt: '2026-11-09T19:15:00.000Z' })
    expect(task.due).toBe('2026-11-09T19:15:00.000Z')
    expect(task.notes).toBe('Bring the file')
    const stored = calendar.readGoogleTaskTime('LoanPilot time: 2026-11-09T19:15:00.000Z\nBring the file')
    expect(stored).toEqual({ dueAt: '2026-11-09T19:15:00.000Z', notes: 'Bring the file' })
  })
})
