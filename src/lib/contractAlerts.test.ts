import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import {
  contractAlertMessage,
  contractAlertsEnabled,
  contractClientMessage,
  contractClientNote,
  contractClientTextEnabled,
  handleFubContractWebhook,
  notifyBuyerContract,
  runContractAlertSweep,
  type ContractAlertDeps,
  type ContractNote,
  type ContractSms,
  type ContractTextLog,
} from '../../netlify/functions/_shared/contractAlerts'
import { resetContractAlertStoreForTests } from '../../netlify/functions/_shared/contractAlertStore'
import { countSmsSegments, QuoSmsError, resetQuoForTests } from '../../netlify/functions/_shared/quo'

const { getStoreMock } = vi.hoisted(() => ({
  getStoreMock: vi.fn((_input?: unknown): unknown => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  }),
}))

vi.mock('@netlify/blobs', () => ({
  getStore: (input: unknown) => getStoreMock(input),
}))

const now = new Date('2026-10-08T18:00:00.000Z')
const entered = '2026-10-08T17:30:00.000Z'
const debra = '+12013946798'
const leadPhone = '+15165550100'
const profile = 'https://teamcordeira.followupboss.com/2/people/view/9'
const smsProfile = 'thriving-faloodeh-857600.netlify.app/p/9'
const approvedAda = "Hi Ada, this is Team Cordeira at Cliffco Mortgage Bankers. We've received your contract of sale - congratulations! Joe Cordeira, Frank Cordeira and Debra Rose will reach out shortly with next steps. This number sends alerts only and can't receive replies."
const approvedThere = "Hi there, this is Team Cordeira at Cliffco Mortgage Bankers. We've received your contract of sale - congratulations! Joe Cordeira, Frank Cordeira and Debra Rose will reach out shortly with next steps. This number sends alerts only and can't receive replies."

function leadPerson(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    name: 'Ada Buyer',
    firstName: 'Ada',
    stage: 'Lead',
    tags: [] as string[],
    phones: [{ value: '5165550100', type: 'mobile', isPrimary: true }],
    ...overrides,
  }
}

function buyerContract(overrides: Record<string, unknown> = {}) {
  return {
    id: 70,
    pipelineId: 1,
    stageId: 14,
    stageName: 'Buyer Contract',
    name: '12 Oak Street',
    status: 'Active',
    price: 650000,
    address: '12 Oak Street, Garden City, NY',
    enteredStageAt: entered,
    people: [{ id: 9, name: 'Ada Buyer' }],
    users: [{ id: 16, name: 'Frankie Cordeira' }],
    ...overrides,
  }
}

function harness(extra: Partial<ContractAlertDeps> = {}) {
  const texts: ContractSms[] = []
  const notes: ContractNote[] = []
  const logs: ContractTextLog[] = []
  const deps: ContractAlertDeps = {
    now,
    loadPerson: async () => null,
    sendSms: async (input) => {
      texts.push(input)
      return { id: `sms-${texts.length}` }
    },
    postNote: async (note) => {
      notes.push(note)
    },
    logText: async (input) => {
      logs.push(input)
    },
    ...extra,
  }
  return { texts, notes, logs, deps }
}

beforeEach(() => {
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'test-key'
  process.env.LOA_REMINDERS_ENABLED = 'false'
  process.env.CORDEIRA_LINE_ALERTS_ENABLED = 'false'
  delete process.env.CONTRACT_ALERTS_ENABLED
  delete process.env.CONTRACT_CLIENT_TEXT_ENABLED
  delete process.env.CONTRACT_ALERT_PHONES
  delete process.env.CONTRACT_ALERT_USER_ID
  delete process.env.CONTRACT_ALERT_NAME
  delete process.env.SMS_MAX_SEGMENTS_PER_MESSAGE
  resetQuoForTests()
  getStoreMock.mockReset()
  getStoreMock.mockImplementation(() => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  })
  resetContractAlertStoreForTests()
})

afterEach(() => {
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.LOA_REMINDERS_ENABLED
  delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
  delete process.env.CONTRACT_ALERTS_ENABLED
  delete process.env.CONTRACT_CLIENT_TEXT_ENABLED
  delete process.env.CONTRACT_ALERT_PHONES
  delete process.env.SMS_MAX_SEGMENTS_PER_MESSAGE
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  process.env.ASSISTANT_DEMO_MODE = 'true'
  resetContractAlertStoreForTests()
  vi.unstubAllGlobals()
})

