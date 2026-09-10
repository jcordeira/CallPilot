import { describe, expect, it } from 'vitest'
import { busyFromEvents, dayIsOpen, nextOpenSlot, slotsFor, type AvailabilityRules } from './availability'
import { fmt } from './time'

const rules = (over: Partial<AvailabilityRules> = {}): AvailabilityRules => ({
  workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
  bufferMinutes: 15,
  minNoticeHours: 24,
  maxCallsPerDay: 4,
  breaks: [
    { id: 'lunch', name: 'Lunch', start: 12, end: 13, days: [1, 2, 3, 4, 5], enabled: true },
    { id: 'focus', name: 'Focus block', start: 8, end: 9, days: [1, 3, 5], enabled: true },
    { id: 'wrap', name: 'End-of-week wrap-up', start: 15, end: 17, days: [5], enabled: false },
  ],
  ...over,
})

// A fixed "now" far before the days under test so minimum notice never interferes.
const NOW = new Date('2026-09-01T12:00:00Z')
const TUE = '2026-09-15'
const FRI = '2026-09-18'
const SAT = '2026-09-19'

describe('slotsFor', () => {
  it('steps by duration + buffer (Intro 15 + 15 → every 30 min)', () => {
    const s = slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy: [], now: NOW })
    expect(s.slice(0, 4)).toEqual([9, 9.5, 10, 10.5])
    expect(s.map(fmt)).not.toContain('12:00 PM')
    expect(s.map(fmt)).not.toContain('12:30 PM')
    expect(s.map(fmt)).toContain('1:00 PM')
  })

  it('steps hourly for Strategy (45 + 15)', () => {
    const s = slotsFor({ dateKey: TUE, durationMinutes: 45, rules: rules(), busy: [], now: NOW })
    expect(s).toEqual([9, 10, 11, 13, 14, 15, 16])
  })

  it('steps every 1h45 for Deep Dive (90 + 15) and never runs past 5 PM', () => {
    const s = slotsFor({ dateKey: TUE, durationMinutes: 90, rules: rules(), busy: [], now: NOW })
    // 9:00 ok; 10:45–12:15 hits lunch; 12:30–14:00 hits lunch; 14:15 ok; 16:00 would end 17:30 → dropped
    expect(s).toEqual([9, 14.25])
    for (const h of s) expect(h + 1.5).toBeLessThanOrEqual(17)
  })

  it('applies breaks only on their weekdays', () => {
    const r = rules({ breaks: [{ id: 'w', name: 'wrap', start: 15, end: 17, days: [5], enabled: true }] })
    const tue = slotsFor({ dateKey: TUE, durationMinutes: 45, rules: r, busy: [], now: NOW })
    const fri = slotsFor({ dateKey: FRI, durationMinutes: 45, rules: r, busy: [], now: NOW })
    expect(tue).toContain(15)
    expect(tue).toContain(16)
    expect(fri).not.toContain(15)
    expect(fri).not.toContain(16)
  })

  it('ignores disabled breaks', () => {
    const r = rules({ breaks: [{ id: 'l', name: 'Lunch', start: 12, end: 13, days: [1, 2, 3, 4, 5], enabled: false }] })
    const s = slotsFor({ dateKey: TUE, durationMinutes: 45, rules: r, busy: [], now: NOW })
    expect(s).toContain(12)
  })

  it('blocks busy time plus the trailing buffer', () => {
    const busy = [{ dateKey: TUE, start: 10, end: 11 }]
    const s = slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy, now: NOW })
    // 10:00, 10:30 overlap the meeting; 11:00 overlaps the 15-min buffer after it
    expect(s).not.toContain(10)
    expect(s).not.toContain(10.5)
    expect(s).not.toContain(11)
    expect(s).toContain(11.5)
  })

  it('ignores busy time on other days', () => {
    const busy = [{ dateKey: FRI, start: 10, end: 11 }]
    const s = slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy, now: NOW })
    expect(s).toContain(10)
  })

  it('returns nothing on non-working days', () => {
    expect(slotsFor({ dateKey: SAT, durationMinutes: 15, rules: rules(), busy: [], now: NOW })).toEqual([])
  })

  it('returns nothing once the daily cap is reached', () => {
    expect(slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy: [], clientCallsToday: 4, now: NOW })).toEqual([])
    expect(slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy: [], clientCallsToday: 3, now: NOW }).length).toBeGreaterThan(0)
  })

  it('enforces minimum notice across the day boundary', () => {
    // Now = Mon Sep 14, 3:00 PM ET (19:00Z). 24h notice → nothing before Tue 3:00 PM.
    const now = new Date('2026-09-14T19:00:00Z')
    const s = slotsFor({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy: [], now })
    expect(s[0]).toBe(15)
    // Two days out is unaffected.
    const wed = slotsFor({ dateKey: '2026-09-16', durationMinutes: 15, rules: rules(), busy: [], now })
    expect(wed[0]).toBe(9)
  })

  it('with no buffer, slots step by duration alone', () => {
    const s = slotsFor({ dateKey: TUE, durationMinutes: 45, rules: rules({ bufferMinutes: 0 }), busy: [], now: NOW })
    expect(s.slice(0, 3)).toEqual([9, 9.75, 10.5])
  })
})

describe('dayIsOpen', () => {
  it('is false for past days', () => {
    expect(dayIsOpen({ dateKey: '2026-08-31', durationMinutes: 15, rules: rules(), busy: [], now: NOW })).toBe(false)
  })
  it('is true for a future weekday with slots', () => {
    expect(dayIsOpen({ dateKey: TUE, durationMinutes: 15, rules: rules(), busy: [], now: NOW })).toBe(true)
  })
})

describe('nextOpenSlot', () => {
  it('skips forward past the notice window and weekends', () => {
    // Fri Sep 18 at 4 PM ET → 24h notice lands on Sat; next working day is Mon Sep 21 at 9.
    const now = new Date('2026-09-18T20:00:00Z')
    const next = nextOpenSlot({ durationMinutes: 15, rules: rules(), events: [], now })
    expect(next).toEqual({ dateKey: '2026-09-21', hour: 9 })
  })
})

describe('busyFromEvents', () => {
  it('expands all-day events to the whole working day', () => {
    const b = busyFromEvents(
      [{ id: 'x', userId: 'u', dateKey: TUE, start: 0, end: 0, title: 'OOO', kind: 'synced', allDay: true }],
      { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
    )
    expect(b).toEqual([{ dateKey: TUE, start: 9, end: 17 }])
  })
})
