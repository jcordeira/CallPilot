/** Time helpers. Hours are floats (14.5 = 2:30 PM). Dates are "YYYY-MM-DD" keys in the host zone. */

export const HOST_TIME_ZONE = 'America/New_York'

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Monday-first weekday labels */
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 14.5 → "2:30 PM" */
export function fmt(h: number): string {
  const hr = Math.floor(h)
  const m = Math.round((h - hr) * 60)
  const ap = hr >= 12 ? 'PM' : 'AM'
  const h12 = hr % 12 === 0 ? 12 : hr % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

/** "9:00 AM" → "9 AM" for hour axes */
export function fmtShort(h: number): string {
  return fmt(h).replace(':00', '')
}

/** Collapses a shared meridiem: "9:00 – 9:45 AM", but "11:30 AM – 1:00 PM" */
export function span(a: number, b: number): string {
  const fa = fmt(a)
  const fb = fmt(b)
  return (fa.slice(-2) === fb.slice(-2) ? fa.slice(0, -3) : fa) + ' – ' + fb
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toKey(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`
}

export function parseKey(key: string): { y: number; m0: number; d: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m0: m - 1, d }
}

/** Local Date at noon for a key (avoids DST edge cases when only the calendar day matters). */
export function keyToDate(key: string): Date {
  const { y, m0, d } = parseKey(key)
  return new Date(y, m0, d, 12, 0, 0)
}

export function dateToKey(date: Date): string {
  return toKey(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(key: string, n: number): string {
  const d = keyToDate(key)
  d.setDate(d.getDate() + n)
  return dateToKey(d)
}

/** JS weekday (0 = Sun) for a key */
export function weekday(key: string): number {
  return keyToDate(key).getDay()
}

/** Key of the Monday that starts the week containing `key`. */
export function startOfWeek(key: string): string {
  const dow = weekday(key)
  const back = (dow + 6) % 7
  return addDays(key, -back)
}

/** "Tue, Sep 15" */
export function dayLabel(key: string): string {
  const d = keyToDate(key)
  return `${DOW[(d.getDay() + 6) % 7]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** "Sep 7 – Sep 13, 2026" */
export function weekRangeLabel(mondayKey: string): string {
  const a = keyToDate(mondayKey)
  const b = keyToDate(addDays(mondayKey, 6))
  return `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}, ${b.getFullYear()}`
}

/** "September 2026" */
export function monthLabel(y: number, m0: number): string {
  return `${MONTHS[m0]} ${y}`
}

// ---------------------------------------------------------------------------
// Time-zone conversion via Intl (no library). Good enough for display of
// host-zone slots in the client's chosen zone, DST included.
// ---------------------------------------------------------------------------

interface Parts { y: number; m: number; d: number; h: number; min: number; s: number }

const partsCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    partsCache.set(tz, f)
  }
  return f
}

/** Wall-clock parts of an instant in `tz` */
export function zonedParts(date: Date, tz: string): Parts {
  const out: Partial<Parts> = {}
  for (const p of partsFormatter(tz).formatToParts(date)) {
    switch (p.type) {
      case 'year': out.y = Number(p.value); break
      case 'month': out.m = Number(p.value); break
      case 'day': out.d = Number(p.value); break
      case 'hour': out.h = Number(p.value) % 24; break
      case 'minute': out.min = Number(p.value); break
      case 'second': out.s = Number(p.value); break
    }
  }
  return out as Parts
}

/** Offset of `tz` from UTC at `date`, in minutes (New York in summer → -240). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s)
  return Math.round((asUtc - date.getTime()) / 60000)
}

/** Instant for a wall-clock time in `tz`. */
export function zonedToUtc(key: string, hour: number, tz: string): Date {
  const { y, m0, d } = parseKey(key)
  const hr = Math.floor(hour)
  const min = Math.round((hour - hr) * 60)
  const guess = Date.UTC(y, m0, d, hr, min, 0)
  let offset = tzOffsetMinutes(new Date(guess), tz)
  let result = guess - offset * 60000
  const offset2 = tzOffsetMinutes(new Date(result), tz)
  if (offset2 !== offset) {
    offset = offset2
    result = guess - offset * 60000
  }
  return new Date(result)
}

/** A host-zone slot (key + hour) as a wall-clock hour float and key in `tz`. */
export function hostSlotInZone(key: string, hour: number, tz: string): { key: string; hour: number } {
  const instant = zonedToUtc(key, hour, HOST_TIME_ZONE)
  const p = zonedParts(instant, tz)
  return { key: toKey(p.y, p.m - 1, p.d), hour: p.h + p.min / 60 }
}

/** "GMT-4", "GMT+1", "GMT+5:30" */
export function offsetLabel(date: Date, tz: string): string {
  const mins = tzOffsetMinutes(date, tz)
  const sign = mins < 0 ? '-' : '+'
  const abs = Math.abs(mins)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `GMT${sign}${h}${m ? ':' + pad2(m) : ''}`
}

/** Today's key in the host zone. */
export function todayKey(now: Date = new Date()): string {
  const p = zonedParts(now, HOST_TIME_ZONE)
  return toKey(p.y, p.m - 1, p.d)
}

/** Current host-zone wall-clock hour as a float. */
export function nowHour(now: Date = new Date()): number {
  const p = zonedParts(now, HOST_TIME_ZONE)
  return p.h + p.min / 60 + p.s / 3600
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
