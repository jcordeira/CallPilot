import { useEffect, useId, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore, newId } from '../state/store'
import { useTimeZone } from '../state/timezone'
import { CALL_TYPES, HOST_ID, ZONES } from '../data/fixtures'
import { busyFromEvents, clientCallsOn, slotsFor, type AvailabilityRules } from '../lib/availability'
import { DOW, addDays, dayLabel, fmt, hostSlotInZone, monthLabel, parseKey, toKey, todayKey } from '../lib/time'
import { initials, isEmail } from '../lib/people'
import type { Booking, CalendarEvent, CallType } from '../lib/types'
import './BookingPage.css'

type Step = 'pick' | 'details' | 'confirmed'

interface Details {
  name: string
  email: string
  guests: string
  notes: string
}

const EMPTY_DETAILS: Details = { name: '', email: '', guests: '', notes: '' }

export function BookingPage() {
  const { hostId } = useParams()
  const { state, dispatch } = useStore()
  const { tz, setTz, zoneLong, zoneShort } = useTimeZone()

  const host = state.team.find((m) => m.id === (hostId ?? HOST_ID)) ?? state.team[0]
  const rules = useMemo<AvailabilityRules>(
    () => ({
      workingHours: host.hours,
      bufferMinutes: state.settings.bufferMinutes,
      breaks: state.settings.breaks,
      minNoticeHours: state.settings.minNoticeHours,
      maxCallsPerDay: state.settings.maxCallsPerDay,
    }),
    [host.hours, state.settings],
  )
  const hostEvents = useMemo(() => state.events.filter((e) => e.userId === host.id), [state.events, host.id])
  const busy = useMemo(() => busyFromEvents(hostEvents, host.hours), [hostEvents, host.hours])

  const today = todayKey()
  const [typeId, setTypeId] = useState(CALL_TYPES[0].id)
  const type: CallType = CALL_TYPES.find((t) => t.id === typeId) ?? CALL_TYPES[0]

  const slotsOn = (key: string) =>
    slotsFor({ dateKey: key, durationMinutes: type.durationMinutes, rules, busy, clientCallsToday: clientCallsOn(hostEvents, key) })

  // First open day from today, used for the initial selection.
  const firstOpen = useMemo(() => {
    let key = today
    for (let i = 0; i < 60; i++) {
      if (slotsOn(key).length > 0) return key
      key = addDays(key, 1)
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, type.durationMinutes, rules, busy, hostEvents])

  const [sel, setSel] = useState<string | null>(null)
  const [{ y, m0 }, setMonth] = useState(() => {
    const k = parseKey(today)
    return { y: k.y, m0: k.m0 }
  })
  const [slot, setSlot] = useState<number | null>(null)
  const [step, setStep] = useState<Step>('pick')
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({})
  const [lastBooking, setLastBooking] = useState<Booking | null>(null)
  const fid = useId()

  // Seed the selection with the first open day the first time we know it.
  useEffect(() => {
    if (sel === null && firstOpen) {
      setSel(firstOpen)
      const k = parseKey(firstOpen)
      setMonth({ y: k.y, m0: k.m0 })
    }
  }, [firstOpen, sel])

  const pickType = (id: string) => {
    setTypeId(id)
    setSlot(null)
  }
  const pickDay = (key: string) => {
    setSel(key)
    setSlot(null)
  }
  const changeTz = (next: string) => {
    setTz(next)
    setSlot(null)
  }
  const prevMonth = () => setMonth((p) => (p.m0 === 0 ? { y: p.y - 1, m0: 11 } : { y: p.y, m0: p.m0 - 1 }))
  const nextMonth = () => setMonth((p) => (p.m0 === 11 ? { y: p.y + 1, m0: 0 } : { y: p.y, m0: p.m0 + 1 }))

  // Month grid
  const lead = (new Date(y, m0, 1).getDay() + 6) % 7
  const total = new Date(y, m0 + 1, 0).getDate()
  const days = useMemo(() => {
    const out: { key: string; n: number; open: boolean }[] = []
    for (let n = 1; n <= total; n++) {
      const key = toKey(y, m0, n)
      const open = key >= today && slotsOn(key).length > 0
      out.push({ key, n, open })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, m0, total, today, type.durationMinutes, rules, busy, hostEvents])
  const anyOpenThisMonth = days.some((d) => d.open)

  const slotList = sel ? slotsOn(sel) : []
  const slotView = slotList.map((h) => {
    const z = hostSlotInZone(sel!, h, tz)
    return { h, label: fmt(z.hour), dayShift: z.key === sel ? 0 : z.key > sel! ? 1 : -1 }
  })
  const selected = slotView.find((s) => s.h === slot) ?? null

  // Details form
  const validate = (): boolean => {
    const next: Partial<Record<keyof Details, string>> = {}
    if (!details.name.trim()) next.name = 'Enter your name.'
    if (!isEmail(details.email)) next.email = 'Enter a valid email address.'
    const guests = splitEmails(details.guests)
    if (guests.some((g) => !isEmail(g))) next.guests = 'One of the guest emails looks wrong.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const confirm = () => {
    if (!sel || slot === null || !validate()) return
    const end = slot + type.durationMinutes / 60
    const booking: Booking = {
      id: newId('bk'),
      callTypeId: type.id,
      hostId: host.id,
      dateKey: sel,
      start: slot,
      end,
      clientName: details.name.trim(),
      clientEmail: details.email.trim(),
      guests: splitEmails(details.guests),
      notes: details.notes.trim(),
      timeZone: tz,
      createdAt: new Date().toISOString(),
    }
    const event: CalendarEvent = {
      id: newId('ev'),
      userId: host.id,
      dateKey: sel,
      start: slot,
      end,
      title: `${shortTypeName(type.name)} — ${shortClientName(details.name)}`,
      kind: 'client',
    }
    dispatch({ type: 'booking/add', booking, event })
    setLastBooking(booking)
    setStep('confirmed')
  }

  const reset = () => {
    setStep('pick')
    setSlot(null)
    setDetails(EMPTY_DETAILS)
    setErrors({})
  }

  const confirmedWhen = lastBooking
    ? (() => {
        const z = hostSlotInZone(lastBooking.dateKey, lastBooking.start, tz)
        return `${dayLabel(z.key)} · ${fmt(z.hour)}`
      })()
    : ''

  return (
    <div className="page page--book">
      <div className="eyebrow-row">
        <span className="eyebrow eyebrow--wide">Client view</span>
        <span className="eyebrow-row__rule" />
      </div>

      <div className="book">
        {/* Left rail */}
        <aside className="book__rail">
          <div className="book__avatar" aria-hidden="true">{initials(host.name)}</div>
          <div className="book__host">{host.name}</div>
          <h1 className="book__type">{type.name}</h1>

          <div className="book__meta">
            <div className="book__meta-row"><span className="book__glyph" aria-hidden="true">◷</span>{type.durationMinutes} min</div>
            <div className="book__meta-row"><span className="book__glyph" aria-hidden="true">▢</span>{type.location}</div>
            <div className="book__meta-row"><span className="book__glyph" aria-hidden="true">◇</span>{type.note}</div>
          </div>

          <div className="eyebrow book__label">Choose a call</div>
          <div className="book__types" role="radiogroup" aria-label="Call type">
            {CALL_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === type.id}
                className={`typebtn${t.id === type.id ? ' typebtn--selected' : ''}`}
                onClick={() => pickType(t.id)}
                disabled={step === 'confirmed'}
              >
                <span className="typebtn__name">{t.name}</span>
                <span className="typebtn__dur mono">{t.durationMinutes} min</span>
              </button>
            ))}
          </div>

          <label className="eyebrow book__label" htmlFor="tz-select">Time zone</label>
          <select id="tz-select" className="select" value={tz} onChange={(e) => changeTz(e.target.value)}>
            {ZONES.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </select>
          <div className="book__tzhint">Times shown in {zoneLong}. Defaults to Eastern.</div>
        </aside>

        {/* Right pane */}
        <section className="book__pane" aria-live="polite">
          {step === 'confirmed' && lastBooking ? (
            <div className="confirmed">
              <div className="confirmed__check" aria-hidden="true">✓</div>
              <h2 className="confirmed__title">You're booked</h2>
              <p className="confirmed__body">
                A confirmation and calendar invite are on the way to {lastBooking.clientEmail}. We'll email a reminder 24 hours and 1 hour before.
              </p>
              <div className="confirmed__card">
                <div className="confirmed__row"><span>Call</span><span>{type.name}</span></div>
                <div className="confirmed__row"><span>When</span><span className="mono confirmed__mono">{confirmedWhen}</span></div>
                <div className="confirmed__row"><span>Zone</span><span className="mono confirmed__mono">{zoneShort}</span></div>
                <div className="confirmed__row"><span>Where</span><span>{type.location}</span></div>
                <div className="confirmed__row"><span>With</span><span>{host.name}</span></div>
              </div>
              <button type="button" className="btn btn--muted confirmed__again" onClick={reset}>Book another time</button>
            </div>
          ) : step === 'details' && sel && selected ? (
            <div className="details">
              <button type="button" className="details__back" onClick={() => setStep('pick')}>‹ Back to times</button>
              <h2 className="details__title">Your details</h2>
              <div className="details__when mono">{dayLabel(sel)} · {selected.label} · {type.durationMinutes} min · {zoneShort}</div>
              <form
                className="details__form"
                onSubmit={(e) => {
                  e.preventDefault()
                  confirm()
                }}
                noValidate
              >
                <div className="field">
                  <label className="field__label" htmlFor={`${fid}-name`}>Name</label>
                  <input
                    id={`${fid}-name`}
                    className={`input${errors.name ? ' input--error' : ''}`}
                    value={details.name}
                    onChange={(e) => setDetails({ ...details, name: e.target.value })}
                    autoComplete="name"
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? `${fid}-name-err` : undefined}
                  />
                  {errors.name && <span className="field__error" id={`${fid}-name-err`}>{errors.name}</span>}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${fid}-email`}>Email</label>
                  <input
                    id={`${fid}-email`}
                    className={`input${errors.email ? ' input--error' : ''}`}
                    type="email"
                    value={details.email}
                    onChange={(e) => setDetails({ ...details, email: e.target.value })}
                    autoComplete="email"
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? `${fid}-email-err` : undefined}
                  />
                  {errors.email && <span className="field__error" id={`${fid}-email-err`}>{errors.email}</span>}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${fid}-guests`}>Guests <span className="details__optional">(optional)</span></label>
                  <input
                    id={`${fid}-guests`}
                    className={`input${errors.guests ? ' input--error' : ''}`}
                    value={details.guests}
                    onChange={(e) => setDetails({ ...details, guests: e.target.value })}
                    placeholder="Emails, separated by commas"
                    aria-invalid={!!errors.guests}
                    aria-describedby={`${fid}-guests-hint`}
                  />
                  {errors.guests ? <span className="field__error" id={`${fid}-guests-hint`}>{errors.guests}</span> : <span className="field__hint" id={`${fid}-guests-hint`}>Guests get the invite and the reminders too.</span>}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${fid}-notes`}>Anything we should know? <span className="details__optional">(optional)</span></label>
                  <textarea
                    id={`${fid}-notes`}
                    className="input details__notes"
                    rows={3}
                    value={details.notes}
                    onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn btn--primary details__submit">Confirm booking</button>
              </form>
            </div>
          ) : (
            <div className="picker">
              <div className="picker__calendar">
                <div className="cal__head">
                  <h2 className="cal__month">{monthLabel(y, m0)}</h2>
                  <div className="cal__nav">
                    <button type="button" className="cal__navbtn" onClick={prevMonth} aria-label="Previous month">‹</button>
                    <button type="button" className="cal__navbtn" onClick={nextMonth} aria-label="Next month">›</button>
                  </div>
                </div>
                <div className="cal__dow" aria-hidden="true">
                  {DOW.map((d) => <div key={d} className="cal__dowlabel mono">{d}</div>)}
                </div>
                <div className="cal__grid" role="grid" aria-label={monthLabel(y, m0)}>
                  {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} className="cal__blank" />)}
                  {days.map((d) => {
                    const isSel = d.key === sel
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={`cal__day${isSel ? ' cal__day--selected' : d.open ? ' cal__day--open' : ' cal__day--off'}`}
                        disabled={!d.open}
                        aria-pressed={isSel}
                        aria-label={`${dayLabel(d.key)}${d.open ? '' : ', unavailable'}`}
                        onClick={() => pickDay(d.key)}
                      >
                        {d.n}
                      </button>
                    )
                  })}
                </div>
                {!anyOpenThisMonth && (
                  <div className="cal__empty">Nothing open in {monthLabel(y, m0)}. Try the next month.</div>
                )}
                <div className="legend cal__legend">
                  <span className="legend__item"><span className="swatch swatch--open" />Open</span>
                  <span className="legend__item"><span className="swatch swatch--selected" />Selected</span>
                  <span className="legend__item"><span className="swatch swatch--off" />Booked out</span>
                </div>
              </div>

              <div className="slots">
                {sel ? (
                  <>
                    <div className="slots__day">{dayLabel(sel)}</div>
                    <div className="slots__count mono">{slotList.length} open · {type.durationMinutes} min</div>
                    {slotView.length === 0 ? (
                      <div className="slots__empty">No open times on this day. Pick another day.</div>
                    ) : (
                      <div className="slots__list" role="listbox" aria-label="Available times">
                        {slotView.map((s) => (
                          <button
                            key={s.h}
                            type="button"
                            role="option"
                            aria-selected={s.h === slot}
                            className={`slot mono${s.h === slot ? ' slot--selected' : ''}`}
                            onClick={() => setSlot(s.h)}
                          >
                            {s.label}
                            {s.dayShift !== 0 && <span className="slot__shift">{s.dayShift > 0 ? '+1d' : '−1d'}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {selected && (
                      <button type="button" className="slots__confirm" onClick={() => setStep('details')}>
                        Confirm {selected.label}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="slots__empty">
                    <div className="empty__title">No open days</div>
                    Nothing is bookable in the next two months. Check back soon.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function splitEmails(s: string): string[] {
  return s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
}

/** "Intro Call" → "Intro"; "Strategy Session" → "Strategy"; "Deep Dive" → "Deep Dive" */
function shortTypeName(name: string): string {
  return name.replace(/\s+(Call|Session|Meeting)$/i, '')
}

/** "Jordan Alvarez" → "J. Alvarez" */
function shortClientName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`
}

export { shortClientName, shortTypeName, splitEmails }
