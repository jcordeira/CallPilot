import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import { scoreLead } from '../../netlify/functions/_shared/leadScore'
import {
  collectMissedItems,
  clipSms,
  digestSms,
  mentionNoteHtml,
  normalizePhone,
  reminderSeats,
  runLoaReminders,
  zonedDateTimeToUtc,
  type NotePayload,
  type ReminderSource,
} from '../../netlify/functions/_shared/loaReminders'
import { resetReminderStateForTests } from '../../netlify/functions/_shared/loaReminderStore'
import { QuoSmsError, resetQuoForTests, sendSmsIfConfigured } from '../../netlify/functions/_shared/quo'
import { followUpPlan } from '../../netlify/functions/_shared/team'

const now = new Date('2026-10-02T15:00:00.000Z')

const frankie = '+15555550116'
const daniel = '+15555550127'
const joseph = '+15555550101'

function reminderEnv() {
  process.env.LOA_REMINDERS_ENABLED = 'true'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  process.env.FUB_LO_USER_ID = '1'
  process.env.FUB_LO_NAME = 'Joseph Cordeira'
  process.env.FUB_LO_PHONE = joseph
  process.env.FUB_LOA_USER_ID = '16'
  process.env.FUB_LOA_NAME = 'Frank Cordeira'
  process.env.FUB_LOA_USER_IDS = '16,27'
  process.env.FUB_LOA_NAME_16 = 'Frankie Cordeira'
  process.env.FUB_LOA_PHONE_16 = frankie
  process.env.FUB_LOA_NAME_27 = 'Daniel Ebbecke'
  process.env.FUB_LOA_PHONE_27 = daniel
  process.env.LOA_REMINDER_LOOKBACK_HOURS = '24'
  process.env.LOA_REMINDER_TEXT_WINDOW_MINUTES = '120'
  process.env.LOA_REMINDER_CALL_GRACE_MINUTES = '15'
  process.env.LOA_REMINDER_TIMEZONE = 'America/New_York'
  process.env.LOA_REMINDER_MAX_NOTES = '15'
  delete process.env.LOA_REMINDERS_DRY_RUN
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  delete process.env.FUB_LOA_PHONE
}

function clearReminderEnv() {
  for (const key of [
    'LOA_REMINDERS_ENABLED',
    'LOA_REMINDERS_DRY_RUN',
    'LOA_REMINDER_LOOKBACK_HOURS',
    'LOA_REMINDER_TEXT_WINDOW_MINUTES',
    'LOA_REMINDER_CALL_GRACE_MINUTES',
    'LOA_REMINDER_TIMEZONE',
    'LOA_REMINDER_MAX_NOTES',
    'FUB_LO_USER_ID',
    'FUB_LO_NAME',
    'FUB_LO_PHONE',
    'FUB_LOA_USER_ID',
    'FUB_LOA_NAME',
    'FUB_LOA_USER_IDS',
    'FUB_LOA_NAME_16',
    'FUB_LOA_PHONE_16',
    'FUB_LOA_NAME_27',
    'FUB_LOA_PHONE_27',
    'FUB_LOA_NAME_32',
    'FUB_LOA_PHONE_32',
    'FUB_LOA_PHONE',
    'QUO_API_KEY',
    'QUO_FROM_NUMBER',
  ]) {
    delete process.env[key]
  }
  process.env.ASSISTANT_DEMO_MODE = 'true'
}

