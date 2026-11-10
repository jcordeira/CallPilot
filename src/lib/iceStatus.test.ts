import { afterEach, describe, expect, it } from 'vitest'
import { classifyIceEvent, forwardStage, ICE_CUTOFF_MS, matchIceBorrower, parseIceStatus, runIceStatus } from '../../netlify/functions/_shared/iceStatus'
import { resetIceStatusForTests } from '../../netlify/functions/_shared/iceStatusStore'

const cutoff = ICE_CUTOFF_MS + 60_000

function iceBody(fields: { borrower: string; loan?: string; event: string; email?: string; detail?: string }): string {
  return [
    '---------- Forwarded message ---------',
    'From: noreply-MortgageTech@ice.com',
    'Subject: Milestone Update',
    `Borrower Name: ${fields.borrower}`,
    fields.email ? `Borrower Email: ${fields.email}` : '',
    `Loan Number: ${fields.loan ?? '1102609CMB01234'}`,
    `Milestone: ${fields.event}`,
    fields.detail ? `Closing Date: ${fields.detail}` : '',
  ].filter(Boolean).join('\n')
}

afterEach(() => {
  resetIceStatusForTests()
  delete process.env.ICE_STATUS_ENABLED
  delete process.env.ASSISTANT_DEMO_MODE
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.FUB_LO_USER_ID
})

