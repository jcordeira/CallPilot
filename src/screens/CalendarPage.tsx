import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FubPersonLink } from '../components/FubPersonLink'
import { Modal } from '../components/Modal'
import { clientCallTitle, externalGuestEmails, TEAM_GUESTS } from '../lib/calendarGuests'
import { matchPersonInText } from '../lib/fubLink'
import {
  addZonedDays,
  dateKey,
  focusHour,
  formatDayLabel,
  formatHourLabel,
  formatNowClock,
  formatTimeLabel,
  formatUntil,
  nextDateKey,
  parseWallTime,
  startOfZonedDay,
  startOfZonedWeek,
  timeValue,
  wallTimeValue,
  zonedDateTimeToUtc,
  zonedParts,
} from '../lib/calendarTime'
import {
  createHubCalendarEvent,
  deleteHubCalendarEvent,
  fetchHubCalendar,
  googleConnectUrl,
  searchHubPeople,
  updateHubCalendarEvent,
  type CalendarPayload,
  type CalendarWrite,
  type HubCalendarEvent,
} from '../lib/hubApi'
import { useMediaQuery } from '../lib/useMediaQuery'
import './CalendarPage.css'

type View = 'day' | 'week' | 'agenda'
type Draft = {
  id?: string
  summary: string
  description: string
  location: string
  day: string
  start: string
  end: string
  attendees: string[]
  topic: string
  autoTitle: boolean
  allDay: boolean
  /** Exclusive end date for a multi-day all-day event. Cleared when the start day changes. */
  endDay?: string
}
type Pending = { write: CalendarWrite; label: string }

const HOUR_START = 0
const HOUR_END = 24
const HOUR_PX = 52
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => HOUR_START + index)

function rangeFor(view: View, anchor: Date): { start: Date; end: Date } {
  if (view === 'week') {
    const start = startOfZonedWeek(anchor)
    return { start, end: addZonedDays(start, 7) }
  }
  const start = startOfZonedDay(anchor)
  return { start, end: addZonedDays(start, view === 'agenda' ? 14 : 1) }
}

function blankDraft(anchor: Date): Draft {
  const parts = zonedParts(anchor)
  const day = dateKey(anchor)
  const startHour = Math.min(23, Math.max(0, parts.hour))
  return {
    summary: '',
    description: '',
    location: '',
    day,
    start: `${String(startHour).padStart(2, '0')}:00`,
    end: `${String(startHour).padStart(2, '0')}:30`,
    attendees: [],
    topic: '',
    autoTitle: true,
    allDay: false,
  }
}

function draftFromEvent(event: HubCalendarEvent): Draft {
  const start = new Date(event.startIso)
  const day = dateKey(start)
  const endDay = event.allDay ? dateKey(new Date(event.endIso)) : undefined
  return {
    id: event.id,
    summary: event.summary,
    description: event.description ?? '',
    location: event.location ?? '',
    day,
    start: event.allDay ? '09:00' : timeValue(start),
    end: event.allDay ? '09:30' : timeValue(new Date(event.endIso)),
    attendees: (event.attendees ?? []).map((attendee) => attendee.email),
    topic: '',
    autoTitle: false,
    allDay: event.allDay,
    endDay: endDay && endDay > day ? endDay : undefined,
  }
}

function allDayOn(event: HubCalendarEvent, day: string): boolean {
  if (!event.allDay) return false
  const start = dateKey(new Date(event.startIso))
  const end = dateKey(new Date(event.endIso))
  if (end <= start) return day === start
  return day >= start && day < end
}

