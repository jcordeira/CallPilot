/** Client-side time-zone choice. Defaults to Eastern; not server-persisted. */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_ZONE, ZONES } from '../data/fixtures'
import { isValidTimeZone, offsetLabel } from '../lib/time'

interface TimeZoneValue {
  tz: string
  setTz: (tz: string) => void
  /** "ET · GMT-4" */
  zoneShort: string
  /** "Eastern Time" */
  zoneLong: string
}

const Ctx = createContext<TimeZoneValue | null>(null)
const KEY = 'callpilot:tz'

function initialTz(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && isValidTimeZone(saved)) return saved
  } catch {
    /* ignore */
  }
  return DEFAULT_ZONE
}

export function zoneLabels(tz: string, now: Date = new Date()): { short: string; long: string } {
  const z = ZONES.find((x) => x.id === tz)
  const offset = offsetLabel(now, tz)
  if (z) return { short: `${z.abbr} · ${offset}`, long: z.long }
  const name = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
  return { short: `${offset}`, long: name }
}

export function TimeZoneProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [tz, setTzState] = useState<string>(() => initial ?? initialTz())
  const value = useMemo<TimeZoneValue>(() => {
    const labels = zoneLabels(tz)
    return {
      tz,
      setTz: (next) => {
        if (!isValidTimeZone(next)) return
        setTzState(next)
        try {
          localStorage.setItem(KEY, next)
        } catch {
          /* ignore */
        }
      },
      zoneShort: labels.short,
      zoneLong: labels.long,
    }
  }, [tz])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTimeZone(): TimeZoneValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimeZone must be used inside <TimeZoneProvider>')
  return v
}