describe('ICE status parser', () => {
  it('reads a forwarded CMB milestone and skips eConsent, docs, and non-CMB loans', () => {
    const parsed = parseIceStatus('Fwd: Milestone', iceBody({ borrower: 'Ada Buyer', event: 'Clear to Close', email: 'ada@buyer.com', detail: '11/20/2026' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.ice).toMatchObject({ borrower: 'Ada Buyer', loan: '1102609CMB01234', email: 'ada@buyer.com', detail: '11/20/2026' })
    expect(classifyIceEvent(parsed.ice.eventText)).toMatchObject({ action: 'note', type: 'clear-to-close', stageId: 25 })

    expect(classifyIceEvent('eConsent').action).toBe('skip')
    expect(classifyIceEvent('eFolder Doc Retrieved').action).toBe('skip')
    expect(classifyIceEvent('Doc Request viewed').action).toBe('skip')
    expect(classifyIceEvent('Doc Received').action).toBe('skip')
    expect(classifyIceEvent('package not viewed').action).toBe('skip')
    expect(classifyIceEvent('Password Reset').action).toBe('skip')
    expect(parseIceStatus('Fwd', 'From: noreply-MortgageTech@ice.com\nLoan Number: 998877\nBorrower Name: Ada Buyer\nMilestone: Funded').ok).toBe(false)
    const flipped = parseIceStatus('Fwd', 'From: noreply-MortgageTech@ice.com\nBorrower: Buyer, Ada\nLoan Number: 1102609CMB01234\nMilestone: Appraisal Scheduled')
    expect(flipped.ok).toBe(true)
    if (flipped.ok) expect(flipped.ice.borrower).toBe('Ada Buyer')
  })

  it('maps commitment, clear to close, and funded forward only', () => {
    const stages = [{ id: 10 }, { id: 24 }, { id: 25 }, { id: 129 }]
    expect(classifyIceEvent('Commitment Letter').stageId).toBe(24)
    expect(classifyIceEvent('UW Approved').stageId).toBe(24)
    expect(classifyIceEvent('Funded').stageId).toBe(129)
    expect(forwardStage(10, 24, stages)).toBe('move')
    expect(forwardStage(25, 24, stages)).toBe('hold')
    expect(forwardStage(25, 25, stages)).toBe('hold')
    expect(forwardStage(99, 25, stages)).toBe('unknown')
  })
})

describe('ICE status run', () => {
  it('notes collaborators except Joe, moves a Purchase deal, and does not repeat the event', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    process.env.FUB_LO_USER_ID = '1'
    const notes: { personId: number; body: string; mentionUserIds: number[] }[] = []
    const moves: { dealId: number; stageId: number }[] = []
    const loans: string[] = []
    const run = () => runIceStatus({
      list: async () => [
        { id: 'old', internalDate: ICE_CUTOFF_MS - 60_000 },
        { id: 'ctc', internalDate: cutoff },
        { id: 'copy', internalDate: cutoff + 1000 },
        { id: 'consent', internalDate: cutoff },
      ],
      read: async (id) => ({
        subject: 'Fwd: Milestone',
        body: iceBody({
          borrower: 'Ada Buyer',
          event: id === 'consent' ? 'eConsent' : 'Clear to Close',
        }),
      }),
      search: async () => [{ id: 9, name: 'Ada Buyer' }],
      personName: async () => 'Ada Buyer',
      collaborators: async () => [{ id: 1, name: 'Joseph Cordeira' }, { id: 16, name: 'Frankie Cordeira' }],
      note: async (input) => { notes.push(input) },
      deals: async () => [{ id: 70, pipelineId: 1, stageId: 10, status: 'Active' }],
      stages: async () => [{ id: 10 }, { id: 24 }, { id: 25 }, { id: 129 }],
      move: async (dealId, stageId) => { moves.push({ dealId, stageId }) },
      remember: async (_personId, loan) => { loans.push(loan) },
    })
    const first = await run()
    expect(first.posted).toBe(1)
    expect(first.stageMoved).toBe(1)
    expect(first.skipped).toBe(1)
    expect(first.notes).toEqual([{ personId: 9, name: 'Ada Buyer', event: 'Clear to close', loan: '1102609CMB01234' }])
    expect(moves).toEqual([{ dealId: 70, stageId: 25 }])
    expect(notes[0]?.mentionUserIds).toEqual([16])
    expect(notes[0]?.body).toContain('data-user-id="16"')
    expect(notes[0]?.body).not.toContain('data-user-id="1"')
    expect(loans).toEqual(['1102609CMB01234'])

    const second = await run()
    expect(second.duplicates).toBe(3)
    expect(second.posted).toBe(0)
    expect(notes).toHaveLength(1)
  })

  it('leaves Rajab unmatched and a Canari/Carino email conflict on Needs review', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const notes: number[] = []
    const summary = await runIceStatus({
      list: async () => [
        { id: 'rajab', internalDate: cutoff },
        { id: 'canari', internalDate: cutoff },
      ],
      read: async (id) => ({
        subject: 'Fwd',
        body: id === 'rajab'
          ? iceBody({ borrower: 'Sam Rajab', loan: '1102609CMB10001', event: 'Appraisal Scheduled' })
          : iceBody({ borrower: 'Pat Canari', loan: '1102609CMB10002', event: 'ANL Sent', email: 'pat.canari@example.com' }),
      }),
      search: async (query) => (query.startsWith('email=') ? [{ id: 4, name: 'Pat Carino' }] : []),
      collaborators: async () => [],
      note: async (input) => { notes.push(input.personId) },
      deals: async () => [],
      stages: async () => [],
      move: async () => {},
      remember: async () => {},
    })
    expect(notes).toEqual([])
    expect(summary.needsReview).toBe(2)
    expect(summary.reviews.map((item) => item.reason).sort()).toEqual(['name and email conflict', 'no match'])
    expect(summary.stageMoved).toBe(0)
  })

  it('posts the note and reviews the stage when Purchase deals are missing or duplicated', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const summary = await runIceStatus({
      list: async () => [{ id: 'funded', internalDate: cutoff }],
      read: async () => ({ subject: 'Fwd', body: iceBody({ borrower: 'Ada Buyer', event: 'Funded' }) }),
      search: async () => [{ id: 9, name: 'Ada Buyer' }],
      collaborators: async () => [{ id: 16, name: 'Frankie' }],
      note: async () => {},
      deals: async () => [
        { id: 1, pipelineId: 1, stageId: 10, status: 'Active' },
        { id: 2, pipelineId: 1, stageId: 12, status: 'Active' },
      ],
      stages: async () => [{ id: 10 }, { id: 129 }],
      move: async () => { throw new Error('should not move') },
      remember: async () => {},
    })
    expect(summary.posted).toBe(1)
    expect(summary.stageMoved).toBe(0)
    expect(summary.reviews[0]?.reason).toMatch(/multiple open Purchase deals/)
  })

  it('does not move a deal backward', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub'
    const moves: number[] = []
    const summary = await runIceStatus({
      list: async () => [{ id: 'commit', internalDate: cutoff }],
      read: async () => ({ subject: 'Fwd', body: iceBody({ borrower: 'Ada Buyer', event: 'Commitment Letter' }) }),
      search: async () => [{ id: 9, name: 'Ada Buyer' }],
      collaborators: async () => [],
      note: async () => {},
      deals: async () => [{ id: 3, pipelineId: 1, stageId: 25, status: 'Active' }],
      stages: async () => [{ id: 24, orderWeight: 1 }, { id: 25, orderWeight: 2 }, { id: 129, orderWeight: 3 }],
      move: async (_deal, stageId) => { moves.push(stageId) },
      remember: async () => {},
    })
    expect(summary.posted).toBe(1)
    expect(summary.stageMoved).toBe(0)
    expect(summary.needsReview).toBe(0)
    expect(moves).toEqual([])
  })
})

describe('ICE borrower match', () => {
  it('uses a stored loan number before email or name', async () => {
    const match = await matchIceBorrower(
      { borrower: 'Ada Buyer', loan: '1102609CMB01234', eventText: 'Funded' },
      {
        loanOf: async () => 42,
        search: async () => [{ id: 9, name: 'Someone Else' }],
        personName: async () => 'Ada Buyer',
      },
    )
    expect(match).toMatchObject({ person: { id: 42 }, reason: 'loan number' })
  })
})
