import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import { handleFubWebhook, isOpenLead, publishLeadScore } from '../../netlify/functions/_shared/leadHeat'
import { scoreLead } from '../../netlify/functions/_shared/leadScore'
import { resetHubExtrasForTests } from '../../netlify/functions/_shared/hubExtras'
import { loadPersonScore, resetScoreStoreForTests } from '../../netlify/functions/_shared/scoreStore'
import { runLoaReminders, type NotePayload } from '../../netlify/functions/_shared/loaReminders'
import { resetReminderStateForTests } from '../../netlify/functions/_shared/loaReminderStore'

const { getStoreMock } = vi.hoisted(() => ({
  getStoreMock: vi.fn((_input?: unknown): unknown => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  }),
}))

vi.mock('@netlify/blobs', () => ({
  getStore: (input: unknown) => getStoreMock(input),
}))

const now = new Date('2026-10-02T15:00:00.000Z')

function liveEnv() {
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'test-key'
  process.env.LEAD_HEAT_WRITES_ENABLED = 'true'
  process.env.FUB_LO_NAME = 'Joseph Cordeira'
  process.env.FUB_LO_USER_ID = '1'
  process.env.FUB_LOA_NAME = 'Frank Cordeira'
  process.env.FUB_LOA_USER_ID = '16'
}

function hotPerson(id = 4242) {
  return {
    event: 'peopleCreated',
    person: {
      id,
      name: 'Casey Hot',
      stage: 'Lead',
      text: 'Docs are ready and we are ready to buy. Pre-approval please.',
      lastInboundAt: now.toISOString(),
    },
  }
}

beforeEach(async () => {
  liveEnv()
  getStoreMock.mockReset()
  getStoreMock.mockImplementation(() => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  })
  resetHubExtrasForTests()
  resetScoreStoreForTests()
  await resetReminderStateForTests()
})

afterEach(async () => {
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.LEAD_HEAT_WRITES_ENABLED
  process.env.ASSISTANT_DEMO_MODE = 'true'
  resetHubExtrasForTests()
  resetScoreStoreForTests()
  await resetReminderStateForTests()
  vi.unstubAllGlobals()
})

