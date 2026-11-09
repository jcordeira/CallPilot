import { afterEach, describe, expect, it } from 'vitest'
import {
  FRANKIE_ATTENDEE_EMAIL,
  JOE_ATTENDEE_EMAIL,
  attendeeAutoaddEnabled,
  clientContacts,
  frankieCall,
  isPingtreeDscr,
  resetCalendarAttendeeAutoaddForTests,
  runCalendarAttendeeAutoadd,
  skipReason,
  type AutoEvent,
  type SourcePerson,
} from '../../netlify/functions/_shared/calendarAttendeeAutoadd'

const joe = JOE_ATTENDEE_EMAIL
const frankie = FRANKIE_ATTENDEE_EMAIL
const joeEmails = new Set([joe, 'joseph@teamcordeira.com'])

function event(partial: Partial<AutoEvent> & { summary: string }): AutoEvent {
  return {
    id: partial.id ?? partial.summary,
    summary: partial.summary,
    description: partial.description,
    location: partial.location,
    startIso: partial.startIso ?? '2026-11-04T15:00:00.000Z',
    endIso: '2026-11-04T15:30:00.000Z',
    allDay: partial.allDay ?? false,
    status: partial.status,
    organizer: partial.organizer ?? { email: 'joseph@teamcordeira.com', self: true },
    attendees: partial.attendees ?? [{ email: 'client@example.com', responseStatus: 'accepted' }],
    quickTask: partial.quickTask,
  }
}

const dscr: SourcePerson = { id: 9, source: 'Pingtree DSCR Form', tags: ['Buyer'] }
const zillow: SourcePerson = { id: 4, source: 'Zillow', tags: ['DSCR loan'] }

afterEach(async () => {
  await resetCalendarAttendeeAutoaddForTests()
  delete process.env.CALENDAR_ATTENDEE_AUTOADD_ENABLED
})

describe('Pingtree DSCR match', () => {
  it('matches source, tags, and lead-flow source, and ignores a plain DSCR tag', () => {
    expect(isPingtreeDscr(dscr)).toBe(true)
    expect(isPingtreeDscr({ id: 1, tags: ['pingtree dscr'] })).toBe(true)
    expect(isPingtreeDscr({ id: 1, leadFlowSources: ['Pingtree-DSCR form'] })).toBe(true)
    expect(isPingtreeDscr(zillow)).toBe(false)
    expect(isPingtreeDscr({ id: 1, source: 'Pingtree' })).toBe(false)
  })

  it('adds Frankie for a DSCR lead and when the match is unsure, and omits her only when one lead is confirmed not', () => {
    expect(frankieCall({ contactCount: 1, people: [dscr], failed: false })).toEqual({ call: 'add', reason: 'Pingtree DSCR lead' })
    expect(frankieCall({ contactCount: 0, people: [], failed: false })).toEqual({ call: 'add', reason: 'no contact info' })
    expect(frankieCall({ contactCount: 1, people: [], failed: false })).toEqual({ call: 'add', reason: 'no FUB match' })
    expect(frankieCall({ contactCount: 1, people: [dscr, zillow], failed: false })).toEqual({ call: 'add', reason: 'several FUB matches' })
    expect(frankieCall({ contactCount: 1, people: [], failed: true })).toEqual({ call: 'add', reason: 'lookup failed' })
    expect(frankieCall({ contactCount: 1, people: [zillow], failed: false })).toEqual({ call: 'omit', reason: 'confirmed not Pingtree DSCR' })
  })
})

