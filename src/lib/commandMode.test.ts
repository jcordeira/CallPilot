import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarCanReadFreeBusy, calendarCanWriteEvents } from '../../netlify/functions/_shared/googleAuth'
import { commandFromToolCall, intentsForRole, parseCommand, toolSchema } from '../../netlify/functions/_shared/commandParse'
import {
  fubMentionNote,
  handleCommandMessage,
  matchLeads,
  type CommandEffects,
  type LeadHit,
} from '../../netlify/functions/_shared/commandMode'
import { resetCommandStateForTests } from '../../netlify/functions/_shared/commandStore'
import { parseWhen } from '../../netlify/functions/_shared/commandTime'
import { verifyQuoWebhook } from '../../netlify/functions/_shared/quoSignature'
import handler from '../../netlify/functions/quo-webhook'

const joseph = '+15169969070'
const frankie = '+16315126480'
const client = '+15165550199'
const line = '+15163869773'
const now = new Date('2026-10-02T14:00:00.000Z')

const siddick: LeadHit = {
  id: 42,
  name: 'Siddick Chowdhury',
  phone: '+15165551000',
  stage: 'Pre-approval',
  assignedTo: 'Joseph Cordeira',
  lastActivity: 'Oct 1',
}

function effects(partial: Partial<CommandEffects> = {}): CommandEffects & {
  sent: { to: string; content: string }[]
  created: { summary: string; guests: string[] }[]
  deleted: string[]
} {
  const sent: { to: string; content: string }[] = []
  const created: { summary: string; guests: string[] }[] = []
  const deleted: string[] = []
  return {
    sent,
    created,
    deleted,
    searchLeads: async () => [siddick],
    leadDetail: async () => ({ lead: siddick, tasks: ['Call back'], notes: ['Left voicemail', 'Sent checklist'] }),
    addNote: async () => undefined,
    createFubTask: async () => undefined,
    createPersonalTask: async () => undefined,
    assignLead: async () => undefined,
    sendSms: async (input) => {
      sent.push(input)
    },
    listEvents: async () => [],
    createEvent: async (input) => {
      created.push({ summary: input.summary, guests: input.guests })
      return { id: 'evt-1' }
    },
    moveEvent: async () => undefined,
    deleteEvent: async (id) => {
      deleted.push(id)
    },
    freeBusy: async () => [],
    digestMisses: async () => ({ tasks: ['Pull docs'], calls: ['Rakesh'], texts: [] }),
    googleAccess: async () => ({ write: true, freebusy: true }),
    ...partial,
  }
}

beforeEach(async () => {
  process.env.COMMAND_MODE_ENABLED = 'true'
  process.env.COMMAND_MODE_DRY_RUN = 'true'
  process.env.ASSISTANT_DEMO_MODE = 'true'
  process.env.QUO_FROM_NUMBER = line
  process.env.FUB_LO_PHONE = joseph
  process.env.FUB_LO_NAME = 'Joseph Cordeira'
  process.env.FUB_LO_USER_ID = '1'
  process.env.FUB_LOA_USER_IDS = '16,27'
  process.env.FUB_LOA_NAME_16 = 'Frankie Cordeira'
  process.env.FUB_LOA_PHONE_16 = frankie
  process.env.FUB_LOA_NAME_27 = 'Daniel Ebbecke'
  process.env.FUB_LOA_PHONE_27 = '+15165213121'
  delete process.env.COMMAND_PREFIX
  delete process.env.CALENDAR_AUTO_GUEST_ENABLED
  delete process.env.TEAM_MEMBERS
  for (const key of ['NAME', 'PHONE', 'EMAIL', 'USER_ID', 'TITLE']) {
    delete process.env[`TEAM_MEMBER_1_${key}`]
    delete process.env[`TEAM_MEMBER_2_${key}`]
    delete process.env[`TEAM_MEMBER_3_${key}`]
  }
  await resetCommandStateForTests()
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('network')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quo webhook signature', () => {
  it('accepts the current Quo signature and rejects a bad one', () => {
    const secret = `whsec_${Buffer.from('supersecretkey1').toString('base64')}`
    const raw = '{"type":"message.received"}'
    const webhookId = 'msg_123'
    const webhookTimestamp = String(Math.floor(now.getTime() / 1000))
    const signature = createHmac('sha256', Buffer.from('supersecretkey1'))
      .update(`${webhookId}.${webhookTimestamp}.${raw}`)
      .digest('base64')
    expect(verifyQuoWebhook({
      rawBody: raw,
      secret,
      webhookId,
      webhookTimestamp,
      webhookSignature: `v1,${signature}`,
      now,
    })).toBe(true)
    expect(verifyQuoWebhook({
      rawBody: raw,
      secret,
      webhookId,
      webhookTimestamp,
      webhookSignature: 'v1,bm90LXZhbGlk',
      now,
    })).toBe(false)
    expect(verifyQuoWebhook({ rawBody: raw, secret: '', webhookId, webhookTimestamp, webhookSignature: `v1,${signature}`, now })).toBe(false)
  })
})

