import { addDays, fmt, pad2, toKey, zonedParts, HOST_TIME_ZONE } from './time'

const TASK_MINUTES = 15

export function quarterHourOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      options.push({
        value: `${pad2(hour)}:${pad2(minute)}`,
        label: fmt(hour + minute / 60),
      })
    }
  }
  return options
}

/** Next 15-minute boundary in Eastern time. An exact boundary stays put. */
export function nextQuarterHourEt(now = new Date()): { date: string; time: string } {
  const parts = zonedParts(now, HOST_TIME_ZONE)
  let minutes = parts.h * 60 + parts.min
  if (parts.s > 0) minutes += 1
  minutes = Math.ceil(minutes / 15) * TASK_MINUTES
  let extraDays = 0
  if (minutes >= 24 * 60) {
    extraDays = Math.floor(minutes / (24 * 60))
    minutes %= 24 * 60
  }
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return {
    date: addDays(toKey(parts.y, parts.m - 1, parts.d), extraDays),
    time: `${pad2(hour)}:${pad2(minute)}`,
  }
}