function source(): ReminderSource {
  return {
    people: [
      { id: 100, name: 'Alex Buyer', assignedUserId: 16 },
      { id: 101, name: 'Riley Warm', assignedUserId: 16 },
      { id: 200, name: 'Sam Rivera', assignedUserId: 27 },
      { id: 300, name: 'Casey Hot', assignedUserId: 1 },
    ],
    tasks: [
      { id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
      { id: 2, name: 'Ancient follow up', isCompleted: 0, dueDate: '2026-09-01', personId: 100, assignedUserId: 16 },
      { id: 3, name: 'Text Sam', isCompleted: 0, dueDate: '2026-10-01', personId: 200, assignedUserId: 27 },
      { id: 4, name: 'Call Casey', isCompleted: 0, dueDate: '2026-10-01', personId: 300, assignedUserId: 1 },
      { id: 5, name: 'Still due today', isCompleted: 0, dueDate: '2026-10-02', personId: 100, assignedUserId: 16 },
      { id: 6, name: 'Done', isCompleted: 1, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
      { id: 7, name: 'Riley task', isCompleted: 0, dueDate: '2026-10-01', personId: 101, assignedUserId: 16 },
    ],
    texts: [
      { id: 50, personId: 100, isIncoming: true, created: '2026-10-02T12:00:00.000Z', message: 'Are you there?' },
      { id: 51, personId: 200, isIncoming: true, created: '2026-10-02T14:30:00.000Z', message: 'Just now' },
      { id: 52, personId: 200, isIncoming: true, created: '2026-10-02T10:00:00.000Z', message: 'Earlier' },
      { id: 53, personId: 200, isIncoming: false, created: '2026-10-02T11:00:00.000Z', message: 'On it' },
    ],
    calls: [
      { id: 70, personId: 100, isIncoming: true, outcome: 'No Answer', created: '2026-10-02T13:00:00.000Z', duration: 0 },
      { id: 71, personId: 300, isIncoming: true, outcome: 'Left Message', created: '2026-10-02T13:00:00.000Z', duration: 12 },
      { id: 72, personId: 300, isIncoming: true, outcome: 'No Answer', created: '2026-10-02T12:00:00.000Z', duration: 0 },
      { id: 73, personId: 300, isIncoming: false, outcome: 'Interested', created: '2026-10-02T12:30:00.000Z', duration: 40 },
      { id: 74, personId: 100, isIncoming: true, outcome: 'Interested', created: '2026-10-02T13:10:00.000Z', duration: 80 },
      { id: 75, personId: 100, isIncoming: false, outcome: 'No Answer', created: '2026-10-02T11:00:00.000Z', duration: 0 },
    ],
    googleTasks: [
      { id: 'g1', title: 'Send checklist', due: '2026-10-01', status: 'needsAction' },
      { id: 'g2', title: 'Ancient Google task', due: '2026-09-01', status: 'needsAction' },
      { id: 'g3', title: 'Due today', due: '2026-10-02', status: 'needsAction' },
      { id: 'g4', title: 'Finished', due: '2026-10-01', status: 'completed' },
    ],
  }
}

beforeEach(async () => {
  resetQuoForTests()
  await resetReminderStateForTests()
  reminderEnv()
})

afterEach(async () => {
  clearReminderEnv()
  resetQuoForTests()
  await resetReminderStateForTests()
  vi.unstubAllGlobals()
})

describe('reminder seats and routing', () => {
  it('keeps hot calls on Joseph and warm texts on the primary LOA', () => {
    const hot = followUpPlan(
      scoreLead({
        stage: 'Lead',
        recentText: 'Docs are ready and we are ready to buy. Can you send the pre-approval?',
        lastInboundAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
        now,
      }),
      'Alex Buyer',
      now,
    )
    const warm = followUpPlan(
      scoreLead({
        stage: 'Lead',
        recentText: 'Thinking about refinance rates this week.',
        lastInboundAt: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
        now,
      }),
      'Jordan Hale',
      now,
    )
    expect(hot?.assignedUserId).toBe(1)
    expect(hot?.taskType).toBe('Call')
    expect(warm?.assignedUserId).toBe(16)
    expect(warm?.taskType).toBe('Text')
    expect(reminderSeats().map((seat) => [seat.role, seat.userId, seat.name, seat.fubNote])).toEqual([
      ['lo', 1, 'Joseph Cordeira', false],
      ['loa', 16, 'Frankie Cordeira', true],
      ['loa', 27, 'Daniel Ebbecke', true],
    ])
  })

  it('normalizes configured mobiles and does not invent a from-number', () => {
    expect(normalizePhone('(555) 555-0100')).toBe('+15555550100')
    expect(normalizePhone('+16315550199')).toBe('+16315550199')
    expect(normalizePhone('')).toBeUndefined()
  })
})

describe('miss detection', () => {
  it('converts Eastern midnight to UTC', () => {
    expect(zonedDateTimeToUtc('2026-10-02', '00:00:00', 'America/New_York').toISOString()).toBe('2026-10-02T04:00:00.000Z')
  })

  it('builds the mention chip the FUB app posts', () => {
    const html = mentionNoteHtml(16, 'Frankie Cordeira', ['Overdue task: Follow up'])
    expect(html).toContain('<span data-user-id="16">Frankie Cordeira</span>')
    expect(html).not.toContain('@Frankie')
  })

  it('drops the historical backlog and keeps yesterday', () => {
    const items = collectMissedItems({
      seats: reminderSeats(),
      source: source(),
      now,
      cutoff: new Date(now.getTime() - 24 * 3_600_000),
      timeZone: 'America/New_York',
      textWindowMinutes: 120,
      callGraceMinutes: 15,
      already: {},
    })
    const keys = items.map((item) => item.key)
    expect(keys).toContain('fub-task:1')
    expect(keys).not.toContain('fub-task:2')
    expect(keys).not.toContain('fub-task:5')
    expect(keys).not.toContain('fub-task:6')
    expect(keys).toContain('fub-text:50')
    expect(keys).not.toContain('fub-text:51')
    expect(keys).not.toContain('fub-text:52')
    expect(keys).toContain('fub-call:70')
    expect(keys).toContain('fub-call:71')
    expect(keys).not.toContain('fub-call:72')
    expect(keys).not.toContain('fub-call:74')
    expect(keys).not.toContain('fub-call:75')
    expect(keys).toContain('google-task:g1')
    expect(keys).not.toContain('google-task:g2')
    expect(keys).not.toContain('google-task:g3')
  })

  it('says needs for one digest item and need for several', () => {
    const item = (key: string): Parameters<typeof digestSms>[1][number] => ({
      key,
      kind: 'task',
      seatUserId: 1,
      personName: 'Alex Buyer',
      title: 'Follow up',
      line: 'Overdue task: Follow up',
      missedAt: now.toISOString(),
    })
    expect(digestSms('Joseph Cordeira', [item('a')])).toMatch(/^LoanPilot: Joseph Cordeira, 1 item needs you\./)
    expect(digestSms('Joseph Cordeira', [item('a'), item('b')])).toMatch(/^LoanPilot: Joseph Cordeira, 2 items need you\./)
  })

  it('keeps the Follow Up Boss profile link whole when the digest is long', () => {
    const href = 'https://teamcordeira.followupboss.com/2/people/view/100'
    const items = Array.from({ length: 8 }, (_, index) => ({
      key: `task-${index}`,
      kind: 'task' as const,
      seatUserId: 1,
      personId: 100,
      personName: 'Alex Buyer',
      title: 'Follow up',
      line: `Overdue task: ${'documents '.repeat(6)}${index}`,
      missedAt: now.toISOString(),
      href,
    }))
    const sms = digestSms('Joseph Cordeira', items)
    expect(sms.length).toBeLessThanOrEqual(640)
    expect(sms).toContain(href)
    expect(sms).not.toMatch(/https:\/\/teamcordeira\.followupboss\.com\/2\/people\/view\/10[^0\s]/)
    expect(clipSms(`${href}\n${'x'.repeat(700)}`)).toBe(`${href}...`)
  })
})

describe('runLoaReminders', () => {
  function harness(extra?: { dryRun?: boolean; enabled?: boolean }) {
    if (extra?.enabled === false) process.env.LOA_REMINDERS_ENABLED = 'false'
    const notes: NotePayload[] = []
    const texts: { to: string; content: string }[] = []
    const fetchMock = vi.fn(() => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const run = (override?: ReminderSource) =>
      runLoaReminders({
        now,
        trigger: 'test',
        dryRun: extra?.dryRun,
        source: override ?? source(),
        postNote: async (input) => {
          notes.push(input)
        },
        sendText: async (input) => {
          texts.push(input)
          return { id: 'sms-test' }
        },
      })
    return { notes, texts, fetchMock, run }
  }

  it('reminds a third teammate with a mention note and one SMS', async () => {
    process.env.FUB_LOA_USER_IDS = '16,27,32'
    process.env.FUB_LOA_NAME_32 = 'Debra Rose'
    process.env.FUB_LOA_PHONE_32 = '+12013946798'
    expect(reminderSeats().map((seat) => seat.userId)).toEqual([1, 16, 27, 32])
    const extra = source()
    extra.people.push({ id: 400, name: 'Pat Buyer', assignedUserId: 32 })
    extra.tasks.push({ id: 8, name: 'Order appraisal', isCompleted: 0, dueDate: '2026-10-01', personId: 400, assignedUserId: 32 })
    const { notes, texts, run } = harness()
    await run(extra)
    const note = notes.find((item) => item.mentionUserIds[0] === 32 && item.personId === 400)
    expect(note?.isHtml).toBe(true)
    expect(note?.body).toContain('<span data-user-id="32">Debra Rose</span>')
    expect(note?.body).toContain('Overdue task: Order appraisal')
    const sms = texts.find((text) => text.to === '+12013946798')
    expect(sms?.content).toContain('Pat Buyer')
    expect(texts.filter((text) => text.to === '+12013946798')).toHaveLength(1)
  })

  it('posts one mention note per lead and one SMS digest per person', async () => {
    const { notes, texts, fetchMock, run } = harness()
    const result = await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.deliveries.filter((delivery) => delivery.channel === 'sms')).toHaveLength(3)

    const frankieNote = notes.find((note) => note.mentionUserIds[0] === 16 && note.personId === 100)
    expect(frankieNote?.isHtml).toBe(true)
    expect(frankieNote?.subject).toBe('LoanPilot reminder')
    expect(frankieNote?.body).toContain('<span data-user-id="16">Frankie Cordeira</span>')
    expect(frankieNote?.body).toContain('Overdue task: Follow up')
    expect(frankieNote?.body).toContain('Unanswered inbound text')
    expect(frankieNote?.body).toContain('Missed inbound call')
    expect(frankieNote?.body).not.toContain('Ancient')
    expect(notes.some((note) => note.mentionUserIds.includes(1))).toBe(false)
    expect(notes.some((note) => note.personId === 200 && note.mentionUserIds[0] === 27)).toBe(true)

    const frankieSms = texts.find((text) => text.to === frankie)
    const josephSms = texts.find((text) => text.to === joseph)
    expect(frankieSms?.content).toContain('Alex Buyer')
    expect(frankieSms?.content).toContain('https://teamcordeira.followupboss.com/2/people/view/100')
    expect(frankieSms?.content).not.toContain('Send checklist')
    expect(josephSms?.content).toContain('Send checklist')
    expect(josephSms?.content).toContain('Casey Hot')
    expect(josephSms?.content).toContain('Missed inbound call')
    expect(josephSms?.content).not.toContain('Alex Buyer')
    expect(texts.some((text) => text.to === daniel)).toBe(true)
    expect(texts.filter((text) => text.to === frankie)).toHaveLength(1)
  })

  it('does not remind about the same item twice', async () => {
    const { texts, run } = harness()
    await run()
    texts.length = 0
    const again = await run()
    expect(again.deliveries.filter((delivery) => delivery.status === 'sent')).toHaveLength(0)
    expect(texts).toHaveLength(0)
  })

  it('does not send on a dry run, then sends once the dry run is off', async () => {
    const { notes, texts, run } = harness({ dryRun: true })
    const preview = await run()
    expect(preview.dryRun).toBe(true)
    expect(notes).toHaveLength(0)
    expect(texts).toHaveLength(0)
    expect(preview.deliveries.some((delivery) => delivery.smsBody?.includes('Alex Buyer'))).toBe(true)
    delete process.env.LOA_REMINDERS_DRY_RUN
    const live = await runLoaReminders({
      now,
      trigger: 'test',
      source: source(),
      postNote: async (input) => {
        notes.push(input)
      },
      sendText: async (input) => {
        texts.push(input)
        return { id: 'sms-test' }
      },
    })
    expect(live.dryRun).toBe(false)
    expect(notes.length).toBeGreaterThan(0)
    expect(texts.length).toBeGreaterThan(0)
  })

  it('stays quiet when the feature flag is off', async () => {
    const { notes, texts, run } = harness({ enabled: false })
    const result = await run()
    expect(result.skipped).toBe('disabled')
    expect(notes).toHaveLength(0)
    expect(texts).toHaveLength(0)
  })

  it('does not revive the backlog when lookback is later increased', async () => {
    const ancient: ReminderSource = {
      people: [{ id: 100, name: 'Alex Buyer', assignedUserId: 16 }],
      tasks: [{ id: 2, name: 'Ancient follow up', isCompleted: 0, dueDate: '2026-09-01', personId: 100, assignedUserId: 16 }],
      texts: [],
      calls: [],
      googleTasks: [],
    }
    const { notes, run } = harness()
    await run(ancient)
    expect(notes).toHaveLength(0)
    process.env.LOA_REMINDER_LOOKBACK_HOURS = '10000'
    await run(ancient)
    expect(notes).toHaveLength(0)
  })

  it('caps mention notes and finishes the rest on the next run', async () => {
    process.env.LOA_REMINDER_MAX_NOTES = '1'
    const { notes, run } = harness()
    const first = await run()
    const frankieNotes = notes.filter((note) => note.mentionUserIds[0] === 16)
    expect(frankieNotes).toHaveLength(1)
    expect(first.deferred).toBeGreaterThan(0)
    notes.length = 0
    await run()
    expect(notes.filter((note) => note.mentionUserIds[0] === 16)).toHaveLength(1)
  })

  it('skips SMS when Quo is not configured and still posts the LOA note', async () => {
    const notes: NotePayload[] = []
    const fetchMock = vi.fn(() => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await runLoaReminders({
      now,
      trigger: 'test',
      source: {
        people: [{ id: 100, name: 'Alex Buyer', assignedUserId: 16 }],
        tasks: [{ id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 }],
        texts: [],
        calls: [],
        googleTasks: [],
      },
      postNote: async (input) => {
        notes.push(input)
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(notes).toHaveLength(1)
    expect(result.deliveries.some((delivery) => delivery.channel === 'sms' && delivery.status === 'skipped')).toBe(true)
  })

  it('holds a 402 backlog and sends one digest per person when Quo resumes', async () => {
    const notes: NotePayload[] = []
    const texts: { to: string; content: string }[] = []
    let calls = 0
    const sendText = async (input: { to: string; content: string }) => {
      calls += 1
      texts.push(input)
      if (calls === 1) throw new QuoSmsError(402, 'payment required')
      return { id: 'sms-later' }
    }
    const base = {
      people: [{ id: 100, name: 'Alex Buyer', assignedUserId: 16 }],
      texts: [],
      calls: [],
      googleTasks: [],
    }
    const first = await runLoaReminders({
      now,
      trigger: 'test',
      source: {
        ...base,
        tasks: [{ id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 }],
      },
      postNote: async (input) => {
        notes.push(input)
      },
      sendText,
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.body).toContain('Overdue task: Follow up')
    expect(first.deliveries.some((delivery) => delivery.channel === 'sms' && delivery.status === 'skipped')).toBe(true)
    expect(calls).toBe(1)

    const during = new Date(now.getTime() + 15 * 60 * 1000)
    await runLoaReminders({
      now: during,
      trigger: 'test',
      source: {
        ...base,
        tasks: [
          { id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
          { id: 2, name: 'Order appraisal', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
        ],
      },
      postNote: async (input) => {
        notes.push(input)
      },
      sendText,
    })
    expect(calls).toBe(1)
    expect(notes).toHaveLength(2)
    expect(notes[1]?.body).toContain('Overdue task: Order appraisal')

    const resumed = new Date(now.getTime() + 31 * 60 * 1000)
    await runLoaReminders({
      now: resumed,
      trigger: 'test',
      source: {
        ...base,
        tasks: [
          { id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
          { id: 2, name: 'Order appraisal', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
        ],
      },
      postNote: async (input) => {
        notes.push(input)
      },
      sendText,
    })
    expect(calls).toBe(2)
    expect(notes).toHaveLength(2)
    const digest = texts[1]?.content ?? ''
    expect(digest).toContain('2 items need you')
    expect(digest).toContain('Alex Buyer - Overdue task: Follow up')
    expect(digest).toContain('Alex Buyer - Overdue task: Order appraisal')
    expect(digest).not.toContain('—')
  })

  it('does not call Quo from the demo SMS helper', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    process.env.QUO_API_KEY = 'test-key'
    process.env.QUO_FROM_NUMBER = '+15555550199'
    const result = await sendSmsIfConfigured({ to: frankie, content: 'hello' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ id: expect.stringMatching(/^sms-demo-/) }))
  })
})

describe('calls webhook', () => {
  it('accepts callsCreated without rescoring or calling the network', async () => {
    process.env.LOA_REMINDERS_ENABLED = 'false'
    const fetchMock = vi.fn(() => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'callsCreated',
          resourceIds: [70],
          uri: 'https://api.followupboss.com/v1/calls?id=70',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reminders?: { skipped?: string }; leads?: unknown }
    expect(body.reminders?.skipped).toBe('disabled')
    expect(body.leads).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