describe('command parser routing', () => {
  it('keeps owner and team tools apart', () => {
    expect(intentsForRole('owner')).toContain('book_call')
    expect(intentsForRole('owner')).not.toContain('request_booking')
    expect(intentsForRole('team')).toEqual(['availability', 'request_booking', 'lead_brief', 'add_note', 'create_task', 'help'])
    expect(toolSchema('team').flatMap((tool) => (tool.type === 'function' ? [tool.function.name] : []))).not.toContain('text_client')
    expect(commandFromToolCall('book_call', { clientName: 'Siddick Chowdhury', whenText: 'tomorrow 2pm', topic: 'refi' }, 'owner').intent).toBe('book_call')
    expect(commandFromToolCall('text_client', { clientName: 'Rakesh', body: 'hi' }, 'team').intent).toBe('unknown')
  })

  it('uses the injected tool call instead of the network', async () => {
    const call = await parseCommand('book Siddick tomorrow 2pm', 'owner', async () => ({
      name: 'book_call',
      arguments: { clientName: 'Siddick Chowdhury', whenText: 'tomorrow 2pm', topic: 'refi' },
    }))
    expect(call).toMatchObject({ intent: 'book_call', clientName: 'Siddick Chowdhury', topic: 'refi' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('command mode', () => {
  it('previews a booking and does not create it while dry run is on', async () => {
    const fx = effects()
    const result = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'book Siddick Chowdhury tomorrow 2pm refi call',
      messageId: 'm-book',
      now,
      parse: async () => ({ name: 'book_call', arguments: { clientName: 'Siddick Chowdhury', whenText: 'tomorrow 2pm', topic: 'refi' } }),
      effects: fx,
    })
    expect(result.reply).toMatch(/\[preview\] Would book Siddick Chowdhury call refi Sat, Oct 3, 2:00\s?PM \(30 min\)\./)
    expect(fx.created).toEqual([])
    expect(fx.sent).toEqual([])
    const again = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'book Siddick Chowdhury tomorrow 2pm refi call',
      messageId: 'm-book',
      now,
      parse: async () => {
        throw new Error('should not parse a duplicate')
      },
      effects: fx,
    })
    expect(again.ignored).toBe('duplicate')
  })

  it('ignores client texts and other senders', async () => {
    const fx = effects()
    const result = await handleCommandMessage({
      from: client,
      to: line,
      body: 'book me tomorrow',
      messageId: 'm-client',
      now,
      parse: async () => {
        throw new Error('should not parse')
      },
      effects: fx,
    })
    expect(result.ignored).toBe('sender')
    expect(result.reply).toBeUndefined()
    expect(fx.sent).toEqual([])
    expect(fx.created).toEqual([])
  })

  it('asks for YES before cancelling and does not delete in dry run', async () => {
    const fx = effects({
      listEvents: async () => [{ id: 'evt-s', summary: 'Siddick Chowdhury call refi', startIso: '2026-10-02T18:00:00.000Z', endIso: '2026-10-02T18:30:00.000Z' }],
    })
    const first = await handleCommandMessage({
      from: joseph,
      to: line,
      body: "cancel Siddick's call",
      messageId: 'm-cancel',
      now,
      parse: async () => ({ name: 'cancel', arguments: { clientName: 'Siddick', whenText: '2pm' } }),
      effects: fx,
    })
    expect(first.reply).toMatch(/\[preview\] Cancel Siddick Chowdhury call refi/)
    expect(first.reply).toMatch(/Reply YES/)
    const second = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'YES',
      messageId: 'm-yes',
      now: new Date(now.getTime() + 60_000),
      parse: async () => {
        throw new Error('should use the pending cancel')
      },
      effects: fx,
    })
    expect(second.reply).toBe('[preview] Would cancel Siddick Chowdhury call refi.')
    expect(fx.deleted).toEqual([])
  })

  it('texts a client only after YES, and dry run still withholds the send', async () => {
    const fx = effects()
    const draft = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'text Siddick: running 10 late',
      messageId: 'm-text',
      now,
      parse: async () => ({ name: 'text_client', arguments: { clientName: 'Siddick Chowdhury', body: 'Running 10 late' } }),
      effects: fx,
    })
    expect(draft.reply).toBe('[preview] Text Siddick Chowdhury: "Running 10 late"? Reply YES.')
    const yes = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'YES',
      messageId: 'm-text-yes',
      now: new Date(now.getTime() + 60_000),
      parse: async () => {
        throw new Error('pending')
      },
      effects: fx,
    })
    expect(yes.reply).toBe('[preview] Would text Siddick Chowdhury: Running 10 late')
    expect(fx.sent).toEqual([])
  })

  it('resolves an ambiguous lead from a numbered reply', async () => {
    const people: LeadHit[] = [
      { id: 1, name: 'Siddick Chowdhury', phone: '+15165551001' },
      { id: 2, name: 'Siddick Ahmed', phone: '+15165551002' },
    ]
    expect(matchLeads('Siddick', people).choices.map((person) => person.id)).toEqual([2, 1])
    const fx = effects({ searchLeads: async () => people })
    const ask = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'brief Siddick',
      messageId: 'm-which',
      now,
      parse: async () => ({ name: 'lead_brief', arguments: { clientName: 'Siddick' } }),
      effects: fx,
    })
    expect(ask.reply).toContain('1. Siddick Ahmed')
    expect(ask.reply).toContain('2. Siddick Chowdhury')
    const picked = await handleCommandMessage({
      from: joseph,
      to: line,
      body: '2',
      messageId: 'm-pick',
      now: new Date(now.getTime() + 60_000),
      parse: async () => {
        throw new Error('pending choice')
      },
      effects: fx,
    })
    expect(picked.reply).toContain('[preview] Siddick Chowdhury')
    expect(picked.reply).toContain('Pre-approval')
  })

  it('lets Frankie ask for open slots without event titles, and requests a booking Joseph must approve', async () => {
    const fx = effects({
      listEvents: async () => [{ id: 'secret', summary: 'Secret Client call refi', startIso: '2026-10-08T19:00:00.000Z', endIso: '2026-10-08T19:30:00.000Z' }],
      freeBusy: async () => [{ startIso: '2026-10-08T13:00:00.000Z', endIso: '2026-10-08T14:00:00.000Z' }],
    })
    const slots = await handleCommandMessage({
      from: frankie,
      to: line,
      body: 'when is Joe free Thursday?',
      messageId: 'm-free',
      now,
      parse: async () => ({ name: 'availability', arguments: { whenText: 'Thursday' } }),
      effects: fx,
    })
    expect(slots.reply).toMatch(/^\[preview\] Open:/)
    expect(slots.reply).not.toContain('Secret')
    expect(fx.sent).toEqual([])

    process.env.COMMAND_MODE_DRY_RUN = 'false'
    const live = effects({
      searchLeads: async () => [{ id: 7, name: 'Rakesh Patel', phone: '+15165551007', stage: 'Lead' }],
    })
    const ask = await handleCommandMessage({
      from: frankie,
      to: line,
      body: 'book Joe with Rakesh Thu 3pm',
      messageId: 'm-req',
      now,
      parse: async () => ({ name: 'request_booking', arguments: { clientName: 'Rakesh Patel', whenText: 'Thu 3pm', topic: 'refi' } }),
      effects: live,
    })
    expect(ask.reply).toContain('Asked Joseph to approve Rakesh Patel call refi')
    expect(live.sent.map((item) => item.to)).toEqual([joseph])
    expect(live.created).toEqual([])
    const approved = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'YES',
      messageId: 'm-approve',
      now: new Date(now.getTime() + 60_000),
      parse: async () => {
        throw new Error('approval pending')
      },
      effects: live,
    })
    expect(approved.reply).toContain('Booked Rakesh Patel call refi')
    expect(live.created[0]?.summary).toBe('Rakesh Patel call refi')
    expect(live.sent.some((item) => item.to === frankie && item.content.includes('approved'))).toBe(true)
  })

  it('parses tomorrow 2pm in Eastern time', () => {
    const when = parseWhen('tomorrow 2pm', now, 'America/New_York')
    expect(when?.start.toISOString()).toBe('2026-10-03T18:00:00.000Z')
  })
})

