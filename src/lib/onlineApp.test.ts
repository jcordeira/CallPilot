import { afterEach, describe, expect, it } from 'vitest'
import { gmailCanRead, GOOGLE_SCOPES } from '../../netlify/functions/_shared/googleAuth'
import { matchApplicant, onlineAppTagEnabled, parseOnlineApplication, runOnlineApplications, type GmailMessage } from '../../netlify/functions/_shared/onlineApp'
import { claimOnlineApp, loadOnlineAppState, resetOnlineAppStateForTests } from '../../netlify/functions/_shared/onlineAppStore'

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

  it('reads an Encompass application that has an email and no phone', () => {
    const body = [
      'Dear Joseph Cordeira,',
      'A loan application has been submitted successfully.',
      "Primary Borrower's Name: Zheng Zhuang",
      "Primary Borrower's Email: zhengzhuang8@icloud.com",
      'Property is Located in: Bayside NY 11361',
    ].join('\n\r\n')
    const parsed = parseOnlineApplication('New application submitted successfully for: Zheng Zhuang', body)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.application).toMatchObject({
      name: 'Zheng Zhuang',
      firstName: 'Zheng',
      lastName: 'Zhuang',
      email: 'zhengzhuang8@icloud.com',
      property: 'Bayside NY 11361',
      city: 'Bayside',
      state: 'NY',
      code: '11361',
    })
    expect(parsed.application.phone).toBeUndefined()
  })

  it('reads a primary borrower phone when that label is present', () => {
    const parsed = parseOnlineApplication(
      'New application submitted successfully for: Ada Buyer',
      "Dear Joseph Cordeira,\n\r\nPrimary Borrower's Name: Ada Buyer\n\r\nPrimary Borrower's Email: ada.buyer@gmail.com\n\r\nPrimary Borrower's Phone: (631) 555-0199",
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
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
    expect(listed.some((query) => query.includes('older_than:2d'))).toBe(true)

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

  it('creates Zheng from the real email with no phone, and retries a stale done claim once', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const now = new Date('2026-11-09T23:00:00.000Z')
    const body = [
      'Dear Joseph Cordeira,',
      'A loan application has been submitted successfully.',
      "Primary Borrower's Name: Zheng Zhuang",
      "Primary Borrower's Email: zhengzhuang8@icloud.com",
      'Property is Located in: Bayside NY 11361',
    ].join('\n\r\n')
    await claimOnlineApp('done/1a1c1487883ca99f')
    const created: Array<{ email?: string; phone?: string; city?: string }> = []
    const summary = await runOnlineApplications({
      now,
      list: async () => [{ id: '1a1c1487883ca99f', internalDate: now.getTime() - 3 * 3_600_000 }],
      read: async (id) => message(id, 'New application submitted successfully for: Zheng Zhuang', body),
      search: async () => [],
      tag: async () => {},
      create: async (application) => {
        created.push({ email: application.email, phone: application.phone, city: application.city })
        return 501
      },
    })
    expect(summary.created).toBe(1)
    expect(summary.zheng).toMatchObject({ action: 'created', personId: 501 })
    expect(created).toEqual([{ email: 'zhengzhuang8@icloud.com', phone: undefined, city: 'Bayside' }])

    const again = await runOnlineApplications({
      now,
      list: async () => [{ id: '1a1c1487883ca99f', internalDate: now.getTime() - 3 * 3_600_000 }],
      read: async (id) => message(id, 'New application submitted successfully for: Zheng Zhuang', body),
      search: async () => [{ id: 501, name: 'Zheng Zhuang' }],
      tag: async () => {},
      create: async () => 999,
    })
    expect(again.already).toBe(1)
    expect(again.created).toBe(0)
  })

  it('releases the claim when several names match and nobody is created', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const now = new Date('2026-11-09T23:00:00.000Z')
    const run = () => runOnlineApplications({
      now,
      list: async () => [{ id: 'ada', internalDate: now.getTime() - 3_600_000 }],
      read: async (id) => message(id, 'New application submitted successfully for: Ada Buyer', 'Dear Joseph Cordeira, A loan application was submitted. Contact ada.buyer@gmail.com or 631-555-0199.'),
      search: async (query) => (query.startsWith('name=') ? [{ id: 1, name: 'Ada Buyer' }, { id: 2, name: 'Ada Buyer' }] : []),
      tag: async () => {},
      create: async () => 1,
    })
    const first = await run()
    expect(first.created).toBe(0)
    expect(first.ambiguous).toBe(1)
    const second = await run()
    expect(second.already).toBe(0)
    expect(second.considered).toBe(1)
  })

  it('records a missing Gmail scope instead of dropping the run', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const summary = await runOnlineApplications({
      list: async () => {
        throw new Error('Gmail read scope missing')
      },
    })
    expect(summary.skipped).toBe('scope')
    expect(summary.created).toBe(0)
    const saved = await loadOnlineAppState()
    expect((saved.last as { skipped?: string } | undefined)?.skipped).toBe('scope')
  })

  it('asks for gmail.readonly and leaves backfill off the schedule', () => {
    expect(gmailCanRead(GOOGLE_SCOPES)).toBe(true)
    expect(gmailCanRead('openid https://www.googleapis.com/auth/gmail.send')).toBe(false)
    expect(onlineAppTagEnabled()).toBe(true)
  })
})
