import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandHelpText } from '../../netlify/functions/_shared/commandMode'
import { claimQuoMessage, resetCommandStateForTests } from '../../netlify/functions/_shared/commandStore'
import { clipSms, digestSms } from '../../netlify/functions/_shared/loaReminders'
import {
  gsmSegmentCount,
  isGsm7,
  noteQuoPaymentFailure,
  quoSmsPaused,
  resetQuoForTests,
  sendSms,
  toGsm7,
} from '../../netlify/functions/_shared/quo'
import { whatsappAlert } from '../../netlify/functions/_shared/whatsappAutoreply'

const { blobs } = vi.hoisted(() => ({
  blobs: {
    fail: false,
    rows: new Map<string, { token?: string; until?: string }>(),
    etags: new Map<string, string>(),
    etag: 0,
  },
}))

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    async setJSON(key: string, value: { token?: string; until?: string }, opts?: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
      if (blobs.fail) throw new Error('blobs down')
      const etag = blobs.etags.get(key)
      if (opts?.onlyIfNew && blobs.rows.has(key)) return { modified: false }
      if (opts?.onlyIfMatch && opts.onlyIfMatch !== etag) return { modified: false }
      blobs.rows.set(key, value)
      blobs.etag += 1
      blobs.etags.set(key, `e${blobs.etag}`)
      return { modified: true, etag: `e${blobs.etag}` }
    },
    async get(key: string) {
      return blobs.rows.get(key) ?? null
    },
    async getWithMetadata(key: string) {
      if (blobs.fail) throw new Error('blobs down')
      const data = blobs.rows.get(key)
      if (!data) return null
      return { data, etag: blobs.etags.get(key), metadata: {} }
    },
    async delete(key: string) {
      blobs.rows.delete(key)
      blobs.etags.delete(key)
    },
  }),
}))

beforeEach(async () => {
  blobs.fail = false
  blobs.rows.clear()
  blobs.etags.clear()
  resetQuoForTests()
  await resetCommandStateForTests()
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
  process.env.QUO_API_KEY = 'quo-test'
  process.env.QUO_FROM_NUMBER = '+15163869773'
})

afterEach(() => {
  resetQuoForTests()
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  process.env.ASSISTANT_DEMO_MODE = 'true'
  vi.unstubAllGlobals()
})

describe('GSM-7 SMS', () => {
  it('maps punctuation and drops everything outside the single-septet alphabet', () => {
    expect(toGsm7('Hello \u2014 world\u2026 \u201Cyes\u201D\u00A0next')).toBe('Hello - world... "yes" next')
    expect(toGsm7('Price is 10 {ok} \u20AC')).toBe('Price is 10 {ok} \u20AC')
    expect(isGsm7(toGsm7('Ada Buyer \u2014 docs \uD83D\uDE00'))).toBe(true)
    expect(gsmSegmentCount('x'.repeat(160))).toBe(1)
    expect(gsmSegmentCount('x'.repeat(161))).toBe(2)
  })

  it('keeps every outbound template in GSM-7', () => {
    const href = 'https://teamcordeira.followupboss.com/2/people/view/100'
    const digest = digestSms('Joseph Cordeira', [
      {
        key: 'task-1',
        kind: 'task',
        seatUserId: 1,
        personId: 100,
        personName: 'Alex Buyer',
        title: 'Follow up',
        line: 'Overdue task: Follow up',
        missedAt: '2026-10-02T15:00:00.000Z',
        href,
      },
    ])
    const clipped = clipSms(`${href}\n${'x'.repeat(700)}`)
    const alert = whatsappAlert('Alex Buyer', 5, 'Can we talk\u2014about the \u201Crate\u201D\u2026 \uD83D\uDCDE')
    const templates = [digest, clipped, alert, commandHelpText('owner'), commandHelpText('team')]
    for (const template of templates) expect(isGsm7(template)).toBe(true)
    expect(digest).toContain('Alex Buyer Follow up')
    expect(digest).not.toContain('\u2014')
    expect(clipped.endsWith('...')).toBe(true)
    expect(alert).toContain('talk-about the "rate"...')
    expect(alert).not.toMatch(/\uD83D/)
    expect(commandHelpText('owner').length).toBeLessThanOrEqual(160)
    expect(commandHelpText('team').length).toBeLessThanOrEqual(160)
    expect(gsmSegmentCount(commandHelpText('owner'))).toBe(1)
    expect(gsmSegmentCount(commandHelpText('team'))).toBe(1)
  })

  it('sends GSM-7 text and backs off for 30 minutes after a 402', async () => {
    const bodies: { content?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as { content?: string })
      return new Response('payment required', { status: 402 })
    }))
    await expect(sendSms({ to: '+15169969070', content: 'Hello \u2014 world\u2026' })).rejects.toThrow(/402/)
    expect(bodies[0]?.content).toBe('Hello - world...')
    await expect(sendSms({ to: '+15169969070', content: 'again' })).rejects.toThrow(/backoff/)
    expect(bodies).toHaveLength(1)

    resetQuoForTests()
    blobs.rows.clear()
    const start = new Date('2026-10-02T15:00:00.000Z')
    await noteQuoPaymentFailure(start)
    expect(await quoSmsPaused(new Date(start.getTime() + 29 * 60 * 1000))).toBe(true)
    expect(await quoSmsPaused(new Date(start.getTime() + 31 * 60 * 1000))).toBe(false)
  })

  it('fails closed when the message claim cannot be stored', async () => {
    blobs.fail = true
    expect(await claimQuoMessage('msg-down')).toBe(false)
    blobs.fail = false
    expect(await claimQuoMessage('msg-ok', '2026-10-02T15:00:00.000Z')).toBe(true)
    expect(await claimQuoMessage('msg-ok', '2026-10-02T15:00:01.000Z')).toBe(false)
  })
})
