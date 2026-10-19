import { useEffect, useRef, useState } from 'react'
import { FubPersonLink } from './FubPersonLink'
import {
  completeGlanceTask,
  fetchGlanceDetail,
  googleConnectUrl,
  undoGlanceTask,
  type GlanceDetail,
  type GlanceItem,
} from '../lib/hubApi'
import { dayLabel } from '../lib/time'

const TODAY_LIMIT = 10
const FADE_MS = 420
const UNDO_MS = 5_000

type KindFilter = 'all' | 'tasks' | 'appointments'
type SourceFilter = 'all' | 'google' | 'fub'

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'appointments', label: 'Appointments' },
]

const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'All sources' },
  { id: 'google', label: 'Google' },
  { id: 'fub', label: 'FUB' },
]

function passes(item: GlanceItem, kind: KindFilter, source: SourceFilter): boolean {
  if (kind === 'tasks' && item.kind !== 'task') return false
  if (kind === 'appointments' && item.kind !== 'appointment') return false
  if (source === 'fub' && item.source !== 'fub') return false
  if (source === 'google' && item.source !== 'google') return false
  return true
}

type Flight = {
  item: GlanceItem
  removed: boolean
  undo: boolean
  undoSent: boolean
  settled: 'pending' | 'done' | 'failed'
  removeTimer: number
  toastTimer: number
}

function dayHeading(dayKey: string, todayKey?: string): string {
  if (dayKey === 'none') return 'No due date'
  if (todayKey && dayKey === todayKey) return 'Today'
  return dayLabel(dayKey)
}