function toWrite(draft: Draft, sendUpdates: 'all' | 'none'): CalendarWrite {
  const summary = draft.summary.trim()
  const description = draft.description.trim() || undefined
  const location = draft.location.trim() || undefined
  if (draft.allDay) {
    const endDay = draft.endDay && draft.endDay > draft.day ? draft.endDay : nextDateKey(draft.day)
    return {
      id: draft.id,
      summary,
      description,
      location,
      startIso: `${draft.day}T12:00:00.000Z`,
      endIso: `${endDay}T12:00:00.000Z`,
      allDay: true,
      attendees: draft.attendees,
      sendUpdates,
    }
  }
  const [sh, sm] = draft.start.split(':').map(Number)
  const [eh, em] = draft.end.split(':').map(Number)
  const [year, month, day] = draft.day.split('-').map(Number)
  const start = zonedDateTimeToUtc(year, month, day, sh || 0, sm || 0)
  let end = zonedDateTimeToUtc(year, month, day, eh || 0, em || 0)
  if (end <= start) end = new Date(start.getTime() + 30 * 60_000)
  return {
    id: draft.id,
    summary,
    description,
    location,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    allDay: false,
    attendees: draft.attendees,
    sendUpdates,
  }
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const wall = parseWallTime(value)
  const minutes = Array.from({ length: 12 }, (_, index) => index * 5)
  if (!minutes.includes(wall.minute)) minutes.push(wall.minute)
  minutes.sort((a, b) => a - b)
  const commit = (hour12: number, minute: number, period: 'AM' | 'PM') => onChange(wallTimeValue(hour12, minute, period))
  return (
    <div className="cal__field">
      <span id={`${label}-time`}>{label}</span>
      <div className="cal__clockpick" role="group" aria-labelledby={`${label}-time`}>
        <label className="cal__clock-col">
          <span className="cal__clock-caption">Hour</span>
          <select className="select" aria-label={`${label} hour`} value={wall.hour12} onChange={(e) => commit(Number(e.target.value), wall.minute, wall.period)}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
              <option key={hour} value={hour}>{hour}</option>
            ))}
          </select>
        </label>
        <label className="cal__clock-col">
          <span className="cal__clock-caption">Min</span>
          <select className="select" aria-label={`${label} minute`} value={wall.minute} onChange={(e) => commit(wall.hour12, Number(e.target.value), wall.period)}>
            {minutes.map((minute) => (
              <option key={minute} value={minute}>{String(minute).padStart(2, '0')}</option>
            ))}
          </select>
        </label>
        <label className="cal__clock-col">
          <span className="cal__clock-caption">AM/PM</span>
          <select className="select" aria-label={`${label} AM or PM`} value={wall.period} onChange={(e) => commit(wall.hour12, wall.minute, e.target.value === 'PM' ? 'PM' : 'AM')}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function nextUp(events: HubCalendarEvent[], now: Date): string | null {
  const upcoming = events
    .filter((event) => !event.allDay && new Date(event.startIso).getTime() > now.getTime())
    .sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
  if (!upcoming) return null
  const minutes = (new Date(upcoming.startIso).getTime() - now.getTime()) / 60_000
  return `Next: ${upcoming.summary} ${formatUntil(minutes)}`
}

function EventTitle({ event, leads }: { event: HubCalendarEvent; leads: { personId: number; name: string }[] }) {
  const match = matchPersonInText(event.summary, leads)
  if (!match) return <>{event.summary}</>
  return (
    <>
      {event.summary.slice(0, match.index)}
      <FubPersonLink personId={match.personId}>{match.label}</FubPersonLink>
      {event.summary.slice(match.index + match.label.length)}
    </>
  )
}

