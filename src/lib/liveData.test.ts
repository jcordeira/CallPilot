import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { createCalendarEvent, listGoogleTasks, listUpcomingEvents } from '../../netlify/functions/_shared/calendar'
import { createDraftReply, listUnreadLeadCandidates } from '../../netlify/functions/_shared/gmail'
import { getHubSummary } from '../../netlify/functions/_shared/hub'
import { loadHubExtras, loadScoredLeads, rememberHubEvent, rememberScoredLead, resetHubExtrasForTests } from '../../netlify/functions/_shared/hubExtras'
import { fetchNeoUnread, sendNeoReply } from '../../netlify/functions/_shared/neo'
import { purgeStoredDemoData, resetStoredDemoPurgeForTests } from '../../netlify/functions/_shared/purgeDemo'
import { createTask, listOpenFubTasks } from '../../netlify/functions/_shared/followupboss'
import { fubSignature } from '../../netlify/functions/_shared/fubSignature'
import { appendActivity, listActivity, resetActivityForTests } from '../../netlify/functions/_shared/store'
import { sweepInboxes } from '../../netlify/functions/_shared/sweep'
import fubWebhook from '../../netlify/functions/fub-webhook'
import googleOauth from '../../netlify/functions/google-oauth'
import { hubSessionCookie, signHubSession } from '../../netlify/functions/_shared/hubSession'
import publicApi from '../../netlify/functions/public-api'

const context = { requestId: 'test', params: {} } as Context

function liveEnv() {
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
  process.env.FOLLOW_UP_BOSS_SYSTEM = 'LoanPilot'
  process.env.FOLLOW_UP_BOSS_SYSTEM_KEY = 'system-key'
  delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
  delete process.env.GOOGLE_TASKS_ACCESS_TOKEN
  delete process.env.GMAIL_ACCESS_TOKEN
  delete process.env.NEO_IMAP_HOST
  delete process.env.NEO_IMAP_USER
  delete process.env.NEO_IMAP_PASSWORD
  delete process.env.NEO_ENABLED
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetStoredDemoPurgeForTests()
  process.env.ASSISTANT_DEMO_MODE = 'true'
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.FOLLOW_UP_BOSS_SYSTEM_KEY
  delete process.env.FUB_LO_USER_ID
  delete process.env.FUB_LOA_USER_ID
  delete process.env.FOLLOW_UP_BOSS_USER_ID
  delete process.env.FUB_WEBHOOK_VERIFY
  delete process.env.FUB_WEBHOOK_SECRET
  delete process.env.LOANPILOT_API_KEY
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  delete process.env.NEO_ENABLED
})

describe('live mode does not invent Google, Gmail, or Neo data', () => {
  it('returns empty calendar and tasks and refuses fake holds', async () => {
    liveEnv()
    await expect(createCalendarEvent({
      summary: 'Call: Should Not Save',
      startIso: new Date().toISOString(),
      endIso: new Date(Date.now() + 30 * 60_000).toISOString(),
    })).rejects.toThrow(/not connected/i)
    await expect(listUpcomingEvents(7)).resolves.toEqual({ events: [], demo: false })
    await expect(listGoogleTasks()).resolves.toEqual({ tasks: [], demo: false })
  })

  it('does not sweep sample inbox messages', async () => {
    liveEnv()
    await expect(listUnreadLeadCandidates()).resolves.toEqual([])
    await expect(createDraftReply({ to: 'a@b.com', subject: 'Hi', body: 'x', threadId: 't' })).rejects.toThrow(/not connected/i)
    await expect(fetchNeoUnread()).resolves.toEqual([])
    await expect(sendNeoReply({ to: 'a@b.com', subject: 'Hi', body: 'x' })).rejects.toThrow(/not configured/i)
    await expect(sweepInboxes()).resolves.toEqual([])
  })

  it('skips Neo sample mail when NEO_ENABLED is false, including in demo mode', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    process.env.NEO_ENABLED = 'false'
    await expect(fetchNeoUnread()).resolves.toEqual([])
    delete process.env.NEO_ENABLED
    expect((await fetchNeoUnread()).map((message) => message.id)).toEqual(['neo-demo-1'])
  })

  it('reports demo from assistant mode, not from a missing Google token', async () => {
    liveEnv()
    process.env.FUB_LO_USER_ID = '1'
    process.env.FUB_LOA_USER_ID = '16'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tasks: [], people: [] }), { status: 200 })),
    )
    const summary = await getHubSummary()
    expect(summary.stats.demo).toBe(false)
    expect(summary.events).toEqual([])
    expect(summary.tasks).toEqual([])
  })
})

