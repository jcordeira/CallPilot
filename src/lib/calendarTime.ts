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

export function formatTimeLabel(date: Date, timeZone = CALENDAR_TZ): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date)
}

export function dateKey(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function timeValue(date: Date, timeZone = CALENDAR_TZ): string {
  const parts = zonedParts(date, timeZone)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}