describe('lead heat writes once', () => {
  it('posts one note and one task when the same webhook arrives three times at once', async () => {
    const notes: { subject?: string }[] = []
    const tasks: { name?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.includes('/notes')) {
        notes.push(JSON.parse(String(init?.body ?? '{}')) as { subject?: string })
        return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
      }
      if (method === 'POST' && url.includes('/tasks')) {
        tasks.push(JSON.parse(String(init?.body ?? '{}')) as { name?: string })
        return new Response(JSON.stringify({ id: 8000 + tasks.length }), { status: 200 })
      }
      if (method === 'GET' && url.includes('/tasks')) return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
      if (method === 'PUT') return new Response(JSON.stringify({}), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    }))

    const body = JSON.stringify(hotPerson())
    const results = await Promise.all([0, 1, 2].map(() => fubWebhook(new Request('https://site.example/api/webhooks/fub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }))))
    expect(results.every((res) => res.status === 200)).toBe(true)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.subject).toMatch(/^LoanPilot — lead heat /)
    expect(tasks).toHaveLength(1)

    notes.length = 0
    tasks.length = 0
    await fubWebhook(new Request('https://site.example/api/webhooks/fub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }))
    expect(notes).toHaveLength(0)
    expect(tasks).toHaveLength(0)
  })

  it('does not repeat notes or tasks for 45 leads on a second run', async () => {
    const notes: unknown[] = []
    const tasks: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.includes('/notes')) {
        notes.push(1)
        return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
      }
      if (method === 'POST' && url.includes('/tasks')) {
        tasks.push(1)
        return new Response(JSON.stringify({ id: 9000 + tasks.length }), { status: 200 })
      }
      if (method === 'GET' && url.includes('/tasks')) return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
      if (method === 'PUT') return new Response(JSON.stringify({}), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    }))

    const result = scoreLead({
      stage: 'Nurture',
      recentText: 'Still thinking about a refinance later this year.',
      lastInboundAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      lastContactAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      now,
    })
    const publish = (id: number) => publishLeadScore({
      personId: id,
      personName: `Lead ${String(id).padStart(2, '0')}`,
      result,
      stage: 'Nurture',
      now,
    })
    for (let id = 1; id <= 45; id += 1) await publish(id)
    expect(notes).toHaveLength(45)
    expect(tasks).toHaveLength(45)
    expect(await loadPersonScore(45)).toMatchObject({ personId: 45, band: 'cool' })

    for (let id = 1; id <= 45; id += 1) await publish(id)
    expect(notes).toHaveLength(45)
    expect(tasks).toHaveLength(45)
  })

  it('skips Follow Up Boss writes when LEAD_HEAT_WRITES_ENABLED is false and still stores the score', async () => {
    process.env.LEAD_HEAT_WRITES_ENABLED = 'false'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await handleFubWebhook(hotPerson(77), now)
    expect(saved.leads[0]).toMatchObject({ personId: 77, band: 'hot' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await loadPersonScore(77)).toMatchObject({ score: 92 })
  })

  it('ignores peopleUpdated and closed or LoanPilot people', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/people/11615')) {
        return new Response(JSON.stringify({ id: 11615, name: 'LoanPilot', stage: 'Lead' }), { status: 200 })
      }
      if (url.includes('/people/50')) {
        return new Response(JSON.stringify({ id: 50, name: 'Old Client', stage: 'Past Client' }), { status: 200 })
      }
      if (url.includes('/people/51')) {
        return new Response(JSON.stringify({ id: 51, name: 'Done Deal', stage: 'Closed' }), { status: 200 })
      }
      if (url.includes('/events')) return new Response(JSON.stringify({ events: [] }), { status: 200 })
      return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const updated = await fubWebhook(new Request('https://site.example/api/webhooks/fub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hotPerson()),
    }).clone())
    const updatedRes = await fubWebhook(new Request('https://site.example/api/webhooks/fub', {
      method: 'POST',
      body: JSON.stringify({ ...hotPerson(), event: 'peopleUpdated' }),
    }))
    const body = await updatedRes.json() as { skipped?: string }
    expect(body.skipped).toBe('people-updated')
    expect(updated.status).toBe(200)

    expect(isOpenLead({ id: 11615, name: 'LoanPilot', stage: 'Lead' })).toBe(false)
    expect(isOpenLead({ id: 9, name: 'LoanPilot', stage: 'Lead' })).toBe(false)
    expect(isOpenLead({ id: 50, name: 'Old Client', stage: 'Past Client' })).toBe(false)
    expect(isOpenLead({ id: 51, name: 'Done Deal', stage: 'Closed' })).toBe(false)
    expect(isOpenLead({ id: 52, name: 'Agent Friend', stage: 'Outside Partner' })).toBe(false)

    const skipped = await handleFubWebhook({ event: 'peopleCreated', resourceIds: [11615, 50, 51] }, now)
    expect(skipped.leads).toEqual([])
  })

  it('posts one note and one task when created and stage webhooks race and the lock read is null', async () => {
    const rows = new Map<string, { data: unknown; etag: string }>()
    let etag = 0
    getStoreMock.mockImplementation((input: unknown) => {
      const name = typeof input === 'string' ? input : (input as { name?: string } | null)?.name
      if (name !== 'loanpilot-scores') throw new Error('The environment has not been configured to use Netlify Blobs')
      return {
        async get(key: string, options?: { consistency?: string }) {
          if (key.startsWith('lock/') && options?.consistency !== 'strong') return null
          return rows.get(key)?.data ?? null
        },
        async getWithMetadata(key: string) {
          if (key.startsWith('lock/')) return null
          const row = rows.get(key)
          if (!row) return null
          return { data: row.data, etag: row.etag, metadata: {} }
        },
        async setJSON(key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
          const current = rows.get(key)
          if (options?.onlyIfNew && current) return { modified: true, etag: current.etag }
          if (options?.onlyIfMatch && (!current || current.etag !== options.onlyIfMatch)) {
            return { modified: true, etag: current?.etag ?? '' }
          }
          const next = `etag-${++etag}`
          rows.set(key, { data, etag: next })
          return { modified: true, etag: next }
        },
        async delete(key: string) {
          rows.delete(key)
        },
      }
    })

    const notes: { subject?: string; body?: string }[] = []
    const tasks: { name?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url.includes('/notes?')) return new Response(JSON.stringify({ notes: [] }), { status: 200 })
      if (method === 'POST' && url.includes('/notes')) {
        notes.push(JSON.parse(String(init?.body ?? '{}')) as { subject?: string; body?: string })
        return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
      }
      if (method === 'POST' && url.includes('/tasks')) {
        tasks.push(JSON.parse(String(init?.body ?? '{}')) as { name?: string })
        return new Response(JSON.stringify({ id: 8100 + tasks.length }), { status: 200 })
      }
      if (method === 'GET' && url.includes('/tasks')) return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
      if (method === 'PUT') return new Response(JSON.stringify({}), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    }))

    const person = {
      id: 8808,
      name: 'Casey Hot',
      stage: 'Lead',
      text: 'Docs are ready and we are ready to buy. Pre-approval please.',
      lastInboundAt: now.toISOString(),
    }
    await Promise.all([
      handleFubWebhook({ event: 'peopleCreated', person }, now),
      handleFubWebhook({ event: 'peopleStageUpdated', person }, now),
    ])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.subject).toMatch(/^LoanPilot — lead heat /)
    expect(tasks).toHaveLength(1)
    expect(getStoreMock).toHaveBeenCalledWith({ name: 'loanpilot-scores', consistency: 'strong' })
  })

  it('skips the note and the task when Blobs errors', async () => {
    const fail = async () => {
      throw new Error('blobs unavailable')
    }
    getStoreMock.mockImplementation((input: unknown) => {
      const name = typeof input === 'string' ? input : (input as { name?: string } | null)?.name
      if (name !== 'loanpilot-scores') throw new Error('The environment has not been configured to use Netlify Blobs')
      return { get: fail, getWithMetadata: fail, setJSON: fail, delete: fail }
    })
    const notes: unknown[] = []
    const tasks: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.includes('/notes')) {
        notes.push(1)
        return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      }
      if (method === 'POST' && url.includes('/tasks')) {
        tasks.push(1)
        return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify({ notes: [], tasks: [] }), { status: 200 })
    }))
    const saved = await handleFubWebhook(hotPerson(8809), now)
    expect(saved.leads).toEqual([])
    expect(notes).toHaveLength(0)
    expect(tasks).toHaveLength(0)
    expect(await loadPersonScore(8809)).toBeNull()
  })
})

