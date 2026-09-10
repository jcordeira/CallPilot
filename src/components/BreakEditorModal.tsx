import { useId, useState } from 'react'
import { Modal } from './Modal'
import { useStore, newId } from '../state/store'
import { WEEKDAY_PICKS, timeOptions } from '../lib/options'
import type { RecurringBreak } from '../lib/types'
import './BreakEditorModal.css'

interface Props {
  /** Existing break to edit, or undefined to create. */
  existing?: RecurringBreak
  onClose: () => void
}

const TIMES = timeOptions(6, 20)

export function BreakEditorModal({ existing, onClose }: Props) {
  const { dispatch } = useStore()
  const [name, setName] = useState(existing?.name ?? '')
  const [start, setStart] = useState(existing?.start ?? 12)
  const [end, setEnd] = useState(existing?.end ?? 13)
  const [days, setDays] = useState<number[]>(existing?.days ?? [1, 2, 3, 4, 5])
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
    setError(null)
  }

  const submit = () => {
    if (!name.trim()) return setError('Give the break a name.')
    if (end <= start) return setError('End time must be after the start time.')
    if (days.length === 0) return setError('Pick at least one day.')
    const brk: RecurringBreak = {
      id: existing?.id ?? newId('break'),
      name: name.trim(),
      start,
      end,
      days,
      enabled: existing?.enabled ?? true,
    }
    dispatch(existing ? { type: 'break/update', brk } : { type: 'break/add', brk })
    onClose()
  }

  const remove = () => {
    if (!existing) return
    dispatch({ type: 'break/remove', id: existing.id })
    onClose()
  }

  return (
    <Modal
      title={existing ? 'Edit break' : 'Add a break'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button type="button" className="btn btn--muted break-editor__delete" onClick={remove}>Delete</button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={submit}>{existing ? 'Save' : 'Add break'}</button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className="input" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder="e.g. School pickup" />
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field__label" htmlFor={`${id}-start`}>Start</label>
          <select id={`${id}-start`} className="select" value={start} onChange={(e) => { setStart(Number(e.target.value)); setError(null) }}>
            {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-end`}>End</label>
          <select id={`${id}-end`} className="select" value={end} onChange={(e) => { setEnd(Number(e.target.value)); setError(null) }}>
            {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <span className="field__label" id={`${id}-days`}>Repeats on</span>
        <div className="daypicker" role="group" aria-labelledby={`${id}-days`}>
          {WEEKDAY_PICKS.map((d) => {
            const on = days.includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                className={`daypicker__day${on ? ' daypicker__day--on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field__hint">Clients won't see this window as bookable. It doesn't block tasks your team adds.</div>
      {error && <div className="field__error" role="alert">{error}</div>}
    </Modal>
  )
}