const debbra = '+12013946798'
const roster = [
  { name: 'Frankie Cordeira', phone: frankie, email: 'fcordeirajr@cliffcomortgage.com', userId: 16, title: 'LOA' },
  { name: 'Daniel Ebbecke', phone: '+15165213121', email: 'debbecke@cliffcomortgage.com', userId: 27, title: 'LOA' },
  { name: 'Debra Rose', phone: debbra, email: 'drose@cliffcomortgage.com', userId: 32, title: 'Processor' },
]

describe('team roster', () => {
  it('lets Debra ask for open slots and lets Joseph text her or the whole team', async () => {
    process.env.TEAM_MEMBERS = JSON.stringify(roster)
    const fx = effects()
    const fromDebra = await handleCommandMessage({
      from: debbra,
      to: line,
      body: 'when is Joe free Thursday?',
      messageId: 'm-debra',
      now,
      parse: async () => ({ name: 'availability', arguments: { whenText: 'Thursday' } }),
      effects: fx,
    })
    expect(fromDebra.ignored).toBeUndefined()
    expect(fromDebra.reply).toMatch(/^\[preview\] Open:/)
    expect(fromDebra.reply).not.toContain('Secret')

    const one = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'text Debra: file is in',
      messageId: 'm-text-debra',
      now,
      parse: async () => ({ name: 'text_team', arguments: { who: 'Debra', body: 'File is in' } }),
      effects: fx,
    })
    expect(one.reply).toBe('[preview] Would text Debra: File is in')

    const all = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'text the team: standup moved',
      messageId: 'm-text-team',
      now,
      parse: async () => ({ name: 'text_team', arguments: { who: 'the team', body: 'Standup moved' } }),
      effects: fx,
    })
    expect(all.reply).toBe('[preview] Would text Frankie, Daniel, and Debra: Standup moved')
    expect(fx.sent).toEqual([])

    process.env.COMMAND_MODE_DRY_RUN = 'false'
    const live = effects()
    const sent = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'text Debra: file is in',
      messageId: 'm-text-debra-live',
      now,
      parse: async () => ({ name: 'text_team', arguments: { who: 'Debra', body: 'File is in' } }),
      effects: live,
    })
    expect(sent.reply).toBe('Texted Debra: File is in')
    expect(live.sent).toEqual([{ to: debbra, content: 'File is in' }])
  })

  it('adds a teammate email on a booking', async () => {
    process.env.TEAM_MEMBERS = JSON.stringify(roster)
    const fx = effects()
    const preview = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'book Siddick Chowdhury tomorrow 2pm refi and add Debra',
      messageId: 'm-add-debra',
      now,
      parse: async () => ({
        name: 'book_call',
        arguments: { clientName: 'Siddick Chowdhury', whenText: 'tomorrow 2pm', topic: 'refi', guests: ['Debra'] },
      }),
      effects: fx,
    })
    expect(preview.reply).toMatch(/\[preview\] Would book Siddick Chowdhury call refi/)
    expect(preview.reply).toContain('Guest: drose@cliffcomortgage.com')
    expect(fx.created).toEqual([])

    process.env.COMMAND_MODE_DRY_RUN = 'false'
    process.env.CALENDAR_AUTO_GUEST_ENABLED = 'true'
    const live = effects()
    const booked = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'book Siddick Chowdhury tomorrow 2pm refi and add Debra',
      messageId: 'm-add-debra-live',
      now,
      parse: async () => ({
        name: 'book_call',
        arguments: { clientName: 'Siddick Chowdhury', whenText: 'tomorrow 2pm', topic: 'refi', guests: ['Debra'] },
      }),
      effects: live,
    })
    expect(booked.reply).toContain('drose@cliffcomortgage.com')
    expect(live.created[0]?.guests).toEqual(['fcordeirajr@cliffcomortgage.com', 'drose@cliffcomortgage.com'])

  })

  it('assigns Debra with a Follow Up Boss mention and a Quo text after YES', async () => {
    process.env.TEAM_MEMBERS = JSON.stringify(roster)
    process.env.COMMAND_MODE_DRY_RUN = 'false'
    const notes: { personId: number; body: string; mentionUserId?: number; mentionName?: string }[] = []
    const assigned: number[] = []
    const fx = effects({
      addNote: async (input) => {
        notes.push(input)
      },
      assignLead: async (_personId, userId) => {
        assigned.push(userId)
      },
    })
    const ask = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'assign Siddick to Debra',
      messageId: 'm-assign-debra',
      now,
      parse: async () => ({ name: 'assign_lead', arguments: { clientName: 'Siddick Chowdhury', assignee: 'Debra' } }),
      effects: fx,
    })
    expect(ask.reply).toContain('Assign Siddick Chowdhury to Debra Rose? Reply YES.')
    expect(notes).toEqual([])
    expect(fx.sent).toEqual([])
    const yes = await handleCommandMessage({
      from: joseph,
      to: line,
      body: 'YES',
      messageId: 'm-assign-debra-yes',
      now: new Date(now.getTime() + 60_000),
      parse: async () => {
        throw new Error('pending assignment')
      },
      effects: fx,
    })
    expect(yes.reply).toBe('Assigned Siddick Chowdhury to Debra Rose.')
    expect(assigned).toEqual([32])
    expect(notes).toEqual([
      { personId: 42, body: 'Assigned to Debra Rose from LoanPilot.', mentionUserId: 32, mentionName: 'Debra Rose' },
    ])
    expect(fx.sent).toEqual([{ to: debbra, content: 'LoanPilot: Siddick Chowdhury is now assigned to you.' }])
    const posted = fubMentionNote({ body: notes[0].body, mentionUserId: 32, mentionName: 'Debra Rose' })
    expect(posted.isHtml).toBe(true)
    expect(posted.mentionUserIds).toEqual([32])
    expect(posted.body).toContain('<span data-user-id="32">Debra Rose</span>')
  })

  it('accepts per-member env vars when TEAM_MEMBERS is unset', async () => {
    process.env.TEAM_MEMBER_1_NAME = 'Debra Rose'
    process.env.TEAM_MEMBER_1_PHONE = debbra
    process.env.TEAM_MEMBER_1_EMAIL = 'drose@cliffcomortgage.com'
    process.env.TEAM_MEMBER_1_TITLE = 'Processor'
    const fx = effects()
    const result = await handleCommandMessage({
      from: debbra,
      to: line,
      body: 'when is Joe free Thursday?',
      messageId: 'm-debra-env',
      now,
      parse: async () => ({ name: 'availability', arguments: { whenText: 'Thursday' } }),
      effects: fx,
    })
    expect(result.ignored).toBeUndefined()
    expect(result.reply).toMatch(/^\[preview\] Open:/)
    expect(commandFromToolCall('text_team', { who: 'the team', body: 'hi' }, 'owner').who).toBe('team')
    expect(commandFromToolCall('book_call', { clientName: 'Siddick', whenText: 'tomorrow 2pm', guests: ['Debra'] }, 'owner').guests).toEqual(['Debra'])
  })
})

