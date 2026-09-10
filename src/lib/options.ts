import { fmt } from './time'

/** Hour-float options in 15-minute steps, for time selects. */
export function timeOptions(start = 6, end = 20, stepMinutes = 15): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = []
  for (let h = start; h <= end + 1e-9; h += stepMinutes / 60) {
    const v = Math.round(h * 4) / 4
    out.push({ value: v, label: fmt(v) })
  }
  return out
}

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120].map((m) => ({
  value: m,
  label: m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`,
}))

/** [1,2,3,4,5] → "Mon–Fri"; [1,3,5] → "Mon, Wed, Fri" */
export function daysLabel(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const names: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
  const sorted = order.filter((d) => days.includes(d))
  if (sorted.length === 0) return 'No days'
  if (sorted.length === 7) return 'Every day'
  // contiguous run?
  const idx = sorted.map((d) => order.indexOf(d))
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguous && sorted.length >= 3) return `${names[sorted[0]]}–${names[sorted[sorted.length - 1]]}`
  return sorted.map((d) => names[d]).join(', ')
}

export const WEEKDAY_PICKS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
]