export function GlanceSection({
  title,
  headingId,
  mode,
  items,
  warnings,
  needsTasks,
  error,
  loading,
  todayKey,
  onDone,
  onRestore,
}: {
  title: string
  headingId: string
  mode: 'today' | 'all'
  items: GlanceItem[]
  warnings: string[]
  needsTasks: boolean
  error: string | null
  loading: boolean
  todayKey?: string
  onDone: (item: GlanceItem) => void
  onRestore: (item: GlanceItem) => void
}) {
  const [kind, setKind] = useState<KindFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [showAll, setShowAll] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, GlanceDetail>>({})
  const [detailError, setDetailError] = useState<Record<string, string>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const [olderOpen, setOlderOpen] = useState<Record<string, boolean>>({})
  const [leaving, setLeaving] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<GlanceItem[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const flights = useRef(new Map<string, Flight>())

  const visible = mode === 'all' ? items.filter((item) => passes(item, kind, source)) : items
  const listed = mode === 'today' && !showAll ? visible.slice(0, TODAY_LIMIT) : visible
  const groups = mode === 'all' ? groupItems(listed, todayKey) : [{ key: 'today', label: '', items: listed }]

  useEffect(() => {
    const active = flights.current
    return () => {
      for (const flight of active.values()) {
        window.clearTimeout(flight.removeTimer)
        window.clearTimeout(flight.toastTimer)
      }
    }
  }, [])

  const toggle = (item: GlanceItem) => {
    if (openKey === item.key) {
      setOpenKey(null)
      return
    }
    setOpenKey(item.key)
    if (details[item.key] || loadingKey === item.key) return
    setLoadingKey(item.key)
    void fetchGlanceDetail(item)
      .then((detail) => {
        setDetails((prev) => ({ ...prev, [item.key]: detail }))
        setDetailError((prev) => {
          const next = { ...prev }
          delete next[item.key]
          return next
        })
      })
      .catch((err: unknown) => {
        setDetailError((prev) => ({ ...prev, [item.key]: err instanceof Error ? err.message : 'Could not load details' }))
      })
      .finally(() => setLoadingKey((current) => (current === item.key ? null : current)))
  }

  const failComplete = (item: GlanceItem, flight: Flight, message: string) => {
    window.clearTimeout(flight.removeTimer)
    window.clearTimeout(flight.toastTimer)
    flights.current.delete(item.key)
    setLeaving((prev) => {
      const next = { ...prev }
      delete next[item.key]
      return next
    })
    setToasts((prev) => prev.filter((toast) => toast.key !== item.key))
    if (flight.removed) onRestore(item)
    setActionError(message)
  }

  const startComplete = (item: GlanceItem) => {
    if (item.kind !== 'task' || flights.current.has(item.key)) return
    const flight: Flight = { item, removed: false, undo: false, undoSent: false, settled: 'pending', removeTimer: 0, toastTimer: 0 }
    flights.current.set(item.key, flight)
    setActionError(null)
    setLeaving((prev) => ({ ...prev, [item.key]: true }))
    setToasts((prev) => [...prev.filter((toast) => toast.key !== item.key), item])
    if (openKey === item.key) setOpenKey(null)
    flight.removeTimer = window.setTimeout(() => {
      flight.removed = true
      onDone(item)
    }, FADE_MS)
    flight.toastTimer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.key !== item.key))
      if (flight.settled !== 'pending') flights.current.delete(item.key)
    }, UNDO_MS)

    void (async () => {
      try {
        await completeGlanceTask(item.source, item.id)
      } catch (err: unknown) {
        flight.settled = 'failed'
        failComplete(item, flight, err instanceof Error ? err.message : 'Could not complete this task')
        return
      }
      flight.settled = 'done'
      if (!flight.undo || flight.undoSent) return
      flight.undoSent = true
      try {
        await undoGlanceTask(item.source, item.id)
      } catch (err: unknown) {
        onDone(item)
        setActionError(err instanceof Error ? err.message : 'Could not undo')
      }
    })()
  }

  const undo = (item: GlanceItem) => {
    const flight = flights.current.get(item.key)
    if (!flight || flight.settled === 'failed') return
    flight.undo = true
    window.clearTimeout(flight.removeTimer)
    window.clearTimeout(flight.toastTimer)
    setLeaving((prev) => {
      const next = { ...prev }
      delete next[item.key]
      return next
    })
    setToasts((prev) => prev.filter((toast) => toast.key !== item.key))
    if (flight.removed) onRestore(item)
    if (flight.settled === 'done' && !flight.undoSent) {
      flight.undoSent = true
      void undoGlanceTask(item.source, item.id).catch((err: unknown) => {
        onDone(item)
        setActionError(err instanceof Error ? err.message : 'Could not undo')
      })
      flights.current.delete(item.key)
    }
  }

  return (
    <section className="card glance" aria-labelledby={headingId}>
      <div className="hub__card-head">
        <h2 id={headingId}>{title}</h2>
        <span className="mono hub__count">{loading ? '…' : visible.length}</span>
      </div>
      {error ? <p className="hub__error glance__banner">{error}</p> : null}
      {warnings.map((warning) => (
        <p key={warning} className="hub__error glance__banner">
          {warning}
        </p>
      ))}
      {needsTasks ? (
        <div className="glance__reconnect">
          <span>Google Tasks needs a fresh consent.</span>
          <a className="btn btn--primary" href={googleConnectUrl()}>
            Reconnect Google
          </a>
        </div>
      ) : null}
      {mode === 'all' ? (
        <div className="glance__filters">
          <div className="glance__filter-row" role="group" aria-label="Kind">
            {KIND_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={kind === filter.id ? 'glance__chip glance__chip--on' : 'glance__chip'}
                aria-pressed={kind === filter.id}
                onClick={() => setKind(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="glance__filter-row" role="group" aria-label="Source">
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={source === filter.id ? 'glance__chip glance__chip--on' : 'glance__chip'}
                aria-pressed={source === filter.id}
                onClick={() => setSource(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {loading ? <p className="hub__empty">Loading…</p> : null}
      {!loading && !error && visible.length === 0 ? (
        <p className="hub__empty">{mode === 'today' ? 'Nothing due today.' : 'Nothing matches these filters.'}</p>
      ) : null}
      {groups.map((group) => (
        <div key={group.key}>
          {group.label ? <h3 className="hub__subhead">{group.label}</h3> : null}
          <ul className="hub__list">
            {group.items.map((item) => {
              const open = openKey === item.key
              const detail = details[item.key]
              return (
                <li key={item.key} className={leaving[item.key] ? 'glance__item glance__item--leaving' : 'glance__item'}>
                  <div className="glance__line">
                    {item.kind === 'task' ? (
                      <label className="glance__check">
                        <input
                          type="checkbox"
                          checked={leaving[item.key] === true}
                          aria-label={`Complete ${item.title}`}
                          onChange={() => startComplete(item)}
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="glance__hit"
                      aria-expanded={open}
                      onClick={() => toggle(item)}
                    >
                      <span className="glance__title">{item.title}</span>
                      <span className="glance__when">{item.whenLabel}</span>
                      {item.overdue ? <span className="glance__badge">Overdue</span> : null}
                    </button>
                    {item.personName ? (
                      <FubPersonLink className="glance__lead" personId={item.personId}>
                        {item.personName}
                      </FubPersonLink>
                    ) : null}
                  </div>
                  {open ? (
                    <GlanceDetailPanel
                      item={item}
                      detail={detail}
                      loading={loadingKey === item.key && !detail}
                      error={detailError[item.key]}
                      older={olderOpen[item.key] === true}
                      noteOpen={noteOpen}
                      onToggleNote={(id) => setNoteOpen((prev) => ({ ...prev, [id]: !prev[id] }))}
                      onOlder={() => setOlderOpen((prev) => ({ ...prev, [item.key]: true }))}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {mode === 'today' && visible.length > TODAY_LIMIT ? (
        <div className="glance__expand">
          <button type="button" className="glance__more" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
            {showAll ? 'Show less' : `Show all (${visible.length})`}
          </button>
        </div>
      ) : null}
      <div className="glance__toasts">
        {toasts.map((toast) => (
          <div key={toast.key} className="glance__toast" role="status">
            <span>{toast.title} completed</span>
            <button type="button" onClick={() => undo(toast)}>
              Undo
            </button>
          </div>
        ))}
        {actionError ? (
          <p className="glance__toast glance__toast--error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function groupItems(items: GlanceItem[], todayKey?: string): { key: string; label: string; items: GlanceItem[] }[] {
  const groups: { key: string; label: string; items: GlanceItem[] }[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (!last || last.key !== item.dayKey) groups.push({ key: item.dayKey, label: dayHeading(item.dayKey, todayKey), items: [item] })
    else last.items.push(item)
  }
  return groups
}

function GlanceDetailPanel({
  item,
  detail,
  loading,
  error,
  older,
  noteOpen,
  onToggleNote,
  onOlder,
}: {
  item: GlanceItem
  detail?: GlanceDetail
  loading: boolean
  error?: string
  older: boolean
  noteOpen: Record<string, boolean>
  onToggleNote: (id: string) => void
  onOlder: () => void
}) {
  const notes = detail?.personNotes ?? []
  const shown = older ? notes : notes.slice(0, 2)
  const empty = !loading && !error && detail && !detail.description && !detail.notes && !detail.location && !(detail.attendees?.length) && !detail.meetLink && !notes.length && !detail.notesError
  return (
    <div className="glance__detail">
      {loading ? <p className="hub__item-meta">Loading details…</p> : null}
      {error ? <p className="hub__error glance__banner">{error}</p> : null}
      {detail?.description ? <p className="glance__copy">{detail.description}</p> : null}
      {detail?.notes ? <p className="glance__copy">{detail.notes}</p> : null}
      {detail?.location ? <p className="hub__item-meta">Location: {detail.location}</p> : null}
      {detail?.attendees?.length ? (
        <p className="hub__item-meta">With {detail.attendees.map((attendee) => attendee.label).join(', ')}</p>
      ) : null}
      {detail?.meetLink ? (
        <p className="hub__item-meta">
          <a href={detail.meetLink} target="_blank" rel="noreferrer">
            Join Meet
          </a>
        </p>
      ) : null}
      {detail?.htmlLink ? (
        <p className="hub__item-meta">
          <a href={detail.htmlLink} target="_blank" rel="noreferrer">
            Open in Google Calendar
          </a>
        </p>
      ) : null}
      {notes.length ? (
        <div className="glance__notes">
          <p className="glance__notes-label">Recent notes</p>
          <ul className="glance__note-list">
            {shown.map((note) => {
              const expanded = noteOpen[`${item.key}:${note.id}`] === true
              return (
                <li key={note.id}>
                  <p className="glance__note-title">{note.headline}</p>
                  {note.body && (!note.long || expanded) ? <p className="glance__copy">{note.body}</p> : null}
                  {note.long ? (
                    <button type="button" className="glance__more" onClick={() => onToggleNote(`${item.key}:${note.id}`)}>
                      {expanded ? 'Show less' : 'Show more'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {!older && notes.length > 2 ? (
            <button type="button" className="glance__more" onClick={onOlder}>
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
      {detail?.notesError ? <p className="hub__item-meta">{detail.notesError}</p> : null}
      {empty ? <p className="hub__item-meta">No extra details.</p> : null}
    </div>
  )
}
