import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import {
  handleFubCordeiraWebhook,
  ingestFubCall,
  ingestFubText,
  runCordeiraLineAlerts,
  type CordeiraDeps,
} from '../../netlify/functions/_shared/cordeiraLine'
import { resetCordeiraStateForTests } from '../../netlify/functions/_shared/cordeiraLineStore'
import { isGsm7 } from '../../netlify/functions/_shared/quo'

const line = '+15163094960'
const sales = '+15163869773'
const client = '+15165550100'
const otherClient = '+15165550101'
const joseph = '+15169969070'
const frankie = '+16315126480'
const t0 = new Date('2026-10-05T15:00:00.000Z')

function plus(minutes: number): Date {
  return new Date(t0.getTime() + minutes * 60 * 1000)
}

function envOn() {
  process.env.CORDEIRA_LINE_ALERTS_ENABLED = 'true'
  process.env.CORDEIRA_LINE_NUMBER = line
  process.env.CORDEIRA_LINE_TEXT_WAIT_MINUTES = '10'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  process.env.FUB_LO_NAME = 'Joseph Cordeira'
  process.env.FUB_LO_PHONE = joseph
  process.env.FUB_LO_USER_ID = '1'
  process.env.FUB_LOA_NAME = 'Frank Cordeira'
  process.env.FUB_LOA_NAME_16 = 'Frankie Cordeira'
  process.env.FUB_LOA_USER_ID = '16'
  process.env.FUB_LOA_PHONE_16 = frankie
  delete process.env.CORDEIRA_LINE_ALERTS_DRY_RUN
  delete process.env.CORDEIRA_LINE_PHONE_ID
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.LOA_REMINDERS_ENABLED
}

type Sms = { to: string; content: string }
type Note = { personId: number; subject: string; body: string; isHtml?: boolean; mentionUserIds?: number[] }

function deps(partial: Partial<CordeiraDeps> = {}): CordeiraDeps & { sms: Sms[]; notes: Note[] } {
  const sms: Sms[] = []
  const notes: Note[] = []
  return {
    sms,
    notes,
    sendSms: async (input) => {
      sms.push(input)
      return { id: `sms-${sms.length}` }
    },
    findPerson: async () => null,
    addNote: async (input) => {
      notes.push(input)
    },
    laterActivity: async () => 'clear',
    ...partial,
  }
}

function text(input: {
  id: number
  at: Date
  incoming: boolean
  contact: string
  on?: string
  personId?: number
  name?: string
  isIncoming?: boolean | number
}) {
  const on = input.on ?? line
  return {
    id: input.id,
    created: input.at.toISOString(),
    personId: input.personId ?? 0,
    name: input.name,
    userName: 'Agent White',
    isIncoming: input.isIncoming ?? input.incoming,
    fromNumber: input.incoming ? input.contact : on,
    toNumber: input.incoming ? on : input.contact,
    message: input.incoming ? 'hello' : 'on it',
    sharedInboxId: 0,
  }
}

function call(input: {
  id: number
  at: Date
  incoming?: boolean
  contact?: string
  on?: string
  personId?: number
  outcome?: string | null
  duration?: number | null
  fromNumber?: string
  toNumber?: string
  phone?: string
  sharedInboxId?: number
}) {
  const incoming = input.incoming !== false
  const on = input.on
  const contact = input.contact
  return {
    id: input.id,
    created: input.at.toISOString(),
    phone: input.phone ?? contact,
    personId: input.personId ?? 0,
    userId: 4,
    userName: 'Agent White',
    isIncoming: incoming ? 1 : 0,
    outcome: input.outcome,
    duration: input.duration,
    fromNumber: input.fromNumber ?? (on ? (incoming ? contact : on) : undefined),
    toNumber: input.toNumber ?? (on ? (incoming ? on : contact) : undefined),
    sharedInboxId: input.sharedInboxId,
  }
}

beforeEach(() => {
  resetCordeiraStateForTests()
  envOn()
})

afterEach(() => {
  resetCordeiraStateForTests()
  delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
  delete process.env.CORDEIRA_LINE_NUMBER
  delete process.env.CORDEIRA_LINE_TEXT_WAIT_MINUTES
  delete process.env.CORDEIRA_LINE_ALERTS_DRY_RUN
  delete process.env.CORDEIRA_LINE_PHONE_ID
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.LOA_REMINDERS_ENABLED
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  process.env.ASSISTANT_DEMO_MODE = 'true'
  vi.unstubAllGlobals()
})

