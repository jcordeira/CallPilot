import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { smsPersonLink } from '../../netlify/functions/_shared/loaReminders'
import {
  collapseSms,
  countSmsSegments,
  dailyLimitNotice,
  fitSms,
  getSmsUsage,
  resetQuoForTests,
  sendSms,
} from '../../netlify/functions/_shared/quo'

const { blobs } = vi.hoisted(() => ({
  blobs: {
    off: true,
    fail: false,
    conflictOnce: false,
    rows: new Map<string, unknown>(),
    etags: new Map<string, string>(),
    n: 0,
  },
}))

vi.mock('@netlify/blobs', () => ({
  getStore: () => {
    if (blobs.off) throw new Error('The environment has not been configured to use Netlify Blobs')
    return {
      async getWithMetadata(key: string) {
        if (blobs.fail) throw new Error('blobs down')
        const data = blobs.rows.get(key)
        if (!data) return null
        return { data, etag: blobs.etags.get(key), metadata: {} }
      },
      async setJSON(key: string, value: unknown, opts?: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
        if (blobs.fail) throw new Error('blobs down')
        if (blobs.conflictOnce) {
          blobs.conflictOnce = false
          return { modified: false }
        }
        const etag = blobs.etags.get(key)
        if (opts?.onlyIfNew && blobs.rows.has(key)) return { modified: false }
        if (opts?.onlyIfMatch && opts.onlyIfMatch !== etag) return { modified: false }
        blobs.n += 1
        blobs.rows.set(key, value)
        blobs.etags.set(key, `e${blobs.n}`)
        return { modified: true, etag: `e${blobs.n}` }
      },
    }
  },
}))

const now = new Date('2026-10-02T15:00:00.000Z')
const joe = '+15169969070'

function gsm(chars: number): string {
  return 'x'.repeat(chars)
}

beforeEach(() => {
  blobs.off = true
  blobs.fail = false
  blobs.conflictOnce = false
  blobs.rows.clear()
  blobs.etags.clear()
  blobs.n = 0
  resetQuoForTests()
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
  process.env.QUO_API_KEY = 'quo-test'
  process.env.QUO_FROM_NUMBER = '+15163869773'
  process.env.SMS_DAILY_SEGMENT_CAP = '10'
  process.env.SMS_PER_RECIPIENT_DAILY_CAP = '20'
  process.env.SMS_MAX_SEGMENTS_PER_MESSAGE = '2'
  delete process.env.SMS_LINK_BASE
})

afterEach(() => {
  resetQuoForTests()
  delete process.env.QUO_API_KEY
  delete process.env.QUO_FROM_NUMBER
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.SMS_DAILY_SEGMENT_CAP
  delete process.env.SMS_PER_RECIPIENT_DAILY_CAP
  delete process.env.SMS_MAX_SEGMENTS_PER_MESSAGE
  delete process.env.SMS_LINK_BASE
  process.env.ASSISTANT_DEMO_MODE = 'true'
  vi.unstubAllGlobals()
})