describe('calendar attendee auto-add', () => {
  it('keeps existing guests, adds Joe to every timed event he organized, and adds Frankie only for the DSCR case', async () => {
    const patches: { id: string; emails: string[]; sendUpdates: string }[] = []
    const looked: string[][] = []
    const summary = await runCalendarAttendeeAutoadd({
      events: [
        event({ id: 'dscr', summary: 'Call Alex', attendees: [{ email: 'alex@example.com', responseStatus: 'needsAction' }] }),
        event({
          id: 'other',
          summary: 'Call Jordan',
          description: 'Reach Jordan at 516-555-0199',
          attendees: [{ email: joe, responseStatus: 'accepted' }, { email: 'jordan@example.com', responseStatus: 'accepted' }],
        }),
        event({ id: 'day', summary: 'Vacation', allDay: true, attendees: [] }),
        event({
          id: 'declined',
          summary: 'Call Sam',
          attendees: [{ email: 'joseph@teamcordeira.com', self: true, responseStatus: 'declined' }],
        }),
        event({
          id: 'invite',
          summary: 'Team stand-up',
          organizer: { email: 'debbecke@cliffcomortgage.com', self: false },
          attendees: [{ email: 'joseph@teamcordeira.com', self: true, responseStatus: 'accepted' }],
        }),
        event({
          id: 'ready',
          summary: 'Already set',
          attendees: [
            { email: joe, responseStatus: 'accepted' },
            { email: frankie, responseStatus: 'needsAction' },
            { email: 'ada@example.com', responseStatus: 'accepted' },
          ],
        }),
      ],
      lookup: async (contacts) => {
        looked.push([...contacts.emails, ...contacts.phones])
        if (contacts.emails.includes('alex@example.com')) return { people: [dscr], failed: false }
        if (contacts.phones.includes('5165550199')) return { people: [zillow], failed: false }
        if (contacts.emails.includes('ada@example.com')) return { people: [zillow], failed: false }
        return { people: [], failed: false }
      },
      patch: async (input) => {
        patches.push({
          id: input.event.id,
          emails: input.attendees.map((attendee) => attendee.email),
          sendUpdates: 'none',
        })
      },
    })

    expect(patches).toEqual([
      { id: 'dscr', emails: ['alex@example.com', joe, frankie], sendUpdates: 'none' },
    ])
    expect(summary.addedJoe).toBe(1)
    expect(summary.addedFrankie).toBe(1)
    expect(summary.patched).toBe(1)
    expect(summary.backfill).toBe(true)
    expect(summary.skippedByReason).toEqual({ 'all-day': 1, 'Joe declined': 1, 'not organized by Joe': 1, 'already set': 2 })
    expect(summary.frankieByReason['Pingtree DSCR lead']).toBe(1)
    expect(summary.frankieByReason['confirmed not Pingtree DSCR']).toBe(2)
    expect(summary.sourcesSeen).toEqual(['Buyer', 'DSCR loan', 'Pingtree DSCR Form', 'Zillow'])
    expect(summary.sourcesMatched).toEqual(['Pingtree DSCR Form'])
    expect(looked.some((row) => row.includes(frankie) || row.includes('5169969070'))).toBe(false)
    expect(skipReason(event({ summary: 'Day off', allDay: true }), joeEmails)).toBe('all-day')
  })

  it('adds Frankie when there is no contact info, no match, or several matches, and does not email', async () => {
    const patches: string[][] = []
    const summary = await runCalendarAttendeeAutoadd({
      events: [
        event({ id: 'blank', summary: 'Hold', attendees: [] }),
        event({ id: 'miss', summary: 'Call Pat', attendees: [{ email: 'pat@example.com', responseStatus: 'accepted' }] }),
        event({ id: 'many', summary: 'Call Two', attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }] }),
      ],
      lookup: async (contacts) => {
        if (contacts.emails.includes('pat@example.com')) return { people: [], failed: false }
        if (contacts.emails.length > 1) return { people: [dscr, zillow], failed: false }
        return { people: [], failed: false }
      },
      patch: async (input) => {
        patches.push(input.attendees.map((attendee) => attendee.email))
      },
    })
    expect(patches).toEqual([
      [joe, frankie],
      ['pat@example.com', joe, frankie],
      ['a@example.com', 'b@example.com', joe, frankie],
    ])
    expect(summary.addedFrankie).toBe(3)
    expect(summary.frankieByReason).toMatchObject({
      'no contact info': 1,
      'no FUB match': 1,
      'several FUB matches': 1,
    })
  })

  it('is idempotent and stays off when the kill switch is false', async () => {
    let calls = 0
    const events = [event({ id: 'once', summary: 'Call Alex', attendees: [{ email: 'alex@example.com' }] })]
    const lookup = async () => ({ people: [dscr], failed: false })
    const patch = async () => {
      calls += 1
      events[0].attendees = [
        { email: 'alex@example.com' },
        { email: joe },
        { email: frankie },
      ]
    }
    const first = await runCalendarAttendeeAutoadd({ events, lookup, patch })
    const second = await runCalendarAttendeeAutoadd({ events, lookup, patch })
    expect(first.patched).toBe(1)
    expect(second.patched).toBe(0)
    expect(second.skippedByReason['already set']).toBe(1)
    expect(second.backfill).toBe(false)
    expect(calls).toBe(1)

    process.env.CALENDAR_ATTENDEE_AUTOADD_ENABLED = 'false'
    expect(attendeeAutoaddEnabled()).toBe(false)
    const off = await runCalendarAttendeeAutoadd({ events, lookup, patch })
    expect(off.skipped).toBe('disabled')
    expect(calls).toBe(1)
    delete process.env.CALENDAR_ATTENDEE_AUTOADD_ENABLED
    expect(attendeeAutoaddEnabled()).toBe(true)
  })

  it('adds Joe to a Hub quick-add event and removes only Frankie', async () => {
    const patches: { emails: string[]; tag?: boolean }[] = []
    let lookups = 0
    const summary = await runCalendarAttendeeAutoadd({
      events: [
        event({
          id: 'tagged',
          summary: 'Send checklist',
          quickTask: true,
          attendees: [
            { email: 'alex@example.com', responseStatus: 'accepted' },
            { email: frankie, responseStatus: 'needsAction' },
          ],
        }),
        event({
          id: 'legacy',
          summary: 'Call lender',
          description: 'Bring the file\nLoanPilot task gt-9\n15 minutes',
          attendees: [
            { email: joe, responseStatus: 'accepted' },
            { email: frankie, responseStatus: 'accepted' },
            { email: 'alex@example.com', responseStatus: 'accepted' },
          ],
        }),
        event({
          id: 'done',
          summary: 'Already clean',
          quickTask: true,
          attendees: [{ email: joe }, { email: 'alex@example.com' }],
        }),
      ],
      lookup: async () => {
        lookups += 1
        return { people: [dscr], failed: false }
      },
      patch: async (input) => {
        patches.push({ emails: input.attendees.map((attendee) => attendee.email), tag: input.tagQuickTask })
      },
    })
    expect(lookups).toBe(0)
    expect(patches).toEqual([
      { emails: ['alex@example.com', joe], tag: true },
      { emails: [joe, 'alex@example.com'], tag: true },
    ])
    expect(summary.addedJoe).toBe(1)
    expect(summary.addedFrankie).toBe(0)
    expect(summary.removedFrankie).toBe(2)
    expect(summary.skippedByReason['already set']).toBe(1)
  })

  it('reads a client email or phone from the title, description, or location and ignores team addresses', () => {
    const contacts = clientContacts(
      event({
        summary: 'Call alex.buyer@gmail.com',
        description: 'Frankie fcordeirajr@cliffcomortgage.com will not be the client. Cell (516) 555-0100.',
        location: 'joseph@teamcordeira.com',
        attendees: [{ email: joe }, { email: 'guest@example.com' }],
      }),
      new Set([joe, frankie, 'joseph@teamcordeira.com']),
      new Set(['5169969070']),
    )
    expect(contacts.emails.sort()).toEqual(['alex.buyer@gmail.com', 'guest@example.com'])
    expect(contacts.phones).toEqual(['5165550100'])
  })
})
