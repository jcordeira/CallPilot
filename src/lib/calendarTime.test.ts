import { describe, expect, it } from 'vitest'
import {
  focusHour,
  formatHourLabel,
  formatNowClock,
  formatTimeLabel,
  formatUntil,
  parseWallTime,
  wallTimeValue,
} from './calendarTime'

describe('calendar time labels', () => {
  it('uses 12-hour Eastern labels and a full-day focus hour', () => {
    expect(formatHourLabel(0)).toBe('12 AM')
    expect(formatHourLabel(8)).toBe('8 AM')
    expect(formatHourLabel(12)).toBe('12 PM')
    expect(formatHourLabel(13)).toBe('1 PM')
    expect(formatHourLabel(23)).toBe('11 PM')
    expect(formatTimeLabel(new Date('2026-10-02T17:30:00.000Z'))).toBe('1:30 PM')
    expect(formatTimeLabel(new Date('2026-10-02T18:00:00.000Z'))).toBe('2 PM')
    expect(formatNowClock(new Date('2026-10-02T16:16:05.000Z'))).toBe('Fri, Oct 2 · 12:16:05 PM ET')
    expect(formatUntil(45)).toBe('in 45 min')
    expect(formatUntil(60)).toBe('in 1 hr')
    expect(formatUntil(90)).toBe('in 1 hr 30 min')
    expect(formatUntil(1500)).toBe('in 1 day')
    expect(wallTimeValue(1, 30, 'PM')).toBe('13:30')
    expect(wallTimeValue(12, 0, 'AM')).toBe('00:00')
    expect(wallTimeValue(12, 0, 'PM')).toBe('12:00')
    expect(parseWallTime('00:05')).toEqual({ hour12: 12, minute: 5, period: 'AM' })
    expect(focusHour(new Date('2026-10-02T16:16:00.000Z'), false)).toBe(8)
    expect(focusHour(new Date('2026-10-02T16:16:00.000Z'), true)).toBeCloseTo(12 + 16 / 60)
  })
})
