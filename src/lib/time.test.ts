import { describe, expect, it } from 'vitest'
import { fmt, hostSlotInZone, offsetLabel, span, startOfWeek, weekRangeLabel, zonedToUtc } from './time'

describe('fmt / span', () => {
  it('formats hour floats', () => {
    expect(fmt(9)).toBe('9:00 AM')
    expect(fmt(14.5)).toBe('2:30 PM')
    expect(fmt(12)).toBe('12:00 PM')
    expect(fmt(0)).toBe('12:00 AM')
  })
  it('collapses a shared meridiem', () => {
    expect(span(9, 9.75)).toBe('9:00 – 9:45 AM')
    expect(span(10.5, 11.5)).toBe('10:30 – 11:30 AM')
    expect(span(11.5, 13)).toBe('11:30 AM – 1:00 PM')
  })
})

describe('weeks', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-09-10')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })
  it('labels a week range', () => {
    expect(weekRangeLabel('2026-09-07')).toBe('Sep 7 – Sep 13, 2026')
  })
})

describe('time zones', () => {
  it('converts a New York wall-clock time to UTC (EDT)', () => {
    expect(zonedToUtc('2026-09-15', 9, 'America/New_York').toISOString()).toBe('2026-09-15T13:00:00.000Z')
  })
  it('converts a New York wall-clock time to UTC (EST)', () => {
    expect(zonedToUtc('2026-12-15', 9, 'America/New_York').toISOString()).toBe('2026-12-15T14:00:00.000Z')
  })
  it('shows a host slot in another zone', () => {
    expect(hostSlotInZone('2026-09-15', 9, 'America/Los_Angeles')).toEqual({ key: '2026-09-15', hour: 6 })
    expect(hostSlotInZone('2026-09-15', 9, 'Europe/London')).toEqual({ key: '2026-09-15', hour: 14 })
    expect(hostSlotInZone('2026-09-15', 14.5, 'Asia/Kolkata')).toEqual({ key: '2026-09-16', hour: 0 })
  })
  it('labels offsets', () => {
    const d = new Date('2026-09-15T12:00:00Z')
    expect(offsetLabel(d, 'America/New_York')).toBe('GMT-4')
    expect(offsetLabel(d, 'Europe/London')).toBe('GMT+1')
    expect(offsetLabel(d, 'Asia/Kolkata')).toBe('GMT+5:30')
  })
})