describe('reminder claims', () => {
  it('posts one note and one SMS per LOA when the cron and call webhooks run together', async () => {
    process.env.LOA_REMINDERS_ENABLED = 'true'
    process.env.FUB_LOA_USER_IDS = '16,27,32'
    process.env.FUB_LOA_NAME_16 = 'Frankie Cordeira'
    process.env.FUB_LOA_PHONE_16 = '+15555550116'
    process.env.FUB_LOA_NAME_27 = 'Daniel Ebbecke'
    process.env.FUB_LOA_PHONE_27 = '+15555550127'
    process.env.FUB_LOA_NAME_32 = 'Debra Rose'
    process.env.FUB_LOA_PHONE_32 = '+12013946798'
    delete process.env.LOA_REMINDERS_DRY_RUN
    delete process.env.QUO_API_KEY
    const notes: NotePayload[] = []
    const texts: { to: string; content: string }[] = []
    const source = {
      people: [
        { id: 100, name: 'Alex Buyer', assignedUserId: 16 },
        { id: 200, name: 'Sam Rivera', assignedUserId: 27 },
        { id: 300, name: 'Pat Buyer', assignedUserId: 32 },
      ],
      tasks: [
        { id: 1, name: 'Follow up', isCompleted: 0, dueDate: '2026-10-01', personId: 100, assignedUserId: 16 },
        { id: 2, name: 'Check rates', isCompleted: 0, dueDate: '2026-10-01', personId: 200, assignedUserId: 27 },
        { id: 3, name: 'Order appraisal', isCompleted: 0, dueDate: '2026-10-01', personId: 300, assignedUserId: 32 },
      ],
      texts: [
        { id: 50, personId: 100, isIncoming: true, created: '2026-10-02T12:00:00.000Z', message: 'Are you there?' },
      ],
      calls: [
        { id: 70, personId: 100, isIncoming: true, outcome: 'No Answer', created: '2026-10-02T13:00:00.000Z', duration: 0 },
      ],
      googleTasks: [],
    }
    const postNote = async (input: NotePayload) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      notes.push(input)
    }
    const sendText = async (input: { to: string; content: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      texts.push(input)
      return { id: 'sms-test' }
    }
    await Promise.all([
      runLoaReminders({ now, trigger: 'schedule', source, postNote, sendText }),
      runLoaReminders({ now, trigger: 'callsCreated', source, postNote, sendText }),
      runLoaReminders({ now, trigger: 'callsUpdated', source, postNote, sendText }),
    ])
    const frankie = notes.filter((note) => note.mentionUserIds[0] === 16)
    expect(frankie).toHaveLength(1)
    expect(frankie[0]?.body).toContain('Overdue task: Follow up')
    expect(frankie[0]?.body).toContain('Unanswered inbound text')
    expect(frankie[0]?.body).toContain('Missed inbound call')
    expect(notes.filter((note) => note.mentionUserIds[0] === 27)).toHaveLength(1)
    expect(notes.filter((note) => note.mentionUserIds[0] === 32)).toHaveLength(1)
    expect(texts.filter((text) => text.to === '+15555550116')).toHaveLength(1)
    expect(texts.filter((text) => text.to === '+15555550127')).toHaveLength(1)
    expect(texts.filter((text) => text.to === '+12013946798')).toHaveLength(1)
    expect(texts.find((text) => text.to === '+15555550116')?.content).toContain('Alex Buyer')
    expect(texts.find((text) => text.to === '+15555550116')?.content).toContain('Unanswered inbound text')
    expect(texts.find((text) => text.to === '+15555550116')?.content).toContain('Missed inbound call')
  })
})