describe('calendar scopes for command mode', () => {
  it('treats the full calendar grant as enough for writes and free/busy', () => {
    const full = 'openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks'
    expect(calendarCanWriteEvents(full)).toBe(true)
    expect(calendarCanReadFreeBusy(full)).toBe(true)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.events')).toBe(true)
    expect(calendarCanReadFreeBusy('https://www.googleapis.com/auth/calendar.events')).toBe(false)
    expect(calendarCanReadFreeBusy('https://www.googleapis.com/auth/calendar.freebusy')).toBe(true)
    expect(calendarCanWriteEvents('https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
    expect(calendarCanWriteEvents(undefined)).toBe(false)
  })
})

describe('quo webhook endpoint', () => {
  it('rejects a missing signature and ignores a client text', async () => {
    const denied = await handler(new Request('http://localhost/api/webhooks/quo', { method: 'POST', body: '{}' }))
    expect(denied.status).toBe(401)

    const secret = `whsec_${Buffer.from('supersecretkey1').toString('base64')}`
    process.env.QUO_WEBHOOK_SECRET = secret
    const raw = JSON.stringify({
      type: 'message.received',
      data: { object: { id: 'msg-client', from: client, to: line, direction: 'incoming', body: 'hello, can we talk?' } },
    })
    const webhookId = 'wh_1'
    const webhookTimestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', Buffer.from('supersecretkey1')).update(`${webhookId}.${webhookTimestamp}.${raw}`).digest('base64')
    const res = await handler(new Request('http://localhost/api/webhooks/quo', {
      method: 'POST',
      body: raw,
      headers: { 'webhook-id': webhookId, 'webhook-timestamp': webhookTimestamp, 'webhook-signature': `v1,${signature}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { acted: boolean; ignored: string }
    expect(body.acted).toBe(false)
    expect(body.ignored).toBe('sender')
    expect(fetch).not.toHaveBeenCalled()
  })
})
