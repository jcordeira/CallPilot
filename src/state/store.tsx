/**
 * App store: host/admin settings (server-persisted in production), the events
 * feed, the team roster and client bookings. Persisted to localStorage so the
 * demo survives reloads. Replace the persistence layer with API calls.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { Booking, CalendarEvent, Connection, Location, RecurringBreak, Settings, TeamMember } from '../lib/types'
import { DEFAULT_SETTINGS, TEAM, seedEvents } from '../data/fixtures'

export interface AppState {
  settings: Settings
  events: CalendarEvent[]
  team: TeamMember[]
  bookings: Booking[]
}

export type Action =
  | { type: 'connection/toggle'; provider: Connection['provider'] }
  | { type: 'email/toggle'; id: string }
  | { type: 'conferencing/set'; value: Location }
  | { type: 'buffer/set'; minutes: number }
  | { type: 'break/toggle'; id: string }
  | { type: 'break/add'; brk: RecurringBreak }
  | { type: 'break/update'; brk: RecurringBreak }
  | { type: 'break/remove'; id: string }
  | { type: 'event/add'; event: CalendarEvent }
  | { type: 'event/remove'; id: string }
  | { type: 'booking/add'; booking: Booking; event: CalendarEvent }
  | { type: 'team/invite'; member: TeamMember }
  | { type: 'reset' }

const STORAGE_KEY = 'callpilot:v1'

export function initialState(): AppState {
  return {
    settings: DEFAULT_SETTINGS,
    events: seedEvents(),
    team: TEAM,
    bookings: [],
  }
}

export function reducer(state: AppState, action: Action): AppState {
  const s = state.settings
  switch (action.type) {
    case 'connection/toggle':
      return {
        ...state,
        settings: {
          ...s,
          connections: s.connections.map((c) =>
            c.provider === action.provider ? { ...c, enabled: !c.enabled } : c,
          ),
        },
      }
    case 'email/toggle':
      return {
        ...state,
        settings: { ...s, emails: s.emails.map((e) => (e.id === action.id ? { ...e, enabled: !e.enabled } : e)) },
      }
    case 'conferencing/set':
      return { ...state, settings: { ...s, conferencing: action.value } }
    case 'buffer/set':
      return { ...state, settings: { ...s, bufferMinutes: action.minutes } }
    case 'break/toggle':
      return {
        ...state,
        settings: { ...s, breaks: s.breaks.map((b) => (b.id === action.id ? { ...b, enabled: !b.enabled } : b)) },
      }
    case 'break/add':
      return { ...state, settings: { ...s, breaks: [...s.breaks, action.brk] } }
    case 'break/update':
      return { ...state, settings: { ...s, breaks: s.breaks.map((b) => (b.id === action.brk.id ? action.brk : b)) } }
    case 'break/remove':
      return { ...state, settings: { ...s, breaks: s.breaks.filter((b) => b.id !== action.id) } }
    case 'event/add':
      return { ...state, events: [...state.events, action.event] }
    case 'event/remove':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) }
    case 'booking/add':
      return { ...state, bookings: [...state.bookings, action.booking], events: [...state.events, action.event] }
    case 'team/invite':
      if (state.team.some((m) => m.email.toLowerCase() === action.member.email.toLowerCase())) return state
      return { ...state, team: [...state.team, action.member] }
    case 'reset':
      return initialState()
    default:
      return state
  }
}

function load(): AppState {
  const fresh = initialState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const saved = JSON.parse(raw) as Partial<AppState>
    return {
      settings: { ...fresh.settings, ...(saved.settings ?? {}) },
      events: Array.isArray(saved.events) ? saved.events : fresh.events,
      team: Array.isArray(saved.team) && saved.team.length ? saved.team : fresh.team,
      bookings: Array.isArray(saved.bookings) ? saved.bookings : fresh.bookings,
    }
  } catch {
    return fresh
  }
}

interface StoreValue {
  state: AppState
  dispatch: (a: Action) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: AppState }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initial ?? load())

  useEffect(() => {
    if (initial) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable — keep going in memory */
    }
  }, [state, initial])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}`
}
