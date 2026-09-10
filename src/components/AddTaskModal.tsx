import { useId, useState } from 'react'
import { Modal } from './Modal'
import { useStore, newId } from '../state/store'
import { HOST_ID } from '../data/fixtures'
import { DURATION_OPTIONS, timeOptions } from '../lib/options'
import { dayLabel, todayKey, weekday } from '../lib/time'
import { firstName } from '../lib/people'
import type { CalendarEvent } from '../lib/types'

interface Props {
  /** Calendar the task lands on. */
  forUserId: string
  /** Default date key (host zone). */
  defaultDate?: string
  onClose: () => void
  onAdded?: (event: CalendarEvent) => void
}

const TIMES = timeOptions(7, 19)

export function AddTaskModal({ forUserId, defaultDate, onClose, onAdded }: Props) {
  const { state, dispatch } = useStore()
  const owner = state.team.find((m) => m.id === forUserId)
  const [userId, setUserId] = useState(forUserId)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate ?? todayKey())
  const [start, setStart] = useState(10)
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const target = state.team.find((m) => m.id === userId) ?? owner
  const isOther = userId !== HOST_ID
  const conflicts = state.events.filter(
    (e) => e.userId === userId && e.dateKey === date && !e.allDay && e.start < start + duration / 60 && e.end > start,
  )

  const submit = () => {
    if (!title.trim()) return setError('Give the task a title.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Pick a date.')
    const end = start + duration / 60
    const event: CalendarEvent = {
      id: newId('task'),
      userId,
      dateKey: date,
      start,
      end,
      title: title.trim(),
      kind: 'task',
      createdBy: HOST_ID,
    }
    dispatch({ type: 'event/add', event })
    onAdded?.(event)
    onClose()
  }

  return (
    <Modal
      title={isOther ? `Book for ${firstName(target?.name ?? '')}` : 'Add task'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            {isOther ? `Add to ${firstName(target?.name ?? '')}'s calendar` : 'Add task'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} className={`input${error && !title.trim() ? ' input--error' : ''}`} value={title} onChange={(e) => { setTitle(e.target.value); setError(null) }} placeholder="e.g. Prep deck for Harbor" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-user`}>On whose calendar</label>
        <select id={`${id}-user`} className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {state.team.filter((m) => m.status !== 'invited').map((m) => (
            <option key={m.id} value={m.id}>{m.id === HOST_ID ? `${m.name} (me)` : m.name}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field__label" htmlFor={`${id}-date`}>Date</label>
          <input id={`${id}-date`} className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(null) }} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-start`}>Start</label>
          <select id={`${id}-start`} className="select" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-duration`}>Duration</label>
          <select id={`${id}-duration`} className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATION_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
      </div>
      {conflicts.length > 0 && (
        <div className="field__hint">
          Overlaps {conflicts.length === 1 ? 'an existing event' : `${conflicts.length} existing events`} on {dayLabel(date)}
          {' '}({conflicts.map((c) => c.title).join(', ')}). It will still be added.
        </div>
      )}
      {!/^\d{4}-\d{2}-\d{2}$/.test(date) ? null : [0, 6].includes(weekday(date)) && (
        <div className="field__hint">{dayLabel(date)} is a weekend.</div>
      )}
      {isOther && (
        <div className="field__hint">{firstName(target?.name ?? '')} gets an email when this lands on their calendar.</div>
      )}
      {error && <div className="field__error" role="alert">{error}</div>}
    </Modal>
  )
}