describe('Cordeira line alerts', () => {
  it('alerts once for a missed FUB call, including callsUpdated for the same id', async () => {
    const fx = deps({
      findPerson: async () => ({ id: 99, name: 'Ada Buyer' }),
    })
    const missed = call({
      id: 18,
      at: t0,
      contact: '5165550100',
      on: '5163094960',
      personId: 99,
      outcome: 'No Answer',
      duration: 0,
    })
    const first = await ingestFubCall(missed, { ...fx, now: t0 })
    const again = await ingestFubCall(
      { ...missed, outcome: 'Left Message', duration: 12 },
      { ...fx, now: plus(1) },
    )
    expect(first.sent).toBe(2)
    expect(again.sent).toBe(0)
    expect(fx.sms.map((item) => item.to)).toEqual([joseph, frankie])
    expect(fx.sms[0]?.content).toBe(
      'Missed call Ada Buyer thriving-faloodeh-857600.netlify.app/p/99',
    )
    expect(fx.sms[0]?.content).not.toContain('Agent White')
    expect(fx.sms[1]?.content).toBe(fx.sms[0]?.content)
    expect(fx.notes).toHaveLength(1)
    expect(fx.notes[0]).toMatchObject({
      personId: 99,
      subject: 'LoanPilot — Cordeira line',
      isHtml: true,
      mentionUserIds: [1, 16],
    })
    expect(fx.notes[0]?.body).toContain('data-user-id="1"')
    expect(fx.notes[0]?.body).toContain('Joseph Cordeira')
    expect(fx.notes[0]?.body).toContain('data-user-id="16"')
    expect(fx.notes[0]?.body).toContain('Frankie Cordeira')
    expect(fx.notes[0]?.body).toContain('Missed call Ada Buyer')
    expect(fx.notes[0]?.body).toContain('https://teamcordeira.followupboss.com/2/people/view/99')
  })

  it('does not alert when a team text replies within 10 minutes', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: t0,
    })
    await ingestFubText(
      text({ id: 15, at: plus(5), incoming: false, contact: client, on: sales, personId: 99, name: 'Ada Buyer' }),
      { ...fx, now: plus(5) },
    )
    const result = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(result.sent).toBe(0)
    expect(fx.sms).toEqual([])
    expect(fx.notes).toEqual([])
  })

  it('alerts once when an inbound FUB text is still unanswered after 10 minutes', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client }), { ...fx, now: t0 })
    const early = await runCordeiraLineAlerts({ ...fx, now: plus(9) })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    const repeat = await runCordeiraLineAlerts({ ...fx, now: plus(11) })
    expect(early.sent).toBe(0)
    expect(due.sent).toBe(2)
    expect(repeat.sent).toBe(0)
    expect(fx.sms).toHaveLength(2)
    expect(fx.sms[0]?.content).toBe(`Text unanswered ${client} 10m`)
    expect(fx.sms[1]?.to).toBe(frankie)
    expect(fx.notes).toEqual([])
  })

  it('uses the text name and posts one mention note when the person is known', async () => {
    const fx = deps({ findPerson: async () => ({ id: 1, name: 'Should Not Lookup' }) })
    await ingestFubText(
      text({ id: 14, at: t0, incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }),
      { ...fx, now: t0 },
    )
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(2)
    expect(due.notes).toBe(1)
    expect(fx.sms[0]?.content).toBe(
      'Text unanswered Ada Buyer 10m thriving-faloodeh-857600.netlify.app/p/99',
    )
    expect(fx.notes[0]?.personId).toBe(99)
    expect(fx.notes[0]?.body).not.toContain('Should Not Lookup')
  })

  it('sends one digest per person when several texts become due together', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client }), { ...fx, now: t0 })
    await ingestFubText(text({ id: 16, at: t0, incoming: true, contact: otherClient }), { ...fx, now: t0 })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(2)
    expect(fx.sms).toHaveLength(2)
    expect(fx.sms[0]?.content).toBe(
      [
        `Text unanswered ${client} 10m`,
        `Text unanswered ${otherClient} 10m`,
      ].join('\n'),
    )
    expect(fx.sms[1]?.content).toBe(fx.sms[0]?.content)
  })

  it('does not double-alert when two runs flush the same due text', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client }), { ...fx, now: t0 })
    const [left, right] = await Promise.all([
      runCordeiraLineAlerts({ ...fx, now: plus(10) }),
      runCordeiraLineAlerts({ ...fx, now: plus(10) }),
    ])
    expect(left.sent + right.sent).toBe(2)
    expect(fx.sms).toHaveLength(2)
    expect(new Set(fx.sms.map((item) => item.to))).toEqual(new Set([joseph, frankie]))
  })

  it('does not double-alert when two workers ingest the same missed call', async () => {
    const fx = deps({ findPerson: async () => ({ id: 99, name: 'Ada Buyer' }) })
    const missed = call({ id: 18, at: t0, contact: client, on: line, outcome: 'Busy', duration: 0, personId: 99 })
    await Promise.all([
      ingestFubCall(missed, { ...fx, now: t0 }),
      ingestFubCall(missed, { ...fx, now: t0 }),
    ])
    expect(fx.sms).toHaveLength(2)
    expect(fx.notes).toHaveLength(1)
  })

  it('ignores other FUB lines, open calls, and stays quiet until alerts are enabled', async () => {
    const fx = deps()
    await ingestFubCall(
      call({ id: 20, at: t0, contact: client, on: sales, outcome: 'No Answer', duration: 0 }),
      { ...fx, now: t0 },
    )
    await ingestFubCall(
      call({ id: 21, at: t0, contact: client, on: line, outcome: null, duration: null }),
      { ...fx, now: t0 },
    )
    await ingestFubCall(
      call({ id: 22, at: t0, contact: client, outcome: 'No Answer', duration: 0, fromNumber: undefined, toNumber: undefined }),
      { ...fx, now: t0 },
    )
    expect(fx.sms).toEqual([])
    delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
    const loaded = vi.fn(async () => call({ id: 23, at: t0, contact: client, on: line, outcome: 'No Answer', duration: 0 }))
    await handleFubCordeiraWebhook({ event: 'callsCreated', resourceIds: [23] }, { ...fx, now: t0, loadCall: loaded })
    expect(loaded).not.toHaveBeenCalled()
    expect(fx.sms).toEqual([])
  })

  it('cancels the timer when an answered call or a later FUB reply is already on the person', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: t0,
    })
    await ingestFubCall(
      call({
        id: 30,
        at: plus(4),
        contact: client,
        personId: 99,
        outcome: 'Interested',
        duration: 30,
        incoming: false,
      }),
      { ...fx, now: plus(4) },
    )
    const answered = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(answered.sent).toBe(0)

    await ingestFubText(text({ id: 40, at: t0, incoming: true, contact: otherClient }), { ...fx, now: t0 })
    const due = await runCordeiraLineAlerts({
      ...fx,
      now: plus(10),
      laterActivity: async () => 'reply',
    })
    expect(due.sent).toBe(0)
    expect(fx.sms).toEqual([])
  })

  it('matches the dialer line by shared inbox id when the text has no from or to number', async () => {
    process.env.CORDEIRA_LINE_PHONE_ID = '42'
    const fx = deps()
    const ignored = await ingestFubText(
      {
        id: 50,
        created: t0.toISOString(),
        personId: 0,
        isIncoming: true,
        fromNumber: client,
        sharedInboxId: 0,
      },
      { ...fx, now: t0 },
    )
    const matched = await ingestFubText(
      {
        id: 51,
        created: t0.toISOString(),
        personId: 0,
        isIncoming: true,
        fromNumber: client,
        sharedInboxId: 42,
      },
      { ...fx, now: t0 },
    )
    expect(ignored).toMatchObject({ ignored: true })
    expect(matched.sent).toBe(0)
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(2)
    expect(fx.sms[0]?.content).toContain(client)
  })

  it('loads the call from Follow Up Boss when callsCreated fires', async () => {
    const fx = deps({
      findPerson: async (phone) => (phone === client ? { id: 99, name: 'Ada Buyer' } : null),
    })
    const missed = call({ id: 18, at: t0, contact: client, on: line, personId: 99, outcome: 'No Answer', duration: 0 })
    const result = await handleFubCordeiraWebhook(
      { event: 'callsCreated', resourceIds: [18], uri: 'https://api.followupboss.com/v1/calls?id=18' },
      { ...fx, now: t0, loadCall: async (id) => ({ call: { ...missed, id } }) },
    )
    expect(result.sent).toBe(2)
    expect(fx.sms[0]?.content).toContain('Ada Buyer')

    const wrapped = await handleFubCordeiraWebhook(
      { event: 'textMessagesCreated', resourceIds: [14] },
      {
        ...fx,
        now: t0,
        loadText: async () => ({ textmessage: text({ id: 14, at: t0, incoming: true, contact: otherClient }) }),
      },
    )
    expect(wrapped.sent).toBe(0)
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(2)
    expect(fx.sms.some((item) => item.content.includes(otherClient))).toBe(true)
  })

  it('asks Follow Up Boss for the call on the live webhook and texts from the Sales line', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'test-key'
    process.env.LOA_REMINDERS_ENABLED = 'false'
    process.env.QUO_API_KEY = 'quo-test'
    process.env.QUO_FROM_NUMBER = sales
    const at = new Date()
    const missed = call({ id: 18181, at, contact: client, on: line, personId: 99, outcome: 'voicemail', duration: 8 })
    const quoBodies: { from?: string; to?: string[]; content?: string }[] = []
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        urls.push(url)
        if (url === 'https://api.followupboss.com/v1/calls/18181') {
          return new Response(JSON.stringify(missed), { status: 200 })
        }
        if (url.startsWith('https://api.followupboss.com/v1/people')) {
          return new Response(JSON.stringify({ people: [{ id: 99, name: 'Ada Buyer' }] }), { status: 200 })
        }
        if (url === 'https://api.followupboss.com/v1/notes') {
          return new Response(JSON.stringify({ id: 1 }), { status: 200 })
        }
        if (url === 'https://api.openphone.com/v1/messages') {
          quoBodies.push(JSON.parse(String(init?.body ?? '{}')) as { from?: string; to?: string[]; content?: string })
          return new Response(JSON.stringify({ data: { id: 'msg-1' } }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      }),
    )
    const res = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'callsCreated',
          resourceIds: [18181],
          uri: 'https://api.followupboss.com/v1/calls?id=18181',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reminders?: { skipped?: string }; leads?: unknown }
    expect(body.reminders?.skipped).toBe('disabled')
    expect(body.leads).toBeUndefined()
    expect(urls).toContain('https://api.followupboss.com/v1/calls/18181')
    expect(quoBodies.map((item) => item.to?.[0])).toEqual([joseph, frankie])
    expect(quoBodies[0]?.from).toBe(sales)
    expect(quoBodies[0]?.content).toContain('Missed call Ada Buyer')
  })

  it('alerts once per lead for an unanswered stretch, then again after 4 hours', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: t0,
    })
    await ingestFubText(text({ id: 15, at: plus(1), incoming: true, contact: otherClient, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: plus(1),
    })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    const soon = await runCordeiraLineAlerts({ ...fx, now: plus(11) })
    expect(due.sent).toBe(2)
    expect(soon.sent).toBe(0)
    expect(fx.sms).toHaveLength(2)
    expect(fx.sms[0]?.content).toBe(
      'Text unanswered Ada Buyer 10m thriving-faloodeh-857600.netlify.app/p/99',
    )
    expect(isGsm7(fx.sms[0]?.content ?? '')).toBe(true)
    expect(fx.notes).toHaveLength(1)
    const again = await runCordeiraLineAlerts({ ...fx, now: plus(10 + 4 * 60) })
    const quiet = await runCordeiraLineAlerts({ ...fx, now: plus(10 + 4 * 60 + 1) })
    expect(again.sent).toBe(2)
    expect(quiet.sent).toBe(0)
    expect(fx.sms).toHaveLength(4)
  })

  it('starts a new text stretch after a reply and does not re-alert a closed one', async () => {
    const fx = deps()
    await ingestFubText(text({ id: 14, at: t0, incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: t0,
    })
    await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    await ingestFubText(
      text({ id: 15, at: plus(20), incoming: false, contact: client, on: sales, personId: 99, name: 'Ada Buyer' }),
      { ...fx, now: plus(20) },
    )
    const closed = await runCordeiraLineAlerts({ ...fx, now: plus(10 + 4 * 60) })
    expect(closed.sent).toBe(0)
    await ingestFubText(text({ id: 16, at: plus(30), incoming: true, contact: client, personId: 99, name: 'Ada Buyer' }), {
      ...fx,
      now: plus(30),
    })
    const early = await runCordeiraLineAlerts({ ...fx, now: plus(39) })
    const opened = await runCordeiraLineAlerts({ ...fx, now: plus(40) })
    expect(early.sent).toBe(0)
    expect(opened.sent).toBe(2)
    expect(fx.sms).toHaveLength(4)
  })

  it('sends one missed-call alert per lead every 4 hours', async () => {
    const fx = deps({ findPerson: async () => ({ id: 99, name: 'Ada Buyer' }) })
    const first = await ingestFubCall(
      call({ id: 18, at: t0, contact: client, on: line, personId: 99, outcome: 'No Answer', duration: 0 }),
      { ...fx, now: t0 },
    )
    await ingestFubText(
      text({ id: 15, at: plus(10), incoming: false, contact: client, on: sales, personId: 99 }),
      { ...fx, now: plus(10) },
    )
    const second = await ingestFubCall(
      call({ id: 19, at: plus(30), contact: client, on: line, personId: 99, outcome: 'Busy', duration: 0 }),
      { ...fx, now: plus(30) },
    )
    const third = await ingestFubCall(
      call({ id: 20, at: plus(4 * 60), contact: client, on: line, personId: 99, outcome: 'No Answer', duration: 0 }),
      { ...fx, now: plus(4 * 60) },
    )
    expect(first.sent).toBe(2)
    expect(second.sent).toBe(0)
    expect(third.sent).toBe(2)
    expect(fx.sms).toHaveLength(4)
    expect(fx.notes).toHaveLength(2)
  })
})