describe('stored sample rows', () => {
  it('purges demo artifacts once, then keeps a real person who reuses a legacy id', async () => {
    resetStoredDemoPurgeForTests()
    resetHubExtrasForTests()
    resetActivityForTests()
    process.env.ASSISTANT_DEMO_MODE = 'true'
    delete process.env.FOLLOW_UP_BOSS_API_KEY
    const start = new Date(Date.now() + 3_600_000).toISOString()
    await rememberHubEvent({
      id: 'cal-demo-held',
      summary: 'Call: Alex Buyer',
      startIso: start,
      endIso: new Date(Date.now() + 5_400_000).toISOString(),
      allDay: false,
      source: 'demo',
    })
    await rememberScoredLead({
      personId: 1001,
      name: 'Alex Buyer',
      score: 92,
      band: 'hot',
      reasons: [],
      scoredAt: new Date().toISOString(),
    })
    await rememberScoredLead({
      personId: -1002,
      name: 'Jordan Hale',
      score: 72,
      band: 'warm',
      reasons: [],
      scoredAt: new Date().toISOString(),
    })
    await appendActivity({
      id: 'seed-9',
      at: new Date().toISOString(),
      channel: 'gmail',
      from: 'alex.buyer@gmail.com',
      senderKind: 'lead',
      decision: 'replied',
      summary: 'sample',
    })
    await appendActivity({
      id: 'act-real-1',
      at: new Date().toISOString(),
      channel: 'gmail',
      from: 'real@example.com',
      senderKind: 'lead',
      decision: 'replied',
      summary: 'real',
    })

    liveEnv()
    await purgeStoredDemoData()
    const extras = await loadHubExtras()
    expect(extras.events.map((event) => event.id)).not.toContain('cal-demo-held')
    expect(extras.scoredLeads.map((lead) => lead.personId)).not.toContain(1001)
    expect(extras.scoredLeads.map((lead) => lead.personId)).not.toContain(-1002)
    const activity = await listActivity(20)
    expect(activity.map((item) => item.id)).toContain('act-real-1')
    expect(activity.map((item) => item.id)).not.toContain('seed-9')

    await rememberScoredLead({
      personId: 1001,
      name: 'Real Buyer',
      score: 70,
      band: 'warm',
      reasons: [],
      scoredAt: new Date().toISOString(),
    })
    const again = await loadScoredLeads()
    expect(again.some((lead) => lead.personId === 1001 && lead.name === 'Real Buyer')).toBe(true)
  })
})

describe('Follow Up Boss open tasks', () => {
  it('loads incomplete tasks for the LO and LOA and fills person names from AssignedTo', async () => {
    liveEnv()
    process.env.FUB_LO_USER_ID = '1'
    process.env.FUB_LOA_USER_ID = '16'
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('/tasks?')) {
          const params = new URL(url).searchParams
          const personId = params.get('personId')
          if (personId) {
            const open = [
              { id: 10, name: 'Call Casey', isCompleted: 0, personId: 55 },
              { id: 11, name: 'Text Riley', isCompleted: 0, personId: 56 },
            ]
            return new Response(JSON.stringify({ tasks: open.filter((task) => String(task.personId) === personId) }), { status: 200 })
          }
          const assigned = params.get('assignedUserId')
          return new Response(
            JSON.stringify({
              tasks: [
                {
                  id: assigned === '1' ? 10 : 11,
                  name: assigned === '1' ? 'Call Casey' : 'Text Riley',
                  isCompleted: 0,
                  dueDate: assigned === '1' ? '2026-10-04' : '2026-10-03',
                  personId: assigned === '1' ? 55 : 56,
                  AssignedTo: assigned === '1' ? 'Joseph Cordeira' : 'Frank Cordeira',
                  assignedUserId: Number(assigned),
                },
                {
                  id: 99,
                  name: 'Done already',
                  isCompleted: 1,
                  dueDate: '2026-10-01',
                  personId: 55,
                  AssignedTo: 'Joseph Cordeira',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.includes('/people?')) {
          return new Response(
            JSON.stringify({
              people: [
                { id: 55, name: 'Casey Hot' },
                { id: 56, name: 'Riley Warm' },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ id: 77 }), { status: 200 })
      }),
    )

    const tasks = await listOpenFubTasks()
    expect(tasks.map((task) => [task.title, task.personName, task.assignedTo, task.due])).toEqual([
      ['Text Riley', 'Riley Warm', 'Frank Cordeira', '2026-10-03'],
      ['Call Casey', 'Casey Hot', 'Joseph Cordeira', '2026-10-04'],
    ])
    const taskUrls = urls.filter((url) => url.includes('/tasks?'))
    expect(taskUrls.some((url) => url.includes('assignedUserId=1'))).toBe(true)
    expect(taskUrls.some((url) => url.includes('assignedUserId=16'))).toBe(true)
    expect(taskUrls.every((url) => url.includes('isCompleted=0'))).toBe(true)
    expect(taskUrls.every((url) => url.includes('sort=dueDate'))).toBe(true)

    const created = await createTask({
      personId: 55,
      name: 'Text Riley',
      assignedUserId: 16,
      assignedTo: 'Frank Cordeira',
    })
    expect(created.id).toBe(77)
    const init = (vi.mocked(fetch).mock.calls as [RequestInfo, RequestInit?][]).find((call) =>
      String(call[0]).endsWith('/tasks'),
    )
    const body = JSON.parse(String(init?.[1]?.body)) as { assignedUserId?: number; assignedTo?: string }
    expect(body.assignedUserId).toBe(16)
    expect(body.assignedTo).toBeUndefined()
  })
})

describe('FUB webhook signature', () => {
  it('accepts current deliveries when verification is off', async () => {
    delete process.env.FUB_WEBHOOK_VERIFY
    delete process.env.FUB_WEBHOOK_SECRET
    const res = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        body: JSON.stringify({ event: 'tasksCreated', resourceIds: [1] }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('verifies FUB-Signature with the system key when enabled', async () => {
    process.env.FUB_WEBHOOK_VERIFY = 'true'
    process.env.FOLLOW_UP_BOSS_SYSTEM_KEY = 'system-key'
    const raw = JSON.stringify({ event: 'tasksCreated', resourceIds: [4] })
    const bad = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'FUB-Signature': 'not-the-signature' },
        body: raw,
      }),
    )
    expect(bad.status).toBe(401)

    const good = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'FUB-Signature': fubSignature(raw, 'system-key') },
        body: raw,
      }),
    )
    expect(good.status).toBe(200)
  })

  it('treats FUB_WEBHOOK_SECRET as an enable switch, not the compared header', async () => {
    delete process.env.FUB_WEBHOOK_VERIFY
    process.env.FUB_WEBHOOK_SECRET = 'legacy-secret'
    process.env.FOLLOW_UP_BOSS_SYSTEM_KEY = 'system-key'
    const raw = JSON.stringify({ event: 'tasksCreated', resourceIds: [8] })
    const legacy = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'FUB-Signature': 'legacy-secret' },
        body: raw,
      }),
    )
    expect(legacy.status).toBe(401)
    const signed = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'FUB-Signature': fubSignature(raw, 'system-key') },
        body: raw,
      }),
    )
    expect(signed.status).toBe(200)
  })
})

