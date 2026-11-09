import { dateKey, formatTimeLabel, zonedDateTimeToUtc, zonedParts } from './calendarTime'

export type SlotEvent = { startIso: string; endIso: string; allDay: boolean }

const QUARTER = [0, 15, 30, 45]

export function slotOverlaps(day: string, time: string, events: SlotEvent[], minutes = 15): boolean {
  const [hour, minute] = time.split(':').map(Number)
  const [year, month, date] = day.split('-').map(Number)
  const start = zonedDateTimeToUtc(year, month, date, hour || 0, minute || 0)
  const end = start.getTime() + minutes * 60_000
  return events.some((event) => {
    if (event.allDay || dateKey(new Date(event.startIso)) !== day) return false
    return new Date(event.startIso).getTime() < end && new Date(event.endIso).getTime() > start.getTime()
  })
}

export function freeQuarters(day: string, events: SlotEvent[], fromHour = 0, toHour = 24): string[] {
  const slots: string[] = []
  for (let hour = fromHour; hour < toHour; hour += 1) {
    for (const minute of QUARTER) {
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      if (!slotOverlaps(day, time, events)) slots.push(time)
    }
  }
  return slots
}

/** Next free 15-minute starts today and tomorrow, 8:00 AM through 6:45 PM ET. */
export function nextOpenSlots(now: Date, events: SlotEvent[], count = 5): { date: string; time: string; label: string }[] {
  const parts = zonedParts(now)
  const today = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
  const tomorrowDate = zonedDateTimeToUtc(parts.year, parts.month, parts.day + 1, 12, 0)
  const tomorrowParts = zonedParts(tomorrowDate)
  const tomorrow = `${tomorrowParts.year}-${String(tomorrowParts.month).padStart(2, '0')}-${String(tomorrowParts.day).padStart(2, '0')}`
  const found: { date: string; time: string; label: string }[] = []
  for (const day of [today, tomorrow]) {
    const startMinutes = day === today ? Math.max(8 * 60, Math.ceil((parts.hour * 60 + parts.minute) / 15) * 15) : 8 * 60
    for (let minutes = startMinutes; minutes < 19 * 60 && found.length < count; minutes += 15) {
      const hour = Math.floor(minutes / 60)
      const minute = minutes % 60
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      if (slotOverlaps(day, time, events)) continue
      const at = zonedDateTimeToUtc(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), hour, minute)
      const when = day === today ? 'Today' : 'Tomorrow'
      found.push({ date: day, time, label: `${when} ${formatTimeLabel(at)}` })
    }
  }
  return found
}
