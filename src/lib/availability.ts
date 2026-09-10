import type { CalendarEvent, RecurringBreak, WorkingHours } from './types'
import { addDays, nowHour, todayKey, weekday } from './time'

/** A half-open busy interval [start, end) on a given host-zone day. */
export interface BusyInterval {
  dateKey: string
  start: number
  end: number
}

export interface AvailabilityRules {
  workingHours: WorkingHours
  bufferMinutes: number
  breaks: RecurringBreak[]
  minNoticeHours: number
  maxCallsPerDay: number
}

export interface SlotQuery {
  dateKey: string
  durationMinutes: number
  rules: AvailabilityRules
  /** Merged busy time for the host on this day (bookings, tasks, synced events). */
  busy: BusyInterval[]
  /** Number of client calls already on this day (for the daily cap). */
  clientCallsToday?: number
  /** Injectable clock for tests. */
  now?: Date
}

const EPS = 1e-4

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - EPS && aEnd > bStart + EPS
}

/**
 * Candidate start hours for a call on `dateKey`.
 *
 * - Candidates step by (duration + buffer) from the start of working hours.
 * - The last candidate must end by the end of working hours.
 * - A candidate is dropped if [h, h + duration) overlaps an enabled recurring
 *   break scheduled for that weekday, or overlaps busy time (busy time is
 *   extended by the buffer, since the buffer is held open after every
 *   appointment), or starts before now + minimum notice.
 * - No slots at all on a non-working day, or once the daily cap is reached.
 */
export function slotsFor(q: SlotQuery): number[] {
  const { dateKey, durationMinutes, rules, busy } = q
  const now = q.now ?? new Date()
  const dow = weekday(dateKey)
  if (!rules.workingHours.days.includes(dow)) return []
  if ((q.clientCallsToday ?? 0) >= rules.maxCallsPerDay) return []

  const dur = durationMinutes / 60
  const buffer = rules.bufferMinutes / 60
  const step = dur + buffer
  if (step <= 0) return []

  const blocks = rules.breaks.filter((b) => b.enabled && b.days.includes(dow))
  const busyToday = busy.filter((b) => b.dateKey === dateKey)

  // Minimum-notice cutoff expressed as an hour float on this day.
  const today = todayKey(now)
  const noticeCutoffDay = today
  const noticeCutoffHour = nowHour(now) + rules.minNoticeHours
  const cutoffKeyDiff = dayDiff(noticeCutoffDay, dateKey)
  // Hour on `dateKey` before which candidates are too soon.
  const cutoffOnThisDay = noticeCutoffHour - cutoffKeyDiff * 24

  const out: number[] = []
  const { start, end } = rules.workingHours
  for (let h = start; h + dur <= end + EPS; h = round(h + step)) {
    if (h < cutoffOnThisDay - EPS) continue
    if (blocks.some((b) => overlaps(h, h + dur, b.start, b.end))) continue
    if (busyToday.some((b) => overlaps(h, h + dur, b.start, b.end + buffer))) continue
    out.push(h)
  }
  return out
}

/** Whole days between two keys (b - a). */
function dayDiff(a: string, b: string): number {
  const A = Date.UTC(...splitKey(a))
  const B = Date.UTC(...splitKey(b))
  return Math.round((B - A) / 86400000)
}

function splitKey(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m - 1, d]
}

function round(h: number): number {
  return Math.round(h * 3600) / 3600
}

/** Busy intervals derived from a user's events. All-day events block the whole working day. */
export function busyFromEvents(events: CalendarEvent[], hours: WorkingHours): BusyInterval[] {
  return events.map((e) =>
    e.allDay
      ? { dateKey: e.dateKey, start: hours.start, end: hours.end }
      : { dateKey: e.dateKey, start: e.start, end: e.end },
  )
}

export function clientCallsOn(events: CalendarEvent[], dateKey: string): number {
  return events.filter((e) => e.kind === 'client' && e.dateKey === dateKey).length
}

/** A day is open if it is not in the past and has at least one slot. */
export function dayIsOpen(q: SlotQuery): boolean {
  const today = todayKey(q.now ?? new Date())
  if (q.dateKey < today) return false
  return slotsFor(q).length > 0
}

/**
 * The next open slot for a user, scanning forward up to `horizonDays`.
 * Returns the host-zone key + hour, or null.
 */
export function nextOpenSlot(opts: {
  durationMinutes: number
  rules: AvailabilityRules
  events: CalendarEvent[]
  horizonDays?: number
  now?: Date
}): { dateKey: string; hour: number } | null {
  const now = opts.now ?? new Date()
  const busy = busyFromEvents(opts.events, opts.rules.workingHours)
  let key = todayKey(now)
  for (let i = 0; i < (opts.horizonDays ?? 14); i++) {
    const slots = slotsFor({
      dateKey: key,
      durationMinutes: opts.durationMinutes,
      rules: opts.rules,
      busy,
      clientCallsToday: clientCallsOn(opts.events, key),
      now,
    })
    if (slots.length) return { dateKey: key, hour: slots[0] }
    key = addDays(key, 1)
  }
  return null
}