function hubCookie(): string {
  process.env.HUB_PASSWORD = 'hub-test-password'
  return hubSessionCookie(signHubSession(), false).split(';')[0] ?? ''
}

describe('Google OAuth', () => {
  it('binds the callback to the state cookie and rejects a missing or stale state', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client'
    process.env.GOOGLE_CLIENT_SECRET = 'secret'
    const connect = await googleOauth(new Request('https://site.example/api/google/connect', { headers: { cookie: hubCookie() } }), context)
    expect(connect.status).toBe(302)
    const state = new URL(connect.headers.get('location') ?? '').searchParams.get('state')
    expect(state).toBeTruthy()
    expect(connect.headers.get('set-cookie')).toContain(`lp_google_oauth=${state}`)

    const mismatch = await googleOauth(
      new Request(`https://site.example/api/google/callback?code=abc&state=${state}`, {
        headers: { cookie: 'lp_google_oauth=other.1' },
      }),
      context,
    )
    expect(mismatch.headers.get('location')).toContain('reason=state')

    const stale = `${crypto.randomUUID()}.${Date.now() - 11 * 60_000}`
    const expired = await googleOauth(
      new Request(`https://site.example/api/google/callback?code=abc&state=${stale}`, {
        headers: { cookie: `lp_google_oauth=${stale}` },
      }),
      context,
    )
    expect(expired.headers.get('location')).toContain('reason=state')
  })

  it('rejects a cross-site disconnect and allows same-origin or an API key', async () => {
    liveEnv()
    process.env.LOANPILOT_API_KEY = 'secret-key'
    const denied = await googleOauth(
      new Request('https://site.example/api/google/disconnect', {
        method: 'POST',
        headers: { Origin: 'https://evil.example', cookie: hubCookie() },
      }),
      context,
    )
    expect(denied.status).toBe(401)

    const sameOrigin = await googleOauth(
      new Request('https://site.example/api/google/disconnect', {
        method: 'POST',
        headers: { Origin: 'https://site.example', 'Sec-Fetch-Site': 'same-origin', cookie: hubCookie() },
      }),
      context,
    )
    expect(sameOrigin.status).toBe(200)

    const withKey = await googleOauth(
      new Request('https://site.example/api/google/disconnect', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-key', Origin: 'https://evil.example' },
      }),
      context,
    )
    expect(withKey.status).toBe(200)
  })
})

describe('public tasks in live mode', () => {
  it('does not list sample tasks', async () => {
    liveEnv()
    process.env.LOANPILOT_API_KEY = 'secret-key'
    process.env.FUB_LO_USER_ID = '1'
    process.env.FUB_LOA_USER_ID = '16'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), { status: 200 })),
    )
    const res = await publicApi(
      new Request('http://localhost/api/v1/tasks', { headers: { Authorization: 'Bearer secret-key' } }),
      context,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { demo: boolean; tasks: { title: string }[] } }
    expect(body.data.demo).toBe(false)
    expect(body.data.tasks).toEqual([])
  })
})
