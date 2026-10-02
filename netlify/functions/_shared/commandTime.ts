const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]))
  const hour = Number(bag.hour)
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(bag.minute),
    weekday: WEEKDAYS.findIndex((day) => day.startsWith((bag.weekday ?? '').toLowerCase())),
  }
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
  return asUtc - date.getTime()
}

/** Wall-clock time in `timeZone` as a UTC Date. */
export function zonedDate(parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0))
  const corrected = new Date(guess.getTime() - offsetMs(guess, timeZone))
  const drift = offsetMs(corrected, timeZone) - offsetMs(guess, timeZone)
  return drift === 0 ? corrected : new Date(corrected.getTime() - drift)
}

export function addDays(parts: ZonedParts, days: number, timeZone: string): ZonedParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0))
  const next = zonedParts(utc, timeZone)
  return { ...next, hour: parts.hour, minute: parts.minute }
}

export function formatWhen(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatSlot(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\b(\d{1,2})(?::(\d{2}))\b/)
  if (!match) {
    const bare = text.match(/\b(\d{1,2})\b/)
    if (!bare) return null
    const hour = Number(bare[1])
    if (hour < 1 || hour > 12) return null
    return { hour: hour <= 7 ? hour + 12 : hour === 12 ? 12 : hour, minute: 0 }
  }
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const mer = match[3]?.toLowerCase()
  if (hour > 23 || minute > 59) return null
  if (mer === 'pm' && hour < 12) hour += 12
  if (mer === 'am' && hour === 12) hour = 0
  if (!mer && hour <= 7) hour += 12
  return { hour, minute }
}

function weekdayIndex(text: string): number | null {
  const lower = text.toLowerCase()
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const name = WEEKDAYS[i]
    const short = name.slice(0, 3)
    if (new RegExp(`\\b(?:${name}|${short})\\b`).test(lower)) return i
  }
  return null
}

export function parseWhen(text: string, now: Date, timeZone: string): { start: Date } | null {
  const clock = parseClock(text)
  if (!clock) return null
  const current = zonedParts(now, timeZone)
  let day = { year: current.year, month: current.month, day: current.day }
  const lower = text.toLowerCase()
  if (lower.includes('tomorrow')) {
    const next = addDays({ ...current, hour: 12, minute: 0 }, 1, timeZone)
    day = next
  } else {
    const wanted = weekdayIndex(lower)
    if (wanted != null && wanted !== current.weekday) {
      const delta = (wanted - current.weekday + 7) % 7 || 7
      const next = addDays({ ...current, hour: 12, minute: 0 }, delta, timeZone)
      day = next
    } else if (wanted != null && wanted === current.weekday && clock.hour * 60 + clock.minute <= current.hour * 60 + current.minute) {
      const next = addDays({ ...current, hour: 12, minute: 0 }, 7, timeZone)
      day = next
    } else if (!lower.includes('today') && !lower.includes('tomorrow') && wanted == null) {
      if (clock.hour * 60 + clock.minute <= current.hour * 60 + current.minute) {
        const next = addDays({ ...current, hour: 12, minute: 0 }, 1, timeZone)
        day = next
      }
    }
  }
  return { start: zonedDate({ ...day, hour: clock.hour, minute: clock.minute }, timeZone) }
}

export function openSlots(input: {
  now: Date
  timeZone: string
  day: ZonedParts
  startHour: number
  endHour: number
  durationMinutes: number
  busy: { startIso: string; endIso: string }[]
  limit: number
}): Date[] {
  const slots: Date[] = []
  const dur = input.durationMinutes * 60_000
  for (let hour = input.startHour; hour < input.endHour; hour += 0.5) {
    const whole = Math.floor(hour)
    const minute = hour - whole >= 0.5 ? 30 : 0
    const start = zonedDate({ year: input.day.year, month: input.day.month, day: input.day.day, hour: whole, minute }, input.timeZone)
    const end = start.getTime() + dur
    if (start.getTime() <= input.now.getTime()) continue
    const blocked = input.busy.some((span) => {
      const b0 = new Date(span.startIso).getTime()
      const b1 = new Date(span.endIso).getTime()
      return start.getTime() < b1 && end > b0
    })
    if (blocked) continue
    slots.push(start)
    if (slots.length >= input.limit) break
  }
  return slots
}
