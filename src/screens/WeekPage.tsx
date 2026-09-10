import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { HOST_ID } from '../data/fixtures'
import { AddTaskModal } from '../components/AddTaskModal'
import { Modal } from '../components/Modal'
import { useMediaQuery } from '../lib/useMediaQuery'
import { DOW, addDays, dayLabel, fmtShort, keyToDate, span, startOfWeek, todayKey, weekRangeLabel } from '../lib/time'
import { firstName } from '../lib/people'
import type { CalendarEvent } from '../lib/types'
import './WeekPage.css'

const HOUR_START = 8
const HOUR_END = 18
const ROW = 56
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

export function WeekPage() {
  const { state, dispatch } = useStore()
  const [params, setParams] = useSearchParams()
  const isMobile = useMediaQuery('(max-width: 760px)')

  const userId = params.get('user') ?? HOST_ID
  const user = state.team.find((m) => m.id === userId) ?? state.team[0]
  const isSelf = user.id === HOST_ID

  const today = todayKey()
  const thisMonday = startOfWeek(today)
  const [offset, setOffset] = useState(0)
  const monday = addDays(thisMonday, offset * 7)
  const [mobileDay, setMobileDay] = useState(() => (keyToDate(today).getDay() + 6) % 7)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<CalendarEvent | null>(null)

  const columns = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const key = addDays(monday, i)
        const events = state.events
          .filter((e) => e.userId === user.id && e.dateKey === key)
          .sort((a, b) => a.start - b.start)
        return {
          key,
          dow: DOW[i],
          n: keyToDate(key).getDate(),
          isToday: key === today,
          weekend: i > 4,
          allDay: events.filter((e) => e.allDay),
          timed: events.filter((e) => !e.allDay),
        }
      }),
    [monday, state.events, user.id, today],
  )

  const weekEvents = columns.flatMap((c) => [...c.allDay, ...c.timed])
  const clientCalls = weekEvents.filter((e) => e.kind === 'client').length
  const teamTasks = weekEvents.filter((e) => e.kind === 'task').length
  const summary =
    weekEvents.length === 0
      ? 'Nothing scheduled yet'
      : `${weekEvents.length} ${plural(weekEvents.length, 'event')} · ${clientCalls} client ${plural(clientCalls, 'call')} · ${teamTasks} ${plural(teamTasks, 'task')} booked by team`

  const visibleColumns = isMobile ? [columns[mobileDay]] : columns

  const remove = (e: CalendarEvent) => {
    dispatch({ type: 'event/remove', id: e.id })
    setOpen(null)
  }

  return (
    <div className="page">
      {!isSelf && (
        <div className="week__viewing">
          <span className="eyebrow">Viewing</span>
          <span>{user.name}'s week</span>
          <button type="button" className="week__viewing-back" onClick={() => setParams({})}>Back to my week</button>
        </div>
      )}
      <div className="week__toolbar">
        <div>
          <h1 className="page-title">{weekRangeLabel(monday)}</h1>
          <div className="page-subtitle">{summary}</div>
        </div>
        <div className="week__controls">
          <button type="button" className="btn btn--icon" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">‹</button>
          <button type="button" className="btn" onClick={() => setOffset(0)} disabled={offset === 0}>Today</button>
          <button type="button" className="btn btn--icon" onClick={() => setOffset((o) => o + 1)} aria-label="Next week">›</button>
          <button type="button" className="btn btn--primary week__add" onClick={() => setAdding(true)}>
            {isSelf ? 'Add task' : `Book for ${firstName(user.name)}`}
          </button>
        </div>
      </div>

      {isMobile && (
        <div className="week__daytabs" role="tablist" aria-label="Day">
          {columns.map((c, i) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={i === mobileDay}
              className={`week__daytab${i === mobileDay ? ' week__daytab--on' : ''}${c.isToday ? ' week__daytab--today' : ''}`}
              onClick={() => setMobileDay(i)}
            >
              <span className="mono week__daytab-dow">{c.dow}</span>
              <span className="week__daytab-n">{c.n}</span>
              {(c.timed.length + c.allDay.length) > 0 && <span className="week__daytab-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      <div className={`week card${isMobile ? ' week--single' : ''}`}>
        <div className="week__head" role="row">
          <div className="week__axis-head" />
          {visibleColumns.map((c) => (
            <div key={c.key} className={`week__dayhead${c.isToday ? ' week__dayhead--today' : c.weekend ? ' week__dayhead--weekend' : ''}`}>
              <div className="mono week__dow">{c.dow}</div>
              <div className="week__n">{c.n}</div>
              {c.allDay.map((e) => (
                <button key={e.id} type="button" className={`week__allday week__allday--${e.kind}`} onClick={() => setOpen(e)} title={e.title}>
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="week__body">
          <div className="week__axis">
            {HOURS.map((h) => (
              <div key={h} className="mono week__hour">{fmtShort(h)}</div>
            ))}
          </div>
          {visibleColumns.map((c) => (
            <div key={c.key} className={`week__col${c.weekend ? ' week__col--weekend' : ''}`}>
              {HOURS.map((h) => <div key={h} className="week__cell" />)}
              {layoutColumn(c.timed).map(({ event: e, lane, lanes }) => {
                const start = Math.max(e.start, HOUR_START)
                const end = Math.min(e.end, HOUR_END + 1)
                if (end <= start) return null
                const dur = end - start
                const showTime = e.end - e.start >= 0.75
                const title = showTime ? e.title : `${fmtShort(e.start)}  ${e.title}`
                const width = 100 / lanes
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`ev ev--${e.kind}`}
                    style={{
                      top: (start - HOUR_START) * ROW,
                      height: dur * ROW - 3,
                      left: lanes === 1 ? 3 : `calc(${lane * width}% + 3px)`,
                      right: lanes === 1 ? 3 : undefined,
                      width: lanes === 1 ? undefined : `calc(${width}% - ${lane === lanes - 1 ? 6 : 4}px)`,
                    }}
                    onClick={() => setOpen(e)}
                    title={`${e.title} · ${span(e.start, e.end)}`}
                  >
                    <span className={`ev__title${showTime ? '' : ' ev__title--nowrap'}`}>{title}</span>
                    {showTime && <span className="mono ev__time">{span(e.start, e.end)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="legend week__legend">
        <span className="legend__item"><span className="swatch" style={{ background: 'var(--ink)' }} />Client call</span>
        <span className="legend__item"><span className="swatch" style={{ background: 'var(--amber-edge)' }} />Task from team</span>
        <span className="legend__item"><span className="swatch" style={{ background: 'var(--text-muted)' }} />Synced from Google / Outlook</span>
      </div>

      {adding && (
        <AddTaskModal forUserId={user.id} defaultDate={offset === 0 ? today : monday} onClose={() => setAdding(false)} />
      )}

      {open && (
        <Modal
          title={open.title}
          onClose={() => setOpen(null)}
          footer={
            <>
              {open.kind !== 'synced' && (
                <button type="button" className="btn btn--muted week__remove" onClick={() => remove(open)}>Remove</button>
              )}
              <button type="button" className="btn" onClick={() => setOpen(null)}>Close</button>
            </>
          }
        >
          <div className="week__detail">
            <div className="week__detail-row"><span>When</span><span className="mono">{dayLabel(open.dateKey)} · {open.allDay ? 'All day' : span(open.start, open.end)}</span></div>
            <div className="week__detail-row"><span>Kind</span><span>{kindLabel(open, state.team)}</span></div>
            <div className="week__detail-row"><span>Calendar</span><span>{user.name}</span></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface Placed {
  event: CalendarEvent
  lane: number
  lanes: number
}

/**
 * Side-by-side layout for overlapping events: events are grouped into clusters
 * of mutual overlap, assigned the first free lane, and every event in a cluster
 * shares the cluster's lane count.
 */
export function layoutColumn(events: CalendarEvent[]): Placed[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed[] = []
  let cluster: { placed: Placed[]; laneEnds: number[]; end: number } | null = null
  const flush = () => {
    if (!cluster) return
    const lanes = cluster.laneEnds.length
    for (const p of cluster.placed) p.lanes = lanes
    out.push(...cluster.placed)
    cluster = null
  }
  for (const e of sorted) {
    if (!cluster || e.start >= cluster.end - 1e-6) {
      flush()
      cluster = { placed: [], laneEnds: [], end: e.end }
    }
    let lane = cluster.laneEnds.findIndex((end) => end <= e.start + 1e-6)
    if (lane === -1) {
      lane = cluster.laneEnds.length
      cluster.laneEnds.push(e.end)
    } else {
      cluster.laneEnds[lane] = e.end
    }
    cluster.end = Math.max(cluster.end, e.end)
    cluster.placed.push({ event: e, lane, lanes: 1 })
  }
  flush()
  return out
}

function kindLabel(e: CalendarEvent, team: { id: string; name: string }[]): string {
  if (e.kind === 'client') return 'Client call'
  if (e.kind === 'task') {
    const by = team.find((m) => m.id === e.createdBy)
    return by ? `Task booked by ${by.name}` : 'Task'
  }
  const src = e.source === 'google' ? 'Google Calendar' : e.source === 'outlook' ? 'Outlook Calendar' : e.source === 'icloud' ? 'iCloud Calendar' : 'an external calendar'
  return `Synced from ${src}`
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

