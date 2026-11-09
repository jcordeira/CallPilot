import { afterEach, describe, expect, it } from 'vitest'
import { gmailCanRead, GOOGLE_SCOPES } from '../../netlify/functions/_shared/googleAuth'
import { matchApplicant, onlineAppTagEnabled, parseOnlineApplication, runOnlineApplications, type GmailMessage } from '../../netlify/functions/_shared/onlineApp'
import { resetOnlineAppStateForTests } from '../../netlify/functions/_shared/onlineAppStore'

const zhengBody = `
Dear Joseph Cordeira,

A loan application has been submitted successfully for your review.

Applicant Name: Zheng Zhuang
Email: zheng.zhuang@example.com
Phone: (516) 555-0142
`.trim()

function message(id: string, subject: string, body: string): GmailMessage {
  return {
    id,
    payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'Subject', value: subject }],
      body: { data: Buffer.from(body).toString('base64url') },
    },
  }
}

afterEach(() => {
  resetOnlineAppStateForTests()
  delete process.env.ONLINE_APP_TAG_ENABLED
  delete process.env.ASSISTANT_DEMO_MODE
  delete process.env.FOLLOW_UP_BOSS_API_KEY
})

describe('online application parser', () => {
  it('reads the applicant from the subject and labeled body fields', () => {
    const parsed = parseOnlineApplication('New application submitted successfully for: Zheng Zhuang', zhengBody)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.application).toMatchObject({
      name: 'Zheng Zhuang',
      firstName: 'Zheng',
      lastName: 'Zhuang',
      email: 'zheng.zhuang@example.com',
      phone: '+15165550142',
    })
  })

  it('uses the only non-team email and phone when the body has no labels', () => {
    const parsed = parseOnlineApplication(
      'New application submitted successfully for: Ada Buyer',
      'Dear Joseph Cordeira, A loan application was submitted. Contact ada.buyer@gmail.com or 631-555-0199. jcordeira@cliffcomortgage.com is the office.',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.application.email).toBe('ada.buyer@gmail.com')
    expect(parsed.application.phone).toBe('+16315550199')
  })

  it('does not guess when the body has several emails', () => {
    const parsed = parseOnlineApplication(
      'New application submitted successfully for: Ada Buyer',
      'Dear Joseph Cordeira, A loan application was submitted. ada@gmail.com and other@gmail.com',
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toMatch(/ambiguous emails/)
    expect(parsed.skeleton).not.toContain('ada@gmail.com')
  })
})

describe('online application matching', () => {
  it('prefers email, then phone, then a single exact name', async () => {
    const email = await matchApplicant(
      { name: 'Zheng Zhuang', firstName: 'Zheng', lastName: 'Zhuang', email: 'zheng.zhuang@example.com', phone: '+15165550142' },
      async (query) => (query.startsWith('email=') ? [{ id: 9, name: 'Zheng Zhuang' }] : [{ id: 10, name: 'Someone Else' }]),
    )
    expect(email).toMatchObject({ person: { id: 9 }, note: 'email', ambiguous: false })

    const phone = await matchApplicant(
      { name: 'Zheng Zhuang', firstName: 'Zheng', lastName: 'Zhuang', phone: '+15165550142' },
      async (query) => (query.startsWith('phone=') ? [{ id: 11, name: 'Zheng' }] : []),
    )
    expect(phone.person?.id).toBe(11)

    const named = await matchApplicant(
      { name: 'Zheng Zhuang', firstName: 'Zheng', lastName: 'Zhuang' },
      async () => [{ id: 12, name: 'Zheng Zhuang' }, { id: 13, name: 'Zheng Other' }],
    )
    expect(named).toMatchObject({ person: { id: 12 }, note: 'exact name' })

    const many = await matchApplicant(
      { name: 'Zheng Zhuang', firstName: 'Zheng', lastName: 'Zhuang' },
      async () => [{ id: 12, name: 'Zheng Zhuang' }, { id: 14, name: 'Zheng Zhuang' }],
    )
    expect(many.person).toBeNull()
    expect(many.ambiguous).toBe(true)
  })

  it('processes recent mail, claims older mail without tagging, and can backfill later', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const now = new Date('2026-11-09T23:00:00.000Z')
    const listed: string[] = []
    const tags: number[] = []
    const created: string[] = []
    const summary = await runOnlineApplications({
      now,
      list: async (query) => {
        listed.push(query)
        return [
          { id: 'old', internalDate: now.getTime() - 10 * 86_400_000 },
          { id: 'zheng', internalDate: now.getTime() - 3 * 3_600_000 },
        ]
      },
      read: async (id) => message(id, 'New application submitted successfully for: Zheng Zhuang', zhengBody),
      search: async () => [],
      tag: async (personId) => { tags.push(personId) },
      create: async (application) => {
        created.push(application.name)
        return 77
      },
    })
    expect(summary.seededOld).toBe(1)
    expect(summary.created).toBe(1)
    expect(summary.tagged).toBe(0)
    expect(created).toEqual(['Zheng Zhuang'])
    expect(summary.zheng).toMatchObject({ action: 'created', personId: 77 })
    expect(listed.some((query) => query.includes('newer_than:2d'))).toBe(true)
    expect(listed.some((query) => !query.includes('newer_than'))).toBe(true)

    const again = await runOnlineApplications({
      now,
      list: async () => [{ id: 'zheng', internalDate: now.getTime() - 3 * 3_600_000 }],
      read: async (id) => message(id, 'New application submitted successfully for: Zheng Zhuang', zhengBody),
      search: async () => [{ id: 77, name: 'Zheng Zhuang' }],
      tag: async (personId) => { tags.push(personId) },
      create: async () => 88,
    })
    expect(again.already).toBe(1)
    expect(again.created).toBe(0)
    expect(tags).toEqual([])
  })

  it('asks for gmail.readonly and leaves backfill off the schedule', () => {
    expect(gmailCanRead(GOOGLE_SCOPES)).toBe(true)
    expect(gmailCanRead('openid https://www.googleapis.com/auth/gmail.send')).toBe(false)
    expect(onlineAppTagEnabled()).toBe(true)
  })
})
