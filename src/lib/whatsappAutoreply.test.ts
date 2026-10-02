import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import whatsappWebhook from '../../netlify/functions/whatsapp-webhook'
import { ingestKapsoWebhook, runWhatsappAutoreply, whatsappAlert } from '../../netlify/functions/_shared/whatsappAutoreply'
import { resetWhatsappStateForTests } from '../../netlify/functions/_shared/whatsappStore'

const secret = 'kapso-test-secret'
const contact = '15555550199'
const joseph = '+15555550101'
const started = new Date('2026-10-02T15:00:00.000Z')

function envOn() {
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  process.env.FUB_LO_PHONE = joseph
  process.env.KAPSO_WEBHOOK_SECRET = secret
  process.env.KAPSO_PHONE_NUMBER_ID = '123'
  process.env.WHATSAPP_AUTOREPLY_WAIT_MINUTES = '5'
  process.env.WHATSAPP_AUTOREPLY_COOLDOWN_HOURS = '4'
  process.env.WHATSAPP_AUTOREPLY_MAX_AGE_HOURS = '24'
  delete process.env.WHATSAPP_AUTOREPLY_DRY_RUN
  delete process.env.WHATSAPP_AUTOREPLY_TEXT
  delete process.env.KAPSO_API_KEY
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
}

function message(input: {
  id: string
  at: Date
  direction: 'inbound' | 'outbound'
  origin: string
  body: string
  type?: string
  groupId?: string
}) {
  const inbound = input.direction === 'inbound'
  return {
    message: {
      id: input.id,
      timestamp: String(Math.floor(input.at.getTime() / 1000)),
      type: input.type ?? 'text',
      from: inbound ? contact : undefined,
      to: inbound ? undefined : contact,
      text: { body: input.body },
      kapso: { direction: input.direction, origin: input.origin, content: input.body },
    },
    conversation: {
      id: 'conv_1',
      contact_name: 'Alex Buyer',
      phone_number: contact,
      phone_number_id: '123',
      ...(input.groupId ? { group_id: input.groupId } : {}),
    },
    phone_number_id: '123',
  }
}

async function inbound(at: Date, id = 'wamid.in') {
  return ingestKapsoWebhook({
    event: 'whatsapp.message.received',
    now: at,
    idempotencyKey: id,
    body: message({ id, at, direction: 'inbound', origin: 'cloud_api', body: 'Can we talk about the rate?' }),
  })
}

beforeEach(async () => {
  envOn()
  await resetWhatsappStateForTests()
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('network')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of [
    'WHATSAPP_AUTOREPLY_ENABLED',
    'WHATSAPP_AUTOREPLY_DRY_RUN',
    'WHATSAPP_AUTOREPLY_WAIT_MINUTES',
    'WHATSAPP_AUTOREPLY_COOLDOWN_HOURS',
    'WHATSAPP_AUTOREPLY_MAX_AGE_HOURS',
    'WHATSAPP_AUTOREPLY_TEXT',
    'KAPSO_API_KEY',
    'KAPSO_PHONE_NUMBER_ID',
    'KAPSO_WEBHOOK_SECRET',
    'FUB_LO_PHONE',
    'QUO_API_KEY',
    'QUO_FROM_NUMBER',
  ]) {
    delete process.env[key]
  }
  process.env.ASSISTANT_DEMO_MODE = 'true'
})

