import { useState } from 'react'
import { FubPersonLink } from './FubPersonLink'
import {
  completeGlanceTask,
  fetchGlanceDetail,
  googleConnectUrl,
  type GlanceDetail,
  type GlanceItem,
  type GlanceSource,
} from '../lib/hubApi'
import { dayLabel } from '../lib/time'

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
  onDone: (source: GlanceSource, id: string) => void
}) {
  const [kind, setKind] = useState<KindFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, GlanceDetail>>({})
  const [detailError, setDetailError] = useState<Record<string, string>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [doneError, setDoneError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const [olderOpen, setOlderOpen] = useState<Record<string, boolean>>({})

  const visible = mode === 'all' ? items.filter((item) => passes(item, kind, source)) : items
  const groups = mode === 'all' ? groupItems(visible, todayKey) : [{ key: 'today', label: '', items: visible }]

  const toggle = (item: GlanceItem) => {
    if (openKey === item.key) {
      setOpenKey(null)
      return
    }
    setOpenKey(item.key)
    setConfirmKey(null)
    setDoneError(null)
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

  const markDone = (item: GlanceItem) => {
    setBusyKey(item.key)
    setDoneError(null)
    void completeGlanceTask(item.source, item.id)
      .then(() => {
        setOpenKey(null)
        setConfirmKey(null)
        onDone(item.source, item.id)
      })
      .catch((err: unknown) => {
        setDoneError(err instanceof Error ? err.message : 'Could not mark the task done')
      })
      .finally(() => setBusyKey(null))
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
                <li key={item.key} className="glance__item">
                  <div className="glance__line">
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
                      confirm={confirmKey === item.key}
                      busy={busyKey === item.key}
                      doneError={confirmKey === item.key ? doneError : null}
                      older={olderOpen[item.key] === true}
                      noteOpen={noteOpen}
                      onToggleNote={(id) => setNoteOpen((prev) => ({ ...prev, [id]: !prev[id] }))}
                      onOlder={() => setOlderOpen((prev) => ({ ...prev, [item.key]: true }))}
                      onAsk={() => {
                        setConfirmKey(item.key)
                        setDoneError(null)
                      }}
                      onCancel={() => setConfirmKey(null)}
                      onConfirm={() => markDone(item)}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
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
  confirm,
  busy,
  doneError,
  older,
  noteOpen,
  onToggleNote,
  onOlder,
  onAsk,
  onCancel,
  onConfirm,
}: {
  item: GlanceItem
  detail?: GlanceDetail
  loading: boolean
  error?: string
  confirm: boolean
  busy: boolean
  doneError: string | null
  older: boolean
  noteOpen: Record<string, boolean>
  onToggleNote: (id: string) => void
  onOlder: () => void
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
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
      {item.kind === 'task' ? (
        <div className="glance__done">
          {confirm ? (
            <div className="glance__confirm">
              <span>Mark this task done?</span>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={onConfirm}>
                Confirm
              </button>
              <button type="button" className="btn" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={onAsk}>
              Mark done
            </button>
          )}
          {doneError ? <p className="hub__error glance__banner">{doneError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
