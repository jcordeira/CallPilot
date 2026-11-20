import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FRANKIE_EMAIL_TO,
  buildFrankieDailyEmail,
  frankieEmailSubject,
  isFrankieEmailHour,
} from '../../netlify/functions/_shared/frankieDailyEmail'
import { runFrankieDailyEmail } from '../../netlify/functions/_shared/frankieDailyEmailRun'
import type { FrankieBoard, FrankieRow } from '../../netlify/functions/_shared/frankieToday'

const fridayMorning = new Date('2026-11-20T13:00:00.000Z')
const fridaySeven = new Date('2026-11-20T12:00:00.000Z')
const saturdayMorning = new Date('2026-11-21T13:00:00.000Z')

function row(id: number, sectionId: FrankieRow['sectionId'], name: string): FrankieRow {
  return {
    id,
    name,
    sectionId,
    reason: sectionId === 'uncalled' ? 'Uncalled new lead' : 'Realtor Referrals',
    tags: [],
    daysSinceTouch: id === 1 ? null : id,
    missedYesterday: false,
    source: 'Website',
    assignedTo: 'Frankie Cordeira',
  }
}

function board(people: FrankieRow[], sections: FrankieBoard['sections']): FrankieBoard {
  return {
    updatedAt: fridayMorning.toISOString(),
    todayKey: '2026-11-20',
    totalDue: people.length,
    cap: 30,
    sections,
    people,
    warnings: [],
  }
}

afterEach(() => {
  delete process.env.FRANKIE_DAILY_EMAIL_ENABLED
  vi.restoreAllMocks()
})

describe('Frankie daily email', () => {
  it('builds a weekday subject, the top 30, and the counts still due', () => {
    const people = [
      row(1, 'uncalled', 'Domenick DeCaro'),
      row(2, 'uncalled', 'Ada Buyer'),
      ...Array.from({ length: 29 }, (_, index) => row(100 + index, 'realtor', `Realtor ${index + 1}`)),
    ]
    const email = buildFrankieDailyEmail(
      board(people, [
        { id: 'uncalled', label: 'Uncalled new leads', total: 2 },
        { id: 'realtor', label: 'Realtor Referrals', total: 29 },
      ]),
      fridayMorning,
    )
    expect(email.subject).toBe('Your follow-ups for Fri, Nov 20')
    expect(email.to).toBe(FRANKIE_EMAIL_TO)
    expect(email.from).toContain('joseph@teamcordeira.com')
    expect(email.html).toContain('https://teamcordeira.followupboss.com/2/people/view/1')
    expect(email.html).toContain('Domenick DeCaro')
    expect(email.html).toContain('Never touched')
    expect(email.html).toContain('Website')
    expect(email.html).not.toContain('Realtor 29')
    expect(email.html).toContain('More due')
    expect(email.html).toContain('Realtor Referrals: 1')
    expect(email.text).toContain('https://teamcordeira.followupboss.com/2/people/view/1')
    expect(email.text).toContain('Uncalled new leads: 2')
    expect(frankieEmailSubject(fridayMorning)).toBe(email.subject)
  })

  it('sends once on a weekday at 8 AM Eastern and skips weekends, early hours, and a second run', async () => {
    const claimed = new Set<string>()
    let html = ''
    const load = vi.fn(async () => board([row(1, 'uncalled', 'Domenick DeCaro')], [
      { id: 'uncalled', label: 'Uncalled new leads', total: 1 },
    ]))
    const send = vi.fn(async (email: { html: string }) => {
      html = email.html
      return { id: 'msg-1' }
    })
    const claim = vi.fn(async (day: string) => {
      if (claimed.has(day)) return false
      claimed.add(day)
      return true
    })
    const options = { load, send, claim, sent: async (day: string) => claimed.has(day) }
    expect(isFrankieEmailHour(saturdayMorning)).toBe(false)
    expect((await runFrankieDailyEmail({ ...options, now: saturdayMorning })).reason).toBe('weekend')
    expect((await runFrankieDailyEmail({ ...options, now: fridaySeven })).reason).toBe('before-8')
    const first = await runFrankieDailyEmail({ ...options, now: fridayMorning })
    const second = await runFrankieDailyEmail({ ...options, now: fridayMorning })
    expect(first).toMatchObject({ sent: true, id: 'msg-1', to: 'fcordeirajr@cliffcomortgage.com' })
    expect(second.reason).toBe('already-sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(html).toContain('Domenick DeCaro')
  })

  it('does not send when the kill switch is off, and releases the day if Gmail fails', async () => {
    process.env.FRANKIE_DAILY_EMAIL_ENABLED = 'false'
    const send = vi.fn(async () => ({ id: 'nope' }))
    const skipped = await runFrankieDailyEmail({
      now: fridayMorning,
      send,
      load: vi.fn(),
      claim: vi.fn(async () => true),
    })
    expect(skipped.reason).toBe('disabled')
    expect(send).not.toHaveBeenCalled()

    delete process.env.FRANKIE_DAILY_EMAIL_ENABLED
    const claimed = new Set<string>()
    const release = vi.fn(async (day: string) => {
      claimed.delete(day)
    })
    const failing = vi.fn(async () => {
      throw new Error('Gmail send failed')
    })
    const failed = await runFrankieDailyEmail({
      now: fridayMorning,
      send: failing,
      load: async () => board([], []),
      claim: async (day: string) => {
        claimed.add(day)
        return true
      },
      release,
      sent: async () => false,
    })
    expect(failed.sent).toBe(false)
    expect(failed.reason).toBe('Gmail send failed')
    expect(release).toHaveBeenCalledWith('2026-11-20')
  })
})