export function CalendarPage() {
  const narrow = useMediaQuery('(max-width: 720px)')
  const [view, setView] = useState<View>(narrow ? 'agenda' : 'week')
  const [pickedView, setPickedView] = useState(false)
  const [anchor, setAnchor] = useState(() => new Date())
  const [data, setData] = useState<CalendarPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [removeId, setRemoveId] = useState<HubCalendarEvent | null>(null)
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<{ id: number; name: string; email?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickedView) setView(narrow ? 'agenda' : 'week')
  }, [narrow, pickedView])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const span = useMemo(() => rangeFor(view, anchor), [view, anchor])
  const load = useCallback(async () => {
    try {
      setData(await fetchHubCalendar(span.start, span.end))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the calendar')
    }
  }, [span.start, span.end])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (query.trim().length < 2) {
      setPeople([])
      return
    }
    const timer = window.setTimeout(() => {
      void searchHubPeople(query)
        .then((result) => setPeople(result.people))
        .catch(() => setPeople([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const days = useMemo(() => {
    const count = view === 'week' ? 7 : 1
    const start = view === 'week' ? startOfZonedWeek(anchor) : startOfZonedDay(anchor)
    return Array.from({ length: count }, (_, index) => addZonedDays(start, index))
  }, [view, anchor])

  const leads = data?.leads ?? []
  const events = data?.events ?? []
  const todayKey = dateKey(now)
  const showingToday = days.some((day) => dateKey(day) === todayKey)
  const nowTop = (zonedParts(now).hour + zonedParts(now).minute / 60 - HOUR_START) * HOUR_PX
  const upcoming = nextUp(events, now)

  useEffect(() => {
    const node = scrollRef.current
    if (!node || view === 'agenda') return
    const header = node.querySelector('.cal__col-label')?.clientHeight ?? 0
    const hour = focusHour(now, showingToday)
    const cushion = showingToday ? header + 20 : header
    node.scrollTop = Math.max(0, hour * HOUR_PX - cushion)
  }, [view, anchor, showingToday])

  async function commit(write: CalendarWrite) {
    setBusy(true)
    try {
      if (write.id) await updateHubCalendarEvent({ ...write, id: write.id })
      else await createHubCalendarEvent(write)
      setDraft(null)
      setPending(null)
      setQuery('')
      await load()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event')
    } finally {
      setBusy(false)
    }
  }

  function askOrSave(next: Draft) {
    if (!next.summary.trim()) {
      setError('Add a title.')
      return
    }
    const write = toWrite(next, 'none')
    if (externalGuestEmails(next.attendees).length) {
      setPending({ write, label: next.id ? 'Save changes' : 'Create booking' })
      return
    }
    void commit(write)
  }

  function onDrag(item: HubCalendarEvent, event: ReactPointerEvent<HTMLDivElement>) {
    if (item.allDay) {
      setDraft(draftFromEvent(item))
      return
    }
    const originX = event.clientX
    const originY = event.clientY
    const column = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 120
    const start = new Date(item.startIso).getTime()
    const end = new Date(item.endIso).getTime()
    const duration = Math.max(15 * 60_000, end - start)
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - originX) > 6 || Math.abs(ev.clientY - originY) > 6) moved = true
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) {
        setDraft(draftFromEvent(item))
        return
      }
      const minutes = Math.round((ev.clientY - originY) / HOUR_PX * 60 / 15) * 15
      const dayShift = view === 'week' ? Math.round((ev.clientX - originX) / column) : 0
      const nextStart = new Date(start + minutes * 60_000 + dayShift * 86_400_000)
      const nextEnd = new Date(nextStart.getTime() + duration)
      const attendees = (item.attendees ?? []).map((attendee) => attendee.email)
      const write: CalendarWrite = {
        id: item.id,
        summary: item.summary,
        description: item.description,
        location: item.location,
        startIso: nextStart.toISOString(),
        endIso: nextEnd.toISOString(),
        attendees,
        allDay: false,
        sendUpdates: 'none',
      }
      if (externalGuestEmails(attendees).length) setPending({ write, label: 'Move event' })
      else void commit(write)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const step = view === 'week' ? 7 : view === 'agenda' ? 14 : 1

  return (
    <div className="page cal">
      <header className="cal__hero">
        <div>
          <p className="eyebrow">Joseph@teamcordeira.com</p>
          <h1 className="page-title">Calendar</h1>
          <p className="cal__lede">Day, week, and agenda for Joseph&apos;s Google Calendar. Times are Eastern.</p>
          <p className="cal__clock">{formatNowClock(now)}</p>
          {upcoming && <p className="cal__next">{upcoming}</p>}
        </div>
        <div className="cal__toolbar">
          <div className="cal__views" role="tablist" aria-label="Calendar view">
            {(['day', 'week', 'agenda'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={view === item}
                className={view === item ? 'cal__view cal__view--on' : 'cal__view'}
                onClick={() => {
                  setPickedView(true)
                  setView(item)
                }}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="cal__nav">
            <button type="button" className="btn" onClick={() => setAnchor((date) => addZonedDays(date, -step))}>
              Prev
            </button>
            <button type="button" className="btn" onClick={() => setAnchor(new Date())}>
              Today
            </button>
            <button type="button" className="btn" onClick={() => setAnchor((date) => addZonedDays(date, step))}>
              Next
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setDraft(blankDraft(anchor))}>
              New booking
            </button>
          </div>
        </div>
      </header>
      {data?.google.reconnect && (
        <p className="cal__banner">
          {data.google.needsGmailSend && data.google.canWrite
            ? 'Reconnect Google so Frankie gets a calendar invite. Clients are not emailed.'
            : `Google is connected${data.google.email ? ` as ${data.google.email}` : ''}, but the saved permission cannot edit events.`}
          <a className="btn btn--primary" href={googleConnectUrl()}>Reconnect Google</a>
        </p>
      )}
      {data?.demo && <p className="cal__note">Sample calendar until Google is connected. Changes stay in this browser session.</p>}
      {error && <p className="cal__error">{error}</p>}
      {view === 'agenda' ? (
        <ul className="cal__agenda">
          {events.length === 0 && <li className="cal__empty">Nothing in this range.</li>}
          {events.map((event) => (
            <li key={event.id} className="cal__agenda-item">
              <span className="cal__when">{formatDayLabel(new Date(event.startIso))} · {event.allDay ? 'All day' : formatTimeLabel(new Date(event.startIso))}</span>
              <span className="cal__title"><EventTitle event={event} leads={leads} /></span>
              {event.location && <span className="cal__meta">{event.location}</span>}
              <button type="button" onClick={() => setDraft(draftFromEvent(event))}>Edit</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="cal__scroll" ref={scrollRef}>
          <div className={`cal__grid${view === 'week' ? ' cal__grid--week' : ''}`}>
            <div className="cal__corner" />
            {days.map((day) => {
              const key = dateKey(day)
              const isToday = key === todayKey
              return (
                <h2 key={key} className={isToday ? 'cal__col-label cal__col-label--today' : 'cal__col-label'}>
                  {formatDayLabel(day)}
                </h2>
              )
            })}
            {days.some((day) => events.some((event) => allDayOn(event, dateKey(day)))) && (
              <>
                <div className="cal__allday-gutter">All day</div>
                {days.map((day) => {
                  const key = dateKey(day)
                  const items = events.filter((event) => allDayOn(event, key))
                  return (
                    <div key={`allday-${key}`} className="cal__allday" data-testid="all-day-row">
                      {items.map((event) => (
                        <button key={event.id} type="button" className="cal__allday-event" onClick={() => setDraft(draftFromEvent(event))}>
                          <EventTitle event={event} leads={leads} />
                        </button>
                      ))}
                    </div>
                  )
                })}
              </>
            )}
            <div className="cal__hours" aria-hidden="true">
              {HOURS.map((hour) => (
                <div key={hour} className="cal__hour" style={{ height: HOUR_PX }}>{formatHourLabel(hour)}</div>
              ))}
              {showingToday && <div className="cal__now" style={{ top: nowTop }} />}
            </div>
            {days.map((day) => {
              const key = dateKey(day)
              const isToday = key === todayKey
              const items = events.filter((event) => dateKey(new Date(event.startIso)) === key && !event.allDay)
              return (
                <section key={key} className={isToday ? 'cal__col cal__col--today' : 'cal__col'} aria-label={formatDayLabel(day)} aria-current={isToday ? 'date' : undefined}>
                  <div className="cal__col-body" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                    {showingToday && (
                      <div
                        className={isToday ? 'cal__now cal__now--today' : 'cal__now'}
                        style={{ top: nowTop }}
                        data-testid={isToday ? 'now-line' : undefined}
                      />
                    )}
                    {items.map((event) => {
                      const start = zonedParts(new Date(event.startIso))
                      const end = zonedParts(new Date(event.endIso))
                      const top = (start.hour + start.minute / 60 - HOUR_START) * HOUR_PX
                      const height = Math.max(28, (end.hour + end.minute / 60 - (start.hour + start.minute / 60)) * HOUR_PX)
                      return (
                        <div
                          key={event.id}
                          className="cal__event"
                          style={{ top, height }}
                          onPointerDown={(pointer) => {
                            if ((pointer.target as HTMLElement).closest('a')) return
                            onDrag(event, pointer)
                          }}
                        >
                          <span className="cal__event-time">{formatTimeLabel(new Date(event.startIso))}</span>
                          {' '}
                          <EventTitle event={event} leads={leads} />
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? 'Edit event' : 'New booking'} onClose={() => setDraft(null)} footer={
          <>
            {draft.id && (
              <button type="button" className="btn" onClick={() => {
                const current = events.find((event) => event.id === draft.id)
                if (current) setRemoveId(current)
              }}>
                Delete
              </button>
            )}
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => askOrSave(draft)}>
              {busy ? 'Saving…' : draft.id ? 'Save' : 'Create'}
            </button>
          </>
        }>
          <label className="cal__field">Title
            <input className="input" value={draft.summary} onChange={(e) => {
              const summary = e.target.value
              setDraft((current) => current ? { ...current, summary, autoTitle: false } : current)
            }} />
          </label>
          <div className="cal__times">
            <label className="cal__field">Date
              <input className="input" type="date" value={draft.day} onChange={(e) => {
                const day = e.target.value
                setDraft((current) => current ? { ...current, day, endDay: undefined } : current)
              }} />
            </label>
            <label className="cal__check">
              <input type="checkbox" checked={draft.allDay} onChange={(e) => {
                const allDay = e.target.checked
                setDraft((current) => current ? { ...current, allDay } : current)
              }} />
              All day
            </label>
            {!draft.allDay && (
              <>
                <TimeField label="Start" value={draft.start} onChange={(start) => setDraft((current) => current ? { ...current, start } : current)} />
                <TimeField label="End" value={draft.end} onChange={(end) => setDraft((current) => current ? { ...current, end } : current)} />
              </>
            )}
          </div>
          <label className="cal__field">Location
            <input className="input" value={draft.location} onChange={(e) => {
              const location = e.target.value
              setDraft((current) => current ? { ...current, location } : current)
            }} />
          </label>
          <label className="cal__field">Description
            <textarea className="input" rows={3} value={draft.description} onChange={(e) => {
              const description = e.target.value
              setDraft((current) => current ? { ...current, description } : current)
            }} />
          </label>
          <p className="cal__label">Guests</p>
          <div className="cal__chips">
            {TEAM_GUESTS.map((guest) => {
              const on = draft.attendees.some((email) => email.toLowerCase() === guest.email)
              return (
                <button
                  key={guest.email}
                  type="button"
                  className={on ? 'cal__chip cal__chip--on' : 'cal__chip'}
                  onClick={() => setDraft((current) => {
                    if (!current) return current
                    const onGuest = current.attendees.some((email) => email.toLowerCase() === guest.email)
                    return {
                      ...current,
                      attendees: onGuest ? current.attendees.filter((email) => email.toLowerCase() !== guest.email) : [...current.attendees, guest.email],
                    }
                  })}
                >
                  {guest.name}
                </button>
              )
            })}
          </div>
          <ul className="cal__guest-list">
            {draft.attendees.map((email) => (
              <li key={email}>
                <span>{email}</span>
                <button type="button" className="btn" onClick={() => setDraft((current) => current ? { ...current, attendees: current.attendees.filter((item) => item !== email) } : current)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <label className="cal__field">Follow Up Boss lead
            <input className="input" value={query} placeholder="Search a client" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="cal__field">Topic
            <input className="input" value={draft.topic} placeholder="refi" onChange={(e) => {
              const topic = e.target.value
              setDraft((current) => current ? {
                ...current,
                topic,
                summary: current.autoTitle && current.summary ? clientCallTitle(current.summary.split(' call ')[0] || current.summary, topic) : current.summary,
              } : current)
            }} />
          </label>
          {people.length > 0 && (
            <ul className="cal__people">
              {people.map((person) => (
                <li key={person.id}>
                  <button type="button" className="cal__person" onClick={() => {
                    const email = person.email
                    setDraft((current) => {
                      if (!current) return current
                      const attendees = email && !current.attendees.some((item) => item.toLowerCase() === email.toLowerCase())
                        ? [...current.attendees, email]
                        : current.attendees
                      return {
                        ...current,
                        attendees,
                        autoTitle: true,
                        summary: clientCallTitle(person.name, current.topic),
                      }
                    })
                    setQuery(person.name)
                    setPeople([])
                  }}>
                    {person.name}{person.email ? ` · ${person.email}` : ' · no email'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {pending && (
        <Modal title="Notify guests?" onClose={() => setPending(null)} footer={
          <>
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void commit({ ...pending.write, sendUpdates: 'none' })}>Don&apos;t notify</button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void commit({ ...pending.write, sendUpdates: 'all' })}>{pending.label} and notify</button>
          </>
        }>
          <p>This event has guests outside your calendar. Google can email them the change, or save it quietly.</p>
        </Modal>
      )}

      {removeId && (
        <Modal title="Delete this event?" onClose={() => setRemoveId(null)} footer={
          <>
            <button type="button" className="btn" onClick={() => setRemoveId(null)}>Cancel</button>
            {externalGuestEmails((removeId.attendees ?? []).map((attendee) => attendee.email)).length > 0 ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void erase('none')}>Delete quietly</button>
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void erase('all')}>Delete and notify</button>
              </>
            ) : (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void erase('none')}>Delete</button>
            )}
          </>
        }>
          <p>{removeId.summary}</p>
        </Modal>
      )}
    </div>
  )

  async function erase(sendUpdates: 'all' | 'none') {
    if (!removeId) return
    setBusy(true)
    try {
      await deleteHubCalendarEvent(removeId.id, sendUpdates)
      setRemoveId(null)
      setDraft(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event')
    } finally {
      setBusy(false)
    }
  }
}