describe('Buyer Contract alerts', () => {
  it('is on unless the flag is explicitly false', () => {
    delete process.env.CONTRACT_ALERTS_ENABLED
    expect(contractAlertsEnabled()).toBe(true)
    process.env.CONTRACT_ALERTS_ENABLED = 'false'
    expect(contractAlertsEnabled()).toBe(false)
  })

  it('formats the text with the lead, the deal, the price, the address, the agent, and the profile link', () => {
    const message = contractAlertMessage({
      leadName: 'Ada Buyer',
      dealName: '12 Oak Street',
      personId: 9,
      priceLabel: '$650,000',
      address: '12 Oak Street, Garden City, NY',
      agentName: 'Frankie Cordeira',
    })
    expect(message).toBe(
      `LoanPilot: Contract in. Ada Buyer moved to Buyer Contract. Deal 12 Oak Street. $650,000. 12 Oak Street, Garden City, NY. Agent Frankie Cordeira. ${smsProfile}`,
    )
    expect(contractAlertMessage({ leadName: 'Ada Buyer', dealName: '12 Oak Street', personId: 9 })).not.toContain('Price:')
    expect(contractAlertMessage({ leadName: 'Ada Buyer', dealName: '12 Oak Street', personId: 9 })).not.toContain('Address:')
  })

  it('texts Debra once when a deal is created in Buyer Contract, and a retry does not text again', async () => {
    const fx = harness()
    const deal = buyerContract()
    const created = await handleFubContractWebhook({ event: 'dealsCreated', resourceIds: [70] }, { ...fx.deps, loadDeal: async () => deal })
    expect(created.sent).toBe(1)
    expect(created.noted).toBe(1)
    expect(fx.texts).toEqual([{ to: debra, content: expect.stringContaining(smsProfile) }])
    expect(fx.texts[0]?.content).toContain('Ada Buyer moved to Buyer Contract')
    expect(fx.texts[0]?.content).toContain('Deal 12 Oak Street')
    expect(fx.texts[0]?.content).toContain('$650,000')
    expect(fx.texts[0]?.content).toContain('12 Oak Street, Garden City, NY')
    expect(fx.texts[0]?.content).toContain('Agent Frankie Cordeira')
    expect(fx.notes[0]).toMatchObject({
      personId: 9,
      subject: 'LoanPilot — Buyer Contract',
      isHtml: true,
      mentionUserIds: [32],
    })
    expect(fx.notes[0]?.body).toContain('data-user-id="32"')
    expect(fx.notes[0]?.body).toContain('Debra Rose')
    expect(fx.notes[0]?.body).toContain(profile)

    const retry = await handleFubContractWebhook({ event: 'dealsUpdated', resourceIds: [70] }, { ...fx.deps, loadDeal: async () => deal })
    expect(retry.sent).toBe(0)
    expect(retry.noted).toBe(0)
    expect(fx.texts).toHaveLength(1)
    expect(fx.notes).toHaveLength(1)
  })

  it('does not text again when the 15-minute sweep sees the same entry', async () => {
    const fx = harness()
    const deal = buyerContract()
    await notifyBuyerContract(deal, fx.deps)
    const sweep = await runContractAlertSweep({
      ...fx.deps,
      listDeals: async () => [deal, buyerContract({ id: 71, pipelineId: 2 }), buyerContract({ id: 72, stageId: 44, stageName: 'Offer Accepted' })],
    })
    expect(sweep.checked).toBe(1)
    expect(sweep.sent).toBe(0)
    expect(fx.texts).toHaveLength(1)
    expect(fx.notes).toHaveLength(1)
  })

  it('texts once more when the deal leaves and later re-enters Buyer Contract', async () => {
    const fx = harness()
    const deal = buyerContract()
    await notifyBuyerContract(deal, fx.deps)
    const left = await notifyBuyerContract(buyerContract({ stageId: 127, stageName: 'Ready to Submit' }), fx.deps)
    expect(left.skipped).toBe('not_buyer_contract')
    const again = await notifyBuyerContract(buyerContract({ enteredStageAt: '2026-10-08T17:50:00.000Z' }), fx.deps)
    expect(again.sent).toBe(1)
    expect(fx.texts).toHaveLength(2)
    expect(fx.notes).toHaveLength(2)
  })

  it('ignores another pipeline, another stage, a stale entry, and a missing stage id unless the name is Buyer Contract', async () => {
    const fx = harness()
    expect((await notifyBuyerContract(buyerContract({ pipelineId: 2 }), fx.deps)).skipped).toBe('not_buyer_contract')
    expect((await notifyBuyerContract(buyerContract({ stageId: 44, stageName: 'Offer Accepted' }), fx.deps)).skipped).toBe('not_buyer_contract')
    expect((await notifyBuyerContract(buyerContract({ enteredStageAt: '2026-10-01T17:30:00.000Z' }), fx.deps)).skipped).toBe('stale')
    expect((await notifyBuyerContract(buyerContract({ pipelineId: 2, stageId: undefined, stageName: 'Buyer Contract' }), fx.deps)).skipped).toBe('not_buyer_contract')
    const named = await notifyBuyerContract(buyerContract({ id: 80, stageId: undefined, stageName: 'Buyer Contract' }), fx.deps)
    expect(named.sent).toBe(1)
    expect(fx.texts).toHaveLength(1)
    expect(fx.texts[0]?.to).toBe(debra)
  })

  it('does not text when two workers see the same entry or the blob claim cannot be proven', async () => {
    const fx = harness()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sendSms: ContractAlertDeps['sendSms'] = vi.fn(async (input: { to: string; content: string }) => {
      await gate
      fx.texts.push(input)
      return { id: 'sms-1' }
    })
    const pending = Promise.all([
      notifyBuyerContract(buyerContract(), { ...fx.deps, sendSms }),
      notifyBuyerContract(buyerContract(), { ...fx.deps, sendSms }),
    ])
    await vi.waitFor(() => expect(sendSms).toHaveBeenCalledTimes(1))
    release()
    await pending
    expect(fx.texts).toHaveLength(1)

    resetContractAlertStoreForTests()
    getStoreMock.mockImplementation((input: unknown) => {
      const name = typeof input === 'string' ? input : (input as { name?: string } | null)?.name
      if (name !== 'loanpilot-contract-alerts') throw new Error('The environment has not been configured to use Netlify Blobs')
      return {
        async get() {
          return { token: 'someone-else' }
        },
        async setJSON() {
          return { modified: true, etag: 'etag-1' }
        },
        async delete() {
          return undefined
        },
      }
    })
    const blocked = harness()
    const result = await notifyBuyerContract(buyerContract({ id: 81 }), blocked.deps)
    expect(result.sent).toBe(0)
    expect(result.noted).toBe(0)
    expect(blocked.texts).toHaveLength(0)
    expect(getStoreMock).toHaveBeenCalledWith({ name: 'loanpilot-contract-alerts', consistency: 'strong' })
  })

  it('does not load the deal while the flag is off', async () => {
    process.env.CONTRACT_ALERTS_ENABLED = 'false'
    const loadDeal = vi.fn(async () => buyerContract())
    const result = await handleFubContractWebhook({ event: 'dealsUpdated', resourceIds: [70] }, { loadDeal, now })
    expect(result.skipped).toBe('disabled')
    expect(loadDeal).not.toHaveBeenCalled()
  })

  it('loads the deal from Follow Up Boss, texts once, and ignores unknown events without fetching', async () => {
    process.env.QUO_API_KEY = 'quo-test'
    process.env.QUO_FROM_NUMBER = '+15163869773'
    const enteredStageAt = new Date().toISOString()
    const notes: { personId?: number; subject?: string; isHtml?: boolean; mentions?: { user?: number[] }; body?: string }[] = []
    const texts: { from?: string; to?: string[]; content?: string }[] = []
    const textLogs: { personId?: number; message?: string; toNumber?: string; fromNumber?: string; isIncoming?: boolean }[] = []
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        urls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url === 'https://api.followupboss.com/v1/deals/70') {
          return new Response(
            JSON.stringify(buyerContract({ customPropertyAddress: '12 Oak Street, Garden City, NY', address: undefined, enteredStageAt })),
            { status: 200 },
          )
        }
        if (url === 'https://api.followupboss.com/v1/people/9') {
          return new Response(JSON.stringify(leadPerson()), { status: 200 })
        }
        if (url === 'https://api.followupboss.com/v1/notes' && init?.method === 'POST') {
          notes.push(JSON.parse(String(init.body ?? '{}')) as (typeof notes)[number])
          return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
        }
        if (url === 'https://api.followupboss.com/v1/textMessages' && init?.method === 'POST') {
          textLogs.push(JSON.parse(String(init.body ?? '{}')) as (typeof textLogs)[number])
          return new Response(JSON.stringify({ id: textLogs.length }), { status: 200 })
        }
        if (url === 'https://api.openphone.com/v1/messages' && init?.method === 'POST') {
          texts.push(JSON.parse(String(init.body ?? '{}')) as (typeof texts)[number])
          return new Response(JSON.stringify({ data: { id: 'msg-1' } }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      }),
    )

    const post = (event: string, id = 70) =>
      fubWebhook(
        new Request('https://site.example/api/webhooks/fub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, resourceIds: [id], uri: `https://api.followupboss.com/v1/deals?id=${id}` }),
        }),
      )

    const created = await post('dealsUpdated')
    expect(created.status).toBe(200)
    expect(texts).toEqual([
      expect.objectContaining({
        from: '+15163869773',
        to: [debra],
        content: expect.stringContaining('12 Oak Street, Garden City, NY'),
      }),
      expect.objectContaining({
        from: '+15163869773',
        to: [leadPhone],
        content: approvedAda,
      }),
    ])
    expect(notes).toHaveLength(2)
    expect(notes[0]?.isHtml).toBe(true)
    expect(notes[0]?.mentions).toEqual({ user: [32] })
    expect(notes[0]?.body).toContain('data-user-id="32"')
    expect(notes[1]?.body).toBe(contractClientNote(leadPhone))
    expect(notes[1]?.isHtml).toBe(false)
    expect(textLogs).toEqual([
      expect.objectContaining({
        personId: 9,
        message: approvedAda,
        toNumber: leadPhone,
        fromNumber: '+15163869773',
        isIncoming: false,
      }),
    ])

    await post('dealsUpdated')
    expect(texts).toHaveLength(2)
    expect(notes).toHaveLength(2)
    expect(textLogs).toHaveLength(1)

    const unknown = await post('appointmentsCreated', 5)
    expect(unknown.status).toBe(200)
    const unknownBody = (await unknown.json()) as { skipped?: string }
    expect(unknownBody.skipped).toBe('ignored')
    expect(urls.some((url) => url.includes('/deals/5') || url.includes('appointments'))).toBe(false)

    const removed = await post('dealsDeleted', 70)
    expect(removed.status).toBe(200)
    expect(texts).toHaveLength(2)
  })

  it('matches the approved client text exactly and keeps it on two GSM-7 segments', () => {
    expect(contractClientTextEnabled()).toBe(true)
    process.env.CONTRACT_CLIENT_TEXT_ENABLED = 'false'
    expect(contractClientTextEnabled()).toBe(false)
    expect(contractClientMessage('Ada')).toBe(approvedAda)
    expect(contractClientMessage('')).toBe(approvedThere)
    expect(contractClientMessage('Ada Buyer')).toBe(approvedAda)
    const counted = countSmsSegments(approvedAda)
    expect(counted.encoding).toBe('gsm7')
    expect(counted.segments).toBe(2)
    expect(counted.units).toBe(approvedAda.length)
  })

  it('texts the primary lead once, logs it, and a retry or sweep does not text again', async () => {
    process.env.QUO_FROM_NUMBER = '+15163869773'
    const seen: number[] = []
    const fx = harness({
      loadPerson: async (id) => {
        seen.push(id)
        return leadPerson()
      },
    })
    const deal = buyerContract({
      people: [
        { id: 9, name: 'Ada Buyer' },
        { id: 10, name: 'Bob Coe' },
      ],
    })
    const created = await notifyBuyerContract(deal, fx.deps)
    expect(created.sent).toBe(1)
    expect(created.clientSent).toBe(1)
    expect(created.clientNoted).toBe(1)
    expect(seen).toEqual([9])
    expect(fx.texts).toEqual([
      { to: debra, content: expect.stringContaining('Ada Buyer moved to Buyer Contract') },
      { to: leadPhone, content: approvedAda, priority: 'high', truncate: 'exempt' },
    ])
    expect(fx.notes.map((note) => note.body)).toEqual([expect.stringContaining('data-user-id="32"'), contractClientNote(leadPhone)])
    expect(fx.logs).toEqual([{ personId: 9, message: approvedAda, toNumber: leadPhone, fromNumber: '+15163869773' }])

    const retry = await notifyBuyerContract(deal, fx.deps)
    expect(retry.clientSent).toBe(0)
    expect(retry.skipped).toBe('duplicate')
    const sweep = await runContractAlertSweep({ ...fx.deps, listDeals: async () => [deal] })
    expect(sweep.checked).toBe(1)
    expect(sweep.sent).toBe(0)
    expect(sweep.clientSent).toBe(0)
    expect(fx.texts).toHaveLength(2)
    expect(fx.notes).toHaveLength(2)
    expect(fx.logs).toHaveLength(1)
    expect(seen).toEqual([9])
  })

  it('uses Hi there when the lead has no first name', async () => {
    const fx = harness({
      loadPerson: async () => leadPerson({ name: ' ', firstName: '', phones: [{ value: '+1 (516) 555-0100', type: 'mobile' }] }),
    })
    await notifyBuyerContract(buyerContract({ people: [{ id: 9, name: '' }] }), fx.deps)
    expect(fx.texts.find((text) => text.to === leadPhone)?.content).toBe(approvedThere)
  })

  it('texts only the mobile when the primary number is a landline', async () => {
    const fx = harness({
      loadPerson: async () => leadPerson({
        phones: [
          { value: '5165550199', type: 'work', isPrimary: true },
          { value: '5165550100', type: 'cell', isPrimary: false },
        ],
      }),
    })
    await notifyBuyerContract(buyerContract(), fx.deps)
    expect(fx.texts.filter((text) => text.to === leadPhone)).toHaveLength(1)
    expect(fx.texts.some((text) => text.to === '+15165550199')).toBe(false)
  })

  it('skips a lead with no valid US phone, a DNC tag, or a Trash or Wrong Number stage, and does not retry', async () => {
    const cases: { id: number; person: Record<string, unknown> }[] = [
      { id: 91, person: leadPerson({ phones: [] }) },
      { id: 92, person: leadPerson({ phones: [{ value: '+447911123456', type: 'mobile' }] }) },
      { id: 93, person: leadPerson({ tags: ['DNC'] }) },
      { id: 94, person: leadPerson({ tags: ['Do Not Text'] }) },
      { id: 95, person: leadPerson({ tags: ['Bad Phone'] }) },
      { id: 96, person: leadPerson({ tags: ['Wrong Number'] }) },
      { id: 97, person: leadPerson({ tags: ['Opted Out'] }) },
      { id: 98, person: leadPerson({ stage: 'Trash' }) },
      { id: 99, person: leadPerson({ stage: 'Wrong Number' }) },
    ]
    for (const item of cases) {
      const loads = vi.fn(async () => item.person)
      const fx = harness({ loadPerson: loads })
      const deal = buyerContract({ id: item.id })
      const first = await notifyBuyerContract(deal, fx.deps)
      const second = await notifyBuyerContract(deal, fx.deps)
      expect(first.clientSent, String(item.id)).toBe(0)
      expect(second.clientSent, String(item.id)).toBe(0)
      expect(fx.texts.map((text) => text.to)).toEqual([debra])
      expect(loads).toHaveBeenCalledTimes(1)
      expect(fx.notes.some((note) => note.body.includes('contract-received'))).toBe(false)
    }
  })

  it('does not text the client while the client flag is off, and still texts Debra', async () => {
    process.env.CONTRACT_CLIENT_TEXT_ENABLED = 'false'
    const loadPerson = vi.fn(async () => leadPerson())
    const fx = harness({ loadPerson })
    const result = await notifyBuyerContract(buyerContract(), fx.deps)
    expect(result.sent).toBe(1)
    expect(result.clientSent).toBe(0)
    expect(loadPerson).not.toHaveBeenCalled()
    expect(fx.texts).toHaveLength(1)
    expect(fx.texts[0]?.to).toBe(debra)
  })

  it('retries a budget skip and a 402 on the next sweep, and still texts only once', async () => {
    let budget = true
    const budgetFx = harness({ loadPerson: async () => leadPerson() })
    budgetFx.deps.sendSms = async (input) => {
      if (input.to === leadPhone && budget) return { skipped: 'budget' }
      budgetFx.texts.push(input)
      return { id: `sms-${budgetFx.texts.length}` }
    }
    const deal = buyerContract({ id: 101 })
    const blocked = await notifyBuyerContract(deal, budgetFx.deps)
    expect(blocked.sent).toBe(1)
    expect(blocked.clientSent).toBe(0)
    expect(budgetFx.texts.map((text) => text.to)).toEqual([debra])
    budget = false
    const sweep = await runContractAlertSweep({ ...budgetFx.deps, listDeals: async () => [deal] })
    expect(sweep.clientSent).toBe(1)
    expect(sweep.sent).toBe(0)
    const again = await runContractAlertSweep({ ...budgetFx.deps, listDeals: async () => [deal] })
    expect(again.clientSent).toBe(0)
    expect(budgetFx.texts.filter((text) => text.to === leadPhone)).toEqual([
      { to: leadPhone, content: approvedAda, priority: 'high', truncate: 'exempt' },
    ])

    let paymentBlock = true
    const paymentFx = harness({ loadPerson: async () => leadPerson() })
    paymentFx.deps.sendSms = async (input) => {
      if (input.to === leadPhone && paymentBlock) throw new QuoSmsError(402, 'payment required')
      paymentFx.texts.push(input)
      return { id: `sms-${paymentFx.texts.length}` }
    }
    const paymentDeal = buyerContract({ id: 102 })
    await notifyBuyerContract(paymentDeal, paymentFx.deps)
    expect(paymentFx.texts.map((text) => text.to)).toEqual([debra])
    paymentBlock = false
    const retried = await notifyBuyerContract(paymentDeal, paymentFx.deps)
    expect(retried.clientSent).toBe(1)
    expect(retried.sent).toBe(0)
    await notifyBuyerContract(paymentDeal, paymentFx.deps)
    expect(paymentFx.texts.filter((text) => text.to === leadPhone)).toHaveLength(1)
  })

  it('retries the client log after a note failure without sending a second text', async () => {
    process.env.QUO_FROM_NUMBER = '+15163869773'
    let failNote = true
    const fx = harness({ loadPerson: async () => leadPerson() })
    fx.deps.postNote = async (note) => {
      if (note.body === contractClientNote(leadPhone) && failNote) {
        failNote = false
        throw new Error('note down')
      }
      fx.notes.push(note)
    }
    const deal = buyerContract({ id: 103 })
    const first = await notifyBuyerContract(deal, fx.deps)
    expect(first.clientSent).toBe(1)
    expect(first.clientNoted).toBe(0)
    expect(fx.logs).toHaveLength(0)
    const second = await notifyBuyerContract(deal, fx.deps)
    expect(second.clientSent).toBe(0)
    expect(second.clientNoted).toBe(1)
    expect(fx.texts.filter((text) => text.to === leadPhone)).toHaveLength(1)
    expect(fx.notes.filter((note) => note.body === contractClientNote(leadPhone))).toHaveLength(1)
    expect(fx.logs).toHaveLength(1)
  })

  it('retries a person lookup failure on the next pass and still texts once', async () => {
    let down = true
    const fx = harness({
      loadPerson: async () => {
        if (down) throw new Error('Follow Up Boss timed out')
        return leadPerson()
      },
    })
    const deal = buyerContract({ id: 105 })
    const first = await notifyBuyerContract(deal, fx.deps)
    expect(first.clientSent).toBe(0)
    expect(fx.texts.map((text) => text.to)).toEqual([debra])
    down = false
    const second = await notifyBuyerContract(deal, fx.deps)
    expect(second.clientSent).toBe(1)
    await notifyBuyerContract(deal, fx.deps)
    expect(fx.texts.filter((text) => text.to === leadPhone)).toHaveLength(1)
  })

  it('sends the full client text when the segment cap would otherwise cut it', async () => {
    process.env.SMS_MAX_SEGMENTS_PER_MESSAGE = '1'
    process.env.QUO_API_KEY = 'quo-test'
    process.env.QUO_FROM_NUMBER = '+15163869773'
    resetQuoForTests()
    const posted: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('openphone.com') && init?.method === 'POST') {
        posted.push((JSON.parse(String(init.body ?? '{}')) as { content?: string }).content ?? '')
        return new Response(JSON.stringify({ data: { id: 'msg-cap' } }), { status: 200 })
      }
      if (url.endsWith('/notes') && init?.method === 'POST') return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      if (url.endsWith('/textMessages') && init?.method === 'POST') return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      return new Response('unexpected', { status: 500 })
    }))
    const result = await notifyBuyerContract(buyerContract({ id: 104 }), { now, loadPerson: async () => leadPerson() })
    expect(result.clientSent).toBe(1)
    expect(posted).toContain(approvedAda)
    expect(countSmsSegments(approvedAda).segments).toBe(2)
  })
})
