export const CALENDAR_TZ = 'America/New_York'

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: string
}

export function zonedParts(date: Date, timeZone = CALENDAR_TZ): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: get('weekday'),
  }
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = CALENDAR_TZ,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
    utc -= asUtc - utc
  }
  return new Date(utc)
}

export function addZonedDays(date: Date, days: number, timeZone = CALENDAR_TZ): Date {
  const parts = zonedParts(date, timeZone)
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day + days, parts.hour, parts.minute, timeZone)
}

export function startOfZonedDay(date: Date, timeZone = CALENDAR_TZ): Date {
  const parts = zonedParts(date, timeZone)
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone)
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function startOfZonedWeek(date: Date, timeZone = CALENDAR_TZ): Date {
  const parts = zonedParts(date, timeZone)
  const index = WEEK.indexOf(parts.weekday)
  return addZonedDays(startOfZonedDay(date, timeZone), index < 0 ? 0 : -index, timeZone)
}

export function formatDayLabel(date: Date, timeZone = CALENDAR_TZ): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(date)
}

/** 0 → "12 AM", 13 → "1 PM". Hour-axis labels omit minutes. */
export function formatHourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}

/** "2 PM" on the hour, "1:30 PM" otherwise. Always Eastern unless a zone is passed. */
export function formatTimeLabel(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = zonedParts(date, timeZone)
  const period = parts.hour >= 12 ? 'PM' : 'AM'
  const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  if (parts.minute === 0) return `${h12} ${period}`
  return `${h12}:${String(parts.minute).padStart(2, '0')} ${period}`
}

/** "Fri, Oct 2 · 12:16:05 PM ET" */
export function formatNowClock(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    second: '2-digit',
  }).formatToParts(date)
  const second = Number(parts.find((part) => part.type === 'second')?.value ?? '0')
  const wall = zonedParts(date, timeZone)
  const period = wall.hour >= 12 ? 'PM' : 'AM'
  const h12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12
  const clock = `${h12}:${String(wall.minute).padStart(2, '0')}:${String(second).padStart(2, '0')} ${period}`
  return `${formatDayLabel(date, timeZone)} · ${clock} ET`
}

export function parseWallTime(value: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const [hStr, mStr] = value.split(':')
  const hour24 = Number(hStr)
  const hour = Number.isFinite(hour24) ? ((Math.floor(hour24) % 24) + 24) % 24 : 0
  const minuteRaw = Number(mStr)
  const minute = Number.isFinite(minuteRaw) ? Math.min(59, Math.max(0, Math.floor(minuteRaw))) : 0
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    minute,
    period: hour >= 12 ? 'PM' : 'AM',
  }
}

export function wallTimeValue(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const base = ((hour12 % 12) + 12) % 12
  const hour = period === 'PM' ? base + 12 : base
  const min = Math.min(59, Math.max(0, Math.floor(minute)))
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Hour float to park near the top of the day grid. 8 AM when the visible days are not today. */
export function focusHour(now: Date, showingToday: boolean, timeZone = CALENDAR_TZ): number {
  if (!showingToday) return 8
  const parts = zonedParts(now, timeZone)
  return parts.hour + parts.minute / 60
}

/** "in 45 min", "in 2 hr", "in 1 day". */
export function formatUntil(minutes: number): string {
  const mins = Math.max(1, Math.round(minutes))
  if (mins < 60) return `in ${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem ? `in ${hours} hr ${rem} min` : `in ${hours} hr`
  const days = Math.max(1, Math.round(mins / 1440))
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export function dateKey(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function timeValue(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = zonedParts(date, timeZone)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}