describe('SMS segment calculator', () => {
  it('counts GSM-7 septets, extension pairs, and UCS-2 units', () => {
    expect(countSmsSegments(gsm(160))).toEqual({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(countSmsSegments(gsm(161)).segments).toBe(2)
    expect(countSmsSegments(gsm(306)).segments).toBe(2)
    expect(countSmsSegments(gsm(307)).segments).toBe(3)
    expect(countSmsSegments('[').units).toBe(2)
    expect(countSmsSegments(`${gsm(159)}[`).segments).toBe(2)
    expect(countSmsSegments('Price is 10 {ok} \u20AC').units).toBe(21)
    expect(countSmsSegments('\n'.repeat(161)).segments).toBe(2)
    expect(countSmsSegments('é'.repeat(160))).toMatchObject({ encoding: 'gsm7', segments: 1 })
    expect(countSmsSegments('\uD83D\uDE00'.repeat(36))).toMatchObject({ encoding: 'ucs2', units: 72, segments: 2 })
    expect(countSmsSegments(`hi ${'\uD83D\uDE00'}`)).toMatchObject({ encoding: 'ucs2', units: 5, segments: 1 })
    expect(dailyLimitNotice(60).length).toBeLessThanOrEqual(160)
    expect(countSmsSegments(dailyLimitNotice(60)).segments).toBe(1)
  })

  it('keeps the opening line and the link inside two segments', () => {
    const link = 'thriving-faloodeh-857600.netlify.app/p/7'
    const fitted = fitSms(['Alpha', '', 'Beta', gsm(400), link].join('\n'), 2, 'fub')
    expect(countSmsSegments(fitted).segments).toBeLessThanOrEqual(2)
    expect(fitted.startsWith('Alpha')).toBe(true)
    expect(fitted).toContain(link)
    expect(fitted.split(link).length - 1).toBe(1)
    expect(fitted).toMatch(/\+\d+ more in FUB$/)
    expect(fitted).not.toContain('\n\n')
    expect(collapseSms('a  b\n\n\nc')).toBe('a b\nc')
    expect(fitSms('Hello team', 2, 'hub')).toBe('Hello team')
    const hub = fitSms(gsm(400), 2, 'hub')
    expect(hub.endsWith('See Hub')).toBe(true)
    expect(countSmsSegments(hub).segments).toBeLessThanOrEqual(2)
  })
})

describe('SMS budget', () => {
  function posts() {
    const sent: { to?: string[]; content?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as { to?: string[]; content?: string })
      return new Response(JSON.stringify({ data: { id: `sms-${sent.length}` } }), { status: 200 })
    }))
    return sent
  }

  it('truncates an automatic text and leaves an explicit client text whole', async () => {
    const sent = posts()
    const link = 'thriving-faloodeh-857600.netlify.app/p/7'
    const truncated = await sendSms({ to: '+15555550111', content: `${gsm(400)}\n${link}`, priority: 'normal', now })
    expect(truncated).toEqual({ id: 'sms-1' })
    expect(sent[0]?.content).toContain(link)
    expect(sent[0]?.content).toMatch(/more in FUB/)
    expect(countSmsSegments(sent[0]?.content ?? '').segments).toBeLessThanOrEqual(2)

    const body = gsm(400)
    const exempt = await sendSms({ to: '+15555550112', content: body, priority: 'high', truncate: 'exempt', now })
    expect(exempt).toEqual({ id: 'sms-2' })
    expect(sent[1]?.content).toBe(body)
  })

  it('stops normal texts at 80 percent and lets high texts use the reserve', async () => {
    const sent = posts()
    const four = gsm(153 * 4)
    const first = await sendSms({ to: '+15555550111', content: four, priority: 'normal', truncate: 'exempt', now })
    const second = await sendSms({ to: '+15555550111', content: four, priority: 'normal', truncate: 'exempt', now })
    const blocked = await sendSms({ to: '+15555550111', content: 'x', priority: 'normal', now })
    const high = await sendSms({ to: '+15555550112', content: gsm(153 * 2), priority: 'high', truncate: 'exempt', now })
    const over = await sendSms({ to: '+15555550113', content: 'x', priority: 'high', now })
    const again = await sendSms({ to: '+15555550114', content: 'x', priority: 'high', now })
    expect(first).toEqual({ id: 'sms-1' })
    expect(second).toEqual({ id: 'sms-2' })
    expect(blocked).toEqual({ skipped: 'budget' })
    expect(high).toEqual({ id: 'sms-3' })
    expect(over).toEqual({ skipped: 'budget' })
    expect(again).toEqual({ skipped: 'budget' })
    const notices = sent.filter((item) => item.to?.[0] === joe)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.content).toBe(dailyLimitNotice(10))
    expect(sent.filter((item) => item.content === 'x')).toHaveLength(0)
  })

  it('enforces the per-recipient cap without announcing the daily limit', async () => {
    process.env.SMS_PER_RECIPIENT_DAILY_CAP = '5'
    process.env.SMS_DAILY_SEGMENT_CAP = '60'
    const sent = posts()
    const four = gsm(153 * 4)
    expect(await sendSms({ to: '+15555550111', content: four, priority: 'high', truncate: 'exempt', now })).toEqual({ id: 'sms-1' })
    expect(await sendSms({ to: '+15555550111', content: four, priority: 'high', truncate: 'exempt', now })).toEqual({ skipped: 'budget' })
    expect(await sendSms({ to: '+15555550112', content: 'x', priority: 'high', now })).toEqual({ id: 'sms-2' })
    expect(sent.some((item) => item.to?.[0] === joe)).toBe(false)
  })

  it('counts parallel sends without going over the cap', async () => {
    const sent = posts()
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => sendSms({
      to: `+1555555${String(index).padStart(4, '0')}`,
      content: 'hi',
      priority: 'high',
      now,
    })))
    const allowed = results.filter((result) => 'id' in result)
    expect(allowed).toHaveLength(10)
    expect(sent.filter((item) => item.content === 'hi')).toHaveLength(10)
    expect(sent.filter((item) => item.to?.[0] === joe)).toHaveLength(1)
    const usage = await getSmsUsage(now)
    expect(usage.used).toBe(11)
    expect(usage.cap).toBe(10)
    expect(usage.noticeSent).toBe(true)
  })

  it('retries a lost compare-and-swap and fails closed when the blob is down', async () => {
    blobs.off = false
    const sent = posts()
    blobs.conflictOnce = true
    const once = await sendSms({ to: '+15555550111', content: 'hi', priority: 'high', now })
    expect(once).toEqual({ id: 'sms-1' })
    expect(await getSmsUsage(now)).toMatchObject({ used: 1, noticeSent: false })

    blobs.fail = true
    const blocked = await sendSms({ to: '+15555550112', content: 'hi', priority: 'high', now })
    expect(blocked).toEqual({ skipped: 'budget' })
    expect(sent).toHaveLength(1)
  })

  it('returns a reserved segment when Quo rejects the send', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(sendSms({ to: '+15555550111', content: 'hi', priority: 'high', now })).rejects.toThrow(/500/)
    expect((await getSmsUsage(now)).used).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { id: 'sms-ok' } }), { status: 200 })))
    expect(await sendSms({ to: '+15555550111', content: 'hi', priority: 'high', now })).toEqual({ id: 'sms-ok' })
    expect((await getSmsUsage(now)).used).toBe(1)
  })

  it('uses SMS_LINK_BASE when it is set', () => {
    expect(smsPersonLink(42)).toBe('thriving-faloodeh-857600.netlify.app/p/42')
    process.env.SMS_LINK_BASE = 'https://lp.example/'
    expect(smsPersonLink(42)).toBe('lp.example/p/42')
    expect(smsPersonLink(0)).toBe('')
  })
})
