import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import {
  contractAlertMessage,
  contractAlertsEnabled,
  handleFubContractWebhook,
  notifyBuyerContract,
  runContractAlertSweep,
  type ContractAlertDeps,
  type ContractNote,
} from '../../netlify/functions/_shared/contractAlerts'
import { resetContractAlertStoreForTests } from '../../netlify/functions/_shared/contractAlertStore'

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
const profile = 'https://teamcordeira.followupboss.com/2/people/view/9'

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
  const texts: { to: string; content: string }[] = []
  const notes: ContractNote[] = []
  const deps: ContractAlertDeps = {
    now,
    sendSms: async (input) => {
      texts.push(input)
      return { id: `sms-${texts.length}` }
    },
    postNote: async (note) => {
      notes.push(note)
    },
    ...extra,
  }
  return { texts, notes, deps }
}

beforeEach(() => {
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'test-key'
  process.env.LOA_REMINDERS_ENABLED = 'false'
  process.env.CORDEIRA_LINE_ALERTS_ENABLED = 'false'
  delete process.env.CONTRACT_ALERTS_ENABLED
  delete process.env.CONTRACT_ALERT_PHONES
  delete process.env.CONTRACT_ALERT_USER_ID
  delete process.env.CONTRACT_ALERT_NAME
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
  delete process.env.CONTRACT_ALERT_PHONES
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
      `LoanPilot: Contract is in! Ada Buyer moved to Buyer Contract (Purchase). Deal: 12 Oak Street. Price: $650,000. Address: 12 Oak Street, Garden City, NY. Agent: Frankie Cordeira. FUB: ${profile}`,
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
    expect(fx.texts).toEqual([{ to: debra, content: expect.stringContaining(`FUB: ${profile}`) }])
    expect(fx.texts[0]?.content).toContain('Ada Buyer moved to Buyer Contract (Purchase)')
    expect(fx.texts[0]?.content).toContain('Deal: 12 Oak Street')
    expect(fx.texts[0]?.content).toContain('Price: $650,000')
    expect(fx.texts[0]?.content).toContain('Address: 12 Oak Street, Garden City, NY')
    expect(fx.texts[0]?.content).toContain('Agent: Frankie Cordeira')
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
        if (url === 'https://api.followupboss.com/v1/notes' && init?.method === 'POST') {
          notes.push(JSON.parse(String(init.body ?? '{}')) as (typeof notes)[number])
          return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
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
        content: expect.stringContaining('Address: 12 Oak Street, Garden City, NY'),
      }),
    ])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.isHtml).toBe(true)
    expect(notes[0]?.mentions).toEqual({ user: [32] })
    expect(notes[0]?.body).toContain('data-user-id="32"')

    await post('dealsUpdated')
    expect(texts).toHaveLength(1)
    expect(notes).toHaveLength(1)

    const unknown = await post('appointmentsCreated', 5)
    expect(unknown.status).toBe(200)
    const unknownBody = (await unknown.json()) as { skipped?: string }
    expect(unknownBody.skipped).toBe('ignored')
    expect(urls.some((url) => url.includes('/deals/5') || url.includes('appointments'))).toBe(false)

    const removed = await post('dealsDeleted', 70)
    expect(removed.status).toBe(200)
    expect(texts).toHaveLength(1)
  })
})
