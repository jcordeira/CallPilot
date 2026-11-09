import { useMemo, useState } from 'react'
import { quarterHourOptions } from '../lib/quickTaskTime'
import { dateKey, zonedDateTimeToUtc } from '../lib/calendarTime'

export type QuickAddValues = {
  title: string
  notes?: string
  due: string
  time?: string
  allDay: boolean
  source: 'google' | 'fub' | 'both'
  personId?: number
}

type Busy = { summary: string; startIso: string; endIso: string; allDay: boolean }

export function QuickAddTaskForm({
  initialDue,
  initialTime,
  demo,
  busy,
  events = [],
  onCancel,
  onSubmit,
}: {
  initialDue: string
  initialTime: string
  demo?: boolean
  busy: boolean
  events?: Busy[]
  onCancel: () => void
  onSubmit: (values: QuickAddValues) => Promise<void>
}) {
  const timeOptions = useMemo(() => quarterHourOptions(), [])
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [due, setDue] = useState(initialDue)
  const [taskTime, setTaskTime] = useState(initialTime)
  const [allDay, setAllDay] = useState(false)
  const [source, setSource] = useState<'google' | 'fub' | 'both'>('google')
  const [personId, setPersonId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const overlap = useMemo(() => {
    if (allDay || !due || !taskTime) return []
    const [hour, minute] = taskTime.split(':').map(Number)
    const [year, month, day] = due.split('-').map(Number)
    if (!year || !month || !day) return []
    const start = zonedDateTimeToUtc(year, month, day, hour || 0, minute || 0)
    const end = new Date(start.getTime() + 15 * 60_000)
    return events.filter((event) => {
      if (event.allDay || dateKey(new Date(event.startIso)) !== due) return false
      return new Date(event.startIso) < end && new Date(event.endIso) > start
    })
  }, [allDay, due, taskTime, events])

  return (
    <form
      className="hub__form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) {
          setError('Give the task a title.')
          return
        }
        const parsed = personId.trim() ? Number(personId) : undefined
        if (parsed != null && !Number.isFinite(parsed)) {
          setError('Person ID must be a number.')
          return
        }
        void onSubmit({
          title: title.trim(),
          notes: notes.trim() || undefined,
          due,
          time: allDay ? undefined : taskTime,
          allDay,
          source,
          personId: parsed,
        }).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Could not add the task')
        })
      }}
    >
      {error ? <p className="hub__error" role="alert">{error}</p> : null}
      <div className="hub__form-grid">
        <label className="field field--wide">
          <span className="field__label">Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Send the pre-approval checklist" />
        </label>
        <label className="field field--wide">
          <span className="field__label">Notes</span>
          <textarea className="input hub__textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Due</span>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Time</span>
          <select className="select" value={taskTime} disabled={allDay} onChange={(e) => setTaskTime(e.target.value)}>
            {timeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="field hub__all-day">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>All day</span>
        </label>
        {allDay ? null : <p className="hub__form-help hub__duration">15 minutes</p>}
        <label className="field">
          <span className="field__label">Save to</span>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="google">Google Tasks</option>
            <option value="fub">Follow Up Boss</option>
            <option value="both">Google and Follow Up Boss</option>
          </select>
        </label>
        {(source === 'fub' || source === 'both') && (
          <label className="field field--wide">
            <span className="field__label">Follow Up Boss person ID</span>
            <input
              className="input"
              inputMode="numeric"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              placeholder={demo ? 'Optional in demo mode' : 'Required — Follow Up Boss person ID'}
            />
          </label>
        )}
      </div>
      {overlap.length > 0 ? (
        <p className="hub__form-help" role="status">
          This overlaps {overlap.map((event) => event.summary).join(', ')}. You can still save it.
        </p>
      ) : null}
      <div className="hub__form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Save task</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
