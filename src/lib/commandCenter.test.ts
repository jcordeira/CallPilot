import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCommandMessage, type CommandEffects, type LeadHit } from '../../netlify/functions/_shared/commandMode'
import { resetCommandStateForTests } from '../../netlify/functions/_shared/commandStore'
import {
  getCommandCenter,
  listContactMessages,
  postCommandCenter,
  resetCommandCenterForTests,
  sendHubText,
} from '../../netlify/functions/_shared/commandCenter'

const joseph = '+15169969070'
const frankie = '+16315126480'
const line = '+15163869773'
const now = new Date('2026-10-02T14:00:00.000Z')

const siddick: LeadHit = { id: 42, name: 'Siddick Chowdhury', phone: '+15165551000' }
const other: LeadHit = { id: 43, name: 'Siddick Rahman', phone: '+15165551001' }

function effects(): CommandEffects & { sent: { to: string; content: string }[] } {
  const sent: { to: string; content: string }[] = []
  return {
    sent,
    searchLeads: async () => [siddick, other],
    leadDetail: async () => ({ lead: siddick, tasks: [], notes: [] }),
    addNote: async () => undefined,
    createFubTask: async () => undefined,
    createPersonalTask: async () => undefined,
    assignLead: async () => undefined,
    sendSms: async (input) => {
      sent.push(input)
    },
    listEvents: async () => [],
    createEvent: async () => ({ id: 'evt-1' }),
    moveEvent: async () => undefined,
    deleteEvent: async () => undefined,
    freeBusy: async () => [],
    digestMisses: async () => ({ tasks: [], calls: [], texts: [] }),
    googleAccess: async () => ({ write: true, freebusy: true }),
  }
}

beforeEach(async () => {
  process.env.COMMAND_MODE_ENABLED = 'true'
  process.env.COMMAND_MODE_DRY_RUN = 'false'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  process.env.QUO_FROM_NUMBER = line
  process.env.QUO_API_KEY = 'quo-test'
  process.env.FUB_LO_PHONE = joseph
  process.env.FUB_LO_NAME = 'Joseph Cordeira'
  process.env.FUB_LO_USER_ID = '1'
  process.env.TEAM_MEMBERS = JSON.stringify([
    { name: 'Frankie Cordeira', phone: frankie, email: 'fcordeirajr@cliffcomortgage.com', userId: 16, title: 'LOA' },
  ])
  delete process.env.COMMAND_PREFIX
  await resetCommandStateForTests()
  await resetCommandCenterForTests()
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('network')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TEAM_MEMBERS
  delete process.env.QUO_API_KEY
})

describe('command center', () => {
  it('keeps Hub and SMS commands in one thread', async () => {
    const fx = effects()
    const hub = await postCommandCenter({
      text: "what's on today",
      now,
      effects: fx,
      parse: async () => ({ name: 'today_digest', arguments: {} }),
    })
    expect(hub.thread.at(-1)).toMatchObject({ source: 'hub', actor: 'Joseph Cordeira' })
    expect(hub.thread.at(-1)?.reply).toMatch(/calendar today/)

    await handleCommandMessage({
      from: frankie,
      to: line,
      body: 'when is Joe free today',
      messageId: 'sms-1',
      now: new Date(now.getTime() + 60_000),
      effects: fx,
      parse: async () => ({ name: 'availability', arguments: { whenText: 'today' } }),
    })
    const both = await getCommandCenter(new Date(now.getTime() + 120_000))
    expect(both.thread.map((item) => item.source)).toEqual(['hub', 'sms'])
    expect(both.thread.map((item) => item.actor)).toEqual(['Joseph Cordeira', 'Frankie Cordeira'])
  })

  it('turns a lead choice and a client text into buttons, then sends only after YES', async () => {
    const fx = effects()
    const asked = await postCommandCenter({
      text: 'text Siddick: running late',
      now,
      effects: fx,
      parse: async () => ({ name: 'text_client', arguments: { clientName: 'Siddick', body: 'running late' } }),
    })
    expect(asked.pending?.kind).toBe('choice')
    expect(asked.pending?.choices.map((choice) => choice.label)).toEqual(['Siddick Chowdhury', 'Siddick Rahman'])
    expect(fx.sent).toEqual([])

    const picked = await postCommandCenter({
      choice: '1',
      now: new Date(now.getTime() + 1000),
      effects: fx,
      parse: async () => {
        throw new Error('should use the pending choice')
      },
    })
    expect(picked.pending?.kind).toBe('confirm')
    expect(fx.sent).toEqual([])

    const sent = await postCommandCenter({
      choice: 'YES',
      now: new Date(now.getTime() + 2000),
      effects: fx,
      parse: async () => {
        throw new Error('should confirm')
      },
    })
    expect(sent.pending).toBeNull()
    expect(fx.sent).toEqual([{ to: siddick.phone, content: 'running late', priority: 'high', truncate: 'exempt' }])
    expect(sent.reply).toMatch(/Texted Siddick Chowdhury/)
  })

  it('requires Confirm before texting a lead and sends a teammate immediately', async () => {
    const held = await sendHubText({ to: siddick.phone!, name: siddick.name, content: 'hello', kind: 'lead' })
    expect(held).toMatchObject({ sent: false, needsConfirm: true })
    expect(fetch).not.toHaveBeenCalled()

    const client = await sendHubText({ to: siddick.phone!, name: siddick.name, content: 'hello', kind: 'lead', confirmed: true })
    expect(client.sent).toBe(true)
    const history = await listContactMessages(siddick.phone!)
    expect(history.messages.map((item) => item.text)).toEqual(['hello'])

    const team = await sendHubText({ to: frankie, name: 'Frankie Cordeira', content: 'on my way', kind: 'team' })
    expect(team.sent).toBe(true)
    const frankieHistory = await listContactMessages(frankie)
    expect(frankieHistory.messages.map((item) => item.text)).toEqual(['on my way'])
  })
})
