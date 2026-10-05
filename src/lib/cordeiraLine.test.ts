import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/quo-webhook'
import { ingestCordeiraPayload, runCordeiraLineAlerts, type CordeiraDeps } from '../../netlify/functions/_shared/cordeiraLine'
import { resetCordeiraStateForTests } from '../../netlify/functions/_shared/cordeiraLineStore'

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
  delete process.env.CORDEIRA_LINE_PHONE_NUMBER_ID
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
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
    ...partial,
  }
}

function message(input: { id: string; at: Date; direction: 'in' | 'out'; contact: string; on?: string }) {
  const on = input.on ?? line
  const inbound = input.direction === 'in'
  return {
    type: inbound ? 'message.received' : 'message.delivered',
    data: {
      resource: {
        id: input.id,
        direction: inbound ? 'incoming' : 'outgoing',
        text: inbound ? 'hello' : 'on it',
        createdAt: input.at.toISOString(),
      },
      context: {
        conversationId: 'CN-1',
        senderIdentifier: inbound ? input.contact : on,
        recipientIdentifiers: [inbound ? on : input.contact],
      },
    },
  }
}

function missedCall(input: { id: string; at: Date; contact: string; on?: string; type?: string; status?: string }) {
  return {
    type: input.type ?? 'call.missed',
    data: {
      resource: {
        id: input.id,
        direction: 'incoming',
        status: input.status,
        createdAt: input.at.toISOString(),
      },
      context: {
        conversationId: 'CN-call',
        participants: {
          workspace: [input.on ?? line],
          external: [input.contact],
          resolution: 'available',
        },
      },
    },
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
  delete process.env.CORDEIRA_LINE_PHONE_NUMBER_ID
  vi.unstubAllGlobals()
})

describe('Cordeira line alerts', () => {
  it('alerts once for a missed call, including a second event for the same call', async () => {
    const fx = deps({
      findPerson: async () => ({ id: 99, name: 'Ada Buyer' }),
    })
    const first = await ingestCordeiraPayload(missedCall({ id: 'AC-1', at: t0, contact: client }), { ...fx, now: t0 })
    const again = await ingestCordeiraPayload(
      missedCall({ id: 'AC-1', at: t0, contact: client, type: 'call.completed', status: 'unanswered' }),
      { ...fx, now: plus(1) },
    )
    expect(first.sent).toBe(2)
    expect(again.sent).toBe(0)
    expect(fx.sms.map((item) => item.to)).toEqual([joseph, frankie])
    expect(fx.sms[0]?.content).toBe(
      'Missed call from Ada Buyer on Cordeira line https://teamcordeira.followupboss.com/2/people/view/99',
    )
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
    expect(fx.notes[0]?.body).toContain('Missed call from Ada Buyer on Cordeira line')
  })

  it('does not alert when the Cordeira line replies within 10 minutes', async () => {
    const fx = deps()
    await ingestCordeiraPayload(message({ id: 'msg-in', at: t0, direction: 'in', contact: client }), { ...fx, now: t0 })
    await ingestCordeiraPayload(message({ id: 'msg-out', at: plus(5), direction: 'out', contact: client }), { ...fx, now: plus(5) })
    const result = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(result.sent).toBe(0)
    expect(fx.sms).toEqual([])
    expect(fx.notes).toEqual([])
  })

  it('alerts once when an inbound text is still unanswered after 10 minutes', async () => {
    const fx = deps()
    await ingestCordeiraPayload(message({ id: 'msg-in', at: t0, direction: 'in', contact: client }), { ...fx, now: t0 })
    const early = await runCordeiraLineAlerts({ ...fx, now: plus(9) })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    const repeat = await runCordeiraLineAlerts({ ...fx, now: plus(11) })
    expect(early.sent).toBe(0)
    expect(due.sent).toBe(2)
    expect(repeat.sent).toBe(0)
    expect(fx.sms).toHaveLength(2)
    expect(fx.sms[0]?.content).toBe(`Unanswered text from ${client} for 10 min on Cordeira line`)
    expect(fx.sms[1]?.to).toBe(frankie)
    expect(fx.notes).toEqual([])
  })

  it('sends one digest per person when several texts become due together', async () => {
    const fx = deps()
    await ingestCordeiraPayload(message({ id: 'msg-a', at: t0, direction: 'in', contact: client }), { ...fx, now: t0 })
    await ingestCordeiraPayload(message({ id: 'msg-b', at: t0, direction: 'in', contact: otherClient }), { ...fx, now: t0 })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(2)
    expect(fx.sms).toHaveLength(2)
    expect(fx.sms[0]?.content).toBe(
      [
        `Unanswered text from ${client} for 10 min on Cordeira line`,
        `Unanswered text from ${otherClient} for 10 min on Cordeira line`,
      ].join('\n'),
    )
    expect(fx.sms[1]?.content).toBe(fx.sms[0]?.content)
  })

  it('does not double-alert when two runs flush the same due text', async () => {
    const fx = deps()
    await ingestCordeiraPayload(message({ id: 'msg-in', at: t0, direction: 'in', contact: client }), { ...fx, now: t0 })
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
    const payload = missedCall({ id: 'AC-race', at: t0, contact: client })
    await Promise.all([
      ingestCordeiraPayload(payload, { ...fx, now: t0 }),
      ingestCordeiraPayload(payload, { ...fx, now: t0 }),
    ])
    expect(fx.sms).toHaveLength(2)
    expect(fx.notes).toHaveLength(1)
  })

  it('ignores the Sales line and stays quiet until alerts are enabled', async () => {
    const fx = deps()
    await ingestCordeiraPayload(missedCall({ id: 'AC-sales', at: t0, contact: client, on: sales }), { ...fx, now: t0 })
    expect(fx.sms).toEqual([])
    delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
    await ingestCordeiraPayload(missedCall({ id: 'AC-off', at: t0, contact: client }), { ...fx, now: t0 })
    expect(fx.sms).toEqual([])
  })

  it('cancels the timer when message history shows a reply the webhook missed', async () => {
    const fx = deps({
      listMessages: async () => [{ id: 'late-out', at: plus(4).toISOString(), direction: 'out' }],
    })
    await ingestCordeiraPayload(message({ id: 'msg-in', at: t0, direction: 'in', contact: client }), { ...fx, now: t0 })
    const due = await runCordeiraLineAlerts({ ...fx, now: plus(10) })
    expect(due.sent).toBe(0)
    expect(fx.sms).toEqual([])
  })

  it('does not treat a client text on the Cordeira line as a Sales command', async () => {
    delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
    process.env.COMMAND_MODE_ENABLED = 'true'
    process.env.QUO_WEBHOOK_SECRET = `whsec_${Buffer.from('supersecretkey1').toString('base64')}`
    const raw = JSON.stringify(message({ id: 'msg-client', at: new Date(), direction: 'in', contact: joseph }))
    const webhookId = 'wh_cordeira'
    const webhookTimestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', Buffer.from('supersecretkey1'))
      .update(`${webhookId}.${webhookTimestamp}.${raw}`)
      .digest('base64')
    const res = await handler(
      new Request('http://localhost/api/webhooks/quo', {
        method: 'POST',
        body: raw,
        headers: {
          'webhook-id': webhookId,
          'webhook-timestamp': webhookTimestamp,
          'webhook-signature': `v1,${signature}`,
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { acted: boolean; ignored: string }
    expect(body.acted).toBe(false)
    expect(body.ignored).toBe('cordeira-line')
    delete process.env.COMMAND_MODE_ENABLED
    delete process.env.QUO_WEBHOOK_SECRET
  })
})
