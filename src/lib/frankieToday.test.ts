import { describe, expect, it } from 'vitest'
import {
  calendarExempt,
  etDayKey,
  inFrankieScope,
  isPingtreeSource,
  latestOutbound,
  rankFrankieToday,
  type FrankieCandidate,
} from '../../netlify/functions/_shared/frankieToday'

const now = new Date('2026-11-12T16:00:00.000Z')

function person(partial: Partial<FrankieCandidate> & Pick<FrankieCandidate, 'id' | 'name'>): FrankieCandidate {
  return {
    source: 'Realtor Referral',
    created: '2026-11-12T15:00:00.000Z',
    assignedTo: 'Frankie Cordeira',
    assignedUserId: 16,
    collaboratorIds: [],
    emails: [],
    phones: [],
    listIds: [],
    lastTouch: null,
    ...partial,
  }
}

describe('Frankie Today rules', () => {
  it('excludes Pingtree, calendar matches, and leads older than 3 days', () => {
    const rows = rankFrankieToday(
      [
        person({ id: 1, name: 'New Buyer', source: 'Website', created: '2026-11-12T15:00:00.000Z' }),
        person({ id: 2, name: 'Pingtree Lead', source: 'Pingtree DSCR Form', created: '2026-11-12T15:00:00.000Z' }),
        person({ id: 3, name: 'Booked Buyer', source: 'Website', created: '2026-11-12T14:00:00.000Z', emails: ['booked@example.com'] }),
        person({ id: 4, name: 'Old Lead', source: 'Website', created: '2026-11-08T15:00:00.000Z' }),
        person({ id: 5, name: 'Missed Yesterday', source: 'Website', created: '2026-11-11T15:00:00.000Z' }),
        person({ id: 6, name: 'Already Called', source: 'Website', created: '2026-11-12T12:00:00.000Z', lastTouch: '2026-11-12T18:00:00.000Z' }),
      ],
      [{ summary: 'Call Booked', attendees: [{ email: 'booked@example.com' }] }],
      now,
    )
    const names = rows.people.filter((row) => row.sectionId === 'uncalled').map((row) => row.name)
    expect(names).toEqual(['Missed Yesterday', 'New Buyer'])
    expect(rows.people.find((row) => row.id === 5)?.missedYesterday).toBe(true)
    expect(rows.people.find((row) => row.id === 1)?.missedYesterday).toBe(false)
    expect(isPingtreeSource('Pingtree DSCR Form')).toBe(true)
  })

  it('keeps realtor referrals from the last 6 months until 7 days after a touch', () => {
    const rows = rankFrankieToday(
      [
        person({ id: 1, name: 'Recent Never', created: '2026-08-01T15:00:00.000Z', listIds: [56], lastTouch: null }),
        person({ id: 2, name: 'Recent Warm', created: '2026-08-01T15:00:00.000Z', listIds: [56], lastTouch: '2026-11-08T15:00:00.000Z' }),
        person({ id: 3, name: 'Recent Cold', created: '2026-08-01T15:00:00.000Z', listIds: [56], lastTouch: '2026-11-01T15:00:00.000Z' }),
        person({ id: 4, name: 'Too Old', created: '2026-04-01T15:00:00.000Z', listIds: [56], lastTouch: null }),
      ],
      [],
      now,
    )
    expect(rows.people.map((row) => row.name)).toEqual(['Recent Never', 'Recent Cold'])
  })

  it('counts an outbound text as a touch and ignores incoming calls', () => {
    expect(latestOutbound(
      [{ created: '2026-11-01T15:00:00.000Z', isIncoming: true }],
      [{ created: '2026-11-10T15:00:00.000Z', isIncoming: false }],
    )).toBe('2026-11-10T15:00:00.000Z')
    expect(latestOutbound([{ created: '2026-11-01T15:00:00.000Z', isIncoming: true }], [])).toBeNull()
    const rows = rankFrankieToday(
      [person({ id: 1, name: 'Texted Today', listIds: [1], lastTouch: '2026-11-12T18:00:00.000Z', created: '2026-10-01T15:00:00.000Z' })],
      [],
      now,
    )
    expect(rows.people).toEqual([])
  })

  it('exempts a calendar match by phone or exact name', () => {
    expect(calendarExempt(
      { name: 'Ada Buyer', emails: [], phones: ['(516) 555-0142'] },
      [{ summary: 'Appointment', description: 'Call 516-555-0142' }],
    )).toBe(true)
    expect(calendarExempt(
      { name: 'Ada Buyer', emails: [], phones: [] },
      [{ attendees: [{ displayName: 'Ada Buyer' }] }],
    )).toBe(true)
    expect(calendarExempt(
      { name: 'Ada Buyer', emails: [], phones: [] },
      [{ summary: 'Team meeting' }],
    )).toBe(false)
  })

  it('dedupes a person onto the highest-priority list and keeps the others as tags', () => {
    const rows = rankFrankieToday(
      [person({
        id: 9,
        name: 'Ada Buyer',
        created: '2026-11-12T15:00:00.000Z',
        source: 'Website',
        listIds: [56, 1],
        lastTouch: null,
      })],
      [],
      now,
    )
    expect(rows.people).toHaveLength(1)
    expect(rows.people[0]).toMatchObject({
      sectionId: 'uncalled',
      reason: 'Uncalled new lead',
      tags: ['Realtor Referrals', "Today's Leads"],
    })
  })

  it('applies the doc, pre-approval, and aged cadences', () => {
    const rows = rankFrankieToday(
      [
        person({ id: 1, name: 'Checklist Fresh', listIds: [66], lastTouch: '2026-11-11T15:00:00.000Z', created: '2026-10-01T15:00:00.000Z' }),
        person({ id: 2, name: 'Checklist Due', listIds: [66], lastTouch: '2026-11-09T15:00:00.000Z', created: '2026-10-01T15:00:00.000Z' }),
        person({ id: 3, name: 'Missing Due', listIds: [77], lastTouch: '2026-11-08T15:00:00.000Z', created: '2026-10-01T15:00:00.000Z' }),
        person({ id: 4, name: 'Pre Fresh', listIds: [65], lastTouch: '2026-11-01T15:00:00.000Z', created: '2026-10-01T15:00:00.000Z' }),
        person({ id: 5, name: 'Pre Due', listIds: [65], lastTouch: '2026-10-01T15:00:00.000Z', created: '2026-09-01T15:00:00.000Z' }),
        person({ id: 6, name: 'Aged Active', listIds: [75], lastTouch: '2026-10-01T15:00:00.000Z', lastActivity: '2026-11-01T15:00:00.000Z', created: '2026-06-01T15:00:00.000Z' }),
        person({ id: 7, name: 'Aged Quiet', listIds: [75], lastTouch: '2026-10-20T15:00:00.000Z', lastActivity: '2026-08-01T15:00:00.000Z', created: '2026-06-01T15:00:00.000Z' }),
        person({ id: 8, name: 'Expired Due', listIds: [74], lastTouch: '2026-09-01T15:00:00.000Z', created: '2026-06-01T15:00:00.000Z' }),
        person({ id: 9, name: 'Not Frankie', assignedUserId: 1, collaboratorIds: [], listIds: [1], lastTouch: null, created: '2026-10-01T15:00:00.000Z' }),
        person({ id: 10, name: 'Collaborator', assignedUserId: 1, collaboratorIds: [16], listIds: [3], lastTouch: '2026-11-01T15:00:00.000Z', created: '2026-10-01T15:00:00.000Z' }),
      ],
      [],
      now,
    )
    const names = rows.people.map((row) => row.name)
    expect(names).toEqual(['Collaborator', 'Checklist Due', 'Missing Due', 'Pre Due', 'Aged Active', 'Expired Due'])
    expect(inFrankieScope({ assignedUserId: 1, collaboratorIds: [16] })).toBe(true)
    expect(etDayKey(now)).toBe('2026-11-12')
  })
})