describe('whatsapp auto-reply', () => {
  it('auto-replies and texts Joseph when nobody answers', async () => {
    const whatsapp: { to?: string; body: string }[] = []
    const alerts: { to: string; content: string }[] = []
    expect((await inbound(started)).recorded).toBe(1)
    const early = await runWhatsappAutoreply({
      now: new Date(started.getTime() + 4 * 60_000),
      sendWhatsapp: async (input) => {
        whatsapp.push(input)
        return { id: 'wamid.out' }
      },
      sendAlert: async (input) => {
        alerts.push(input)
        return { id: 'sms-1' }
      },
    })
    expect(early.deliveries).toHaveLength(0)
    const due = await runWhatsappAutoreply({
      now: new Date(started.getTime() + 5 * 60_000),
      sendWhatsapp: async (input) => {
        whatsapp.push(input)
        return { id: 'wamid.out' }
      },
      sendAlert: async (input) => {
        alerts.push(input)
        return { id: 'sms-1' }
      },
    })
    expect(whatsapp).toEqual([{ to: '+15555550199', recipient: undefined, body: expect.stringContaining("I'm on another call") }])
    expect(alerts).toEqual([
      {
        to: joseph,
        content: "LoanPilot: WhatsApp from Alex Buyer, no reply in 5 min, auto-replied. 'Can we talk about the rate?'",
      },
    ])
    expect(due.deliveries[0]?.status).toBe('sent')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends nothing when Joseph replies from the Business app', async () => {
    const sendWhatsapp = vi.fn(async () => ({ id: 'wamid.out' }))
    await inbound(started)
    const reply = await ingestKapsoWebhook({
      event: 'whatsapp.message.sent',
      now: new Date(started.getTime() + 60_000),
      idempotencyKey: 'wamid.joe',
      body: message({
        id: 'wamid.joe',
        at: new Date(started.getTime() + 60_000),
        direction: 'outbound',
        origin: 'business_app',
        body: 'On my way',
      }),
    })
    expect(reply.cancelled).toBe(1)
    const due = await runWhatsappAutoreply({
      now: new Date(started.getTime() + 10 * 60_000),
      sendWhatsapp,
      sendAlert: async () => ({ id: 'sms-1' }),
    })
    expect(due.deliveries).toHaveLength(0)
    expect(sendWhatsapp).not.toHaveBeenCalled()
  })

  it('does not treat LoanPilot’s own API echo as Joseph’s reply', async () => {
    const sendWhatsapp = vi.fn(async () => ({ id: 'wamid.out' }))
    await inbound(started)
    const echo = await ingestKapsoWebhook({
      event: 'whatsapp.message.sent',
      now: new Date(started.getTime() + 30_000),
      idempotencyKey: 'echo-1',
      body: message({
        id: 'wamid.api',
        at: new Date(started.getTime() + 30_000),
        direction: 'outbound',
        origin: 'cloud_api',
        body: "Thanks for your message! I'm on another call or in a meeting right now and will get back to you as soon as possible. - Joseph",
      }),
    })
    expect(echo.cancelled).toBe(0)
    await runWhatsappAutoreply({
      now: new Date(started.getTime() + 6 * 60_000),
      sendWhatsapp,
      sendAlert: async () => ({ id: 'sms-1' }),
    })
    expect(sendWhatsapp).toHaveBeenCalledOnce()
  })

  it('waits out the cooldown before a second auto-reply', async () => {
    const sendWhatsapp = vi.fn(async () => ({ id: 'wamid.out' }))
    const sendAlert = vi.fn(async () => ({ id: 'sms-1' }))
    await inbound(started, 'wamid.first')
    await runWhatsappAutoreply({
      now: new Date(started.getTime() + 5 * 60_000),
      sendWhatsapp,
      sendAlert,
    })
    const again = await inbound(new Date(started.getTime() + 30 * 60_000), 'wamid.second')
    expect(again.recorded).toBe(0)
    await runWhatsappAutoreply({
      now: new Date(started.getTime() + 40 * 60_000),
      sendWhatsapp,
      sendAlert,
    })
    expect(sendWhatsapp).toHaveBeenCalledOnce()

    const later = new Date(started.getTime() + 5 * 3_600_000)
    expect((await inbound(later, 'wamid.third')).recorded).toBe(1)
    await runWhatsappAutoreply({
      now: new Date(later.getTime() + 5 * 60_000),
      sendWhatsapp,
      sendAlert,
    })
    expect(sendWhatsapp).toHaveBeenCalledTimes(2)
  })

  it('ignores group chats and status updates', async () => {
    const sendWhatsapp = vi.fn(async () => ({ id: 'wamid.out' }))
    const group = await ingestKapsoWebhook({
      event: 'whatsapp.message.received',
      now: started,
      idempotencyKey: 'group-1',
      body: message({
        id: 'wamid.group',
        at: started,
        direction: 'inbound',
        origin: 'cloud_api',
        body: 'hello group',
        groupId: '120363',
      }),
    })
    const status = await ingestKapsoWebhook({
      event: 'whatsapp.message.read',
      now: started,
      idempotencyKey: 'status-1',
      body: message({ id: 'wamid.status', at: started, direction: 'inbound', origin: 'cloud_api', body: 'seen', type: 'status' }),
    })
    const story = await ingestKapsoWebhook({
      event: 'whatsapp.message.received',
      now: started,
      idempotencyKey: 'story-1',
      body: message({ id: 'wamid.story', at: started, direction: 'inbound', origin: 'cloud_api', body: '', type: 'status' }),
    })
    expect(group.recorded).toBe(0)
    expect(status.recorded).toBe(0)
    expect(story.recorded).toBe(0)
    const due = await runWhatsappAutoreply({
      now: new Date(started.getTime() + 10 * 60_000),
      sendWhatsapp,
      sendAlert: async () => ({ id: 'sms-1' }),
    })
    expect(due.deliveries).toHaveLength(0)
    expect(sendWhatsapp).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong Kapso signature', async () => {
    const body = JSON.stringify(message({ id: 'wamid.in', at: started, direction: 'inbound', origin: 'cloud_api', body: 'Hi' }))
    const bad = new Request('http://local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-webhook-signature': 'deadbeef', 'x-webhook-event': 'whatsapp.message.received' },
      body,
    })
    expect((await whatsappWebhook(bad)).status).toBe(401)

    const unsigned = new Request('http://local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-webhook-event': 'whatsapp.message.received' },
      body,
    })
    expect((await whatsappWebhook(unsigned)).status).toBe(401)

    delete process.env.KAPSO_WEBHOOK_SECRET
    const signature = createHmac('sha256', secret).update(body).digest('hex')
    const missingSecret = new Request('http://local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-webhook-signature': signature, 'x-webhook-event': 'whatsapp.message.received' },
      body,
    })
    expect((await whatsappWebhook(missingSecret)).status).toBe(401)

    process.env.KAPSO_WEBHOOK_SECRET = secret
    const ok = new Request('http://local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-event': 'whatsapp.message.received',
        'x-idempotency-key': 'signed-1',
      },
      body,
    })
    const res = await whatsappWebhook(ok)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { recorded: number }
    expect(json.recorded).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the Quo alert with the wait and a snippet', () => {
    expect(whatsappAlert('Alex Buyer', 5, 'Can we talk about the rate?')).toBe(
      "LoanPilot: WhatsApp from Alex Buyer, no reply in 5 min, auto-replied. 'Can we talk about the rate?'",
    )
  })
})
