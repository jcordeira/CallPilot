import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchActivity, runSweep, type ActivityItem } from '../lib/assistantApi'
import {
  createHubEvent,
  createHubTask,
  disconnectGoogle,
  fetchHubSummary,
  googleConnectUrl,
  type HubCalendarEvent,
  type HubSummary,
  type HubTask,
} from '../lib/hubApi'
import { dateToKey, dayLabel } from '../lib/time'
import './HubPage.css'

const DECISION_LABEL: Record<ActivityItem['decision'], string> = {
  replied: 'Replied',
  escalated: 'Escalated',
  skipped: 'Skipped',
  task_created: 'Task',
  appointment_created: 'Appointment',
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function formatEventWhen(event: HubCalendarEvent): string {
  const start = new Date(event.startIso)
  if (Number.isNaN(start.getTime())) return event.startIso
  const day = dayLabel(dateToKey(start))
  if (event.allDay) return `${day} · All day`
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

function formatDue(due?: string): string {
  if (!due) return 'No due date'
  const key = due.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return due
  return dayLabel(key)
}

function sourceLabel(source: HubTask['source'] | HubCalendarEvent['source']): string {
  if (source === 'fub') return 'FUB'
  if (source === 'google') return 'Google'
  return 'Sample'
}

function nextBusinessMorning(): { start: Date; end: Date } {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(10, 0, 0, 0)
  if (start.getDay() === 0) start.setDate(start.getDate() + 1)
  if (start.getDay() === 6) start.setDate(start.getDate() + 2)
  return { start, end: new Date(start.getTime() + 30 * 60_000) }
}

export function HubPage() {
  const formId = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<HubSummary | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [panel, setPanel] = useState<'task' | 'slot' | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [due, setDue] = useState('')
  const [source, setSource] = useState<'google' | 'fub' | 'both'>('google')
  const [personId, setPersonId] = useState('')

  const [leadName, setLeadName] = useState('')
  const [slotNote, setSlotNote] = useState('')
  const [email, setEmail] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextActivity] = await Promise.all([fetchHubSummary(), fetchActivity(12)])
      setSummary(nextSummary)
      setActivity(nextActivity.items)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the hub')
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const google = searchParams.get('google')
    if (!google) return
    if (google === 'connected') {
      setNotice('Google Calendar & Tasks connected.')
      void load()
    } else if (google === 'error') {
      const reason = searchParams.get('reason') || 'unknown'
      setError(`Google connect failed: ${reason}`)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('google')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, load])

  const onSweep = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await runSweep()
      await load()
      setNotice('Inbox sweep finished.')
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Sweep failed')
    } finally {
      setBusy(false)
    }
  }

  const onCreateTask = async () => {
    if (!title.trim()) {
      setError('Give the task a title.')
      return
    }
    const parsedPerson = personId.trim() ? Number(personId) : undefined
    if (parsedPerson != null && !Number.isFinite(parsedPerson)) {
      setError('Person ID must be a number.')
      return
    }
    setBusy(true)
    try {
      await createHubTask({
        title: title.trim(),
        notes: notes.trim() || undefined,
        due: due || undefined,
        source,
        personId: parsedPerson,
      })
      setTitle('')
      setNotes('')
      setDue('')
      setPersonId('')
      setPanel(null)
      setNotice('Task added.')
      await load()
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not add the task')
    } finally {
      setBusy(false)
    }
  }

  const onHoldSlot = async () => {
    if (!leadName.trim()) {
      setError('Name the lead for this slot.')
      return
    }
    const slot = nextBusinessMorning()
    setBusy(true)
    try {
      await createHubEvent({
        summary: `Call: ${leadName.trim()}`,
        description: slotNote.trim() || 'Held from the LoanPilot hub.',
        startIso: slot.start.toISOString(),
        endIso: slot.end.toISOString(),
        attendeeEmail: email.trim() || undefined,
        leadName: leadName.trim(),
        hint: slotNote.trim() || undefined,
      })
      setLeadName('')
      setSlotNote('')
      setEmail('')
      setPanel(null)
      setNotice('Calendar slot held.')
      await load()
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not hold the slot')
    } finally {
      setBusy(false)
    }
  }

  const events = summary?.events ?? []
  const googleTasks = (summary?.tasks ?? []).filter((task) => task.source === 'google' || task.source === 'demo')
  const fubTasks = (summary?.tasks ?? []).filter((task) => task.source === 'fub')
  const slotPreview = nextBusinessMorning()
  const stats = summary?.stats

  return (
    <div className="page hub">
      <header className="hub__hero">
        <div>
          <p className="eyebrow">Loan officer desk</p>
          <h1 className="page-title hub__title">Hub</h1>
          <p className="hub__lede">
            Upcoming calls, open tasks, and what LoanPilot handled for your leads — Grok still drafts the replies.
          </p>
          {summary?.google?.connected ? (
            <p className="hub__demo hub__demo--ok">
              Google connected{summary.google.email ? ` as ${summary.google.email}` : ''}
              {summary.google.source === 'env' ? ' (env token)' : ''}.
            </p>
          ) : (
            <p className="hub__demo">
              Google Calendar is not connected — you&apos;re seeing sample events until you connect.
            </p>
          )}
        </div>
        <div className="hub__actions">
          {summary?.google?.connected ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    await disconnectGoogle()
                    setNotice('Google disconnected.')
                    await load()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not disconnect Google')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Disconnect Google
            </button>
          ) : summary?.google?.configured === false ? (
            <a className="btn btn--primary" href="/assistant/settings#google-connect">
              Set up Google connect
            </a>
          ) : (
            <a className="btn btn--primary" href={googleConnectUrl()}>
              Connect Google Calendar
            </a>
          )}
          <button type="button" className="btn" onClick={() => void onSweep()} disabled={busy}>
            {busy ? 'Working…' : 'Run inbox sweep'}
          </button>
          <button
            type="button"
            className="btn"
            aria-expanded={panel === 'task'}
            aria-controls={`${formId}-task`}
            onClick={() => {
              setError(null)
              setPanel((current) => (current === 'task' ? null : 'task'))
            }}
          >
            Add task
          </button>
          <button
            type="button"
            className="btn"
            aria-expanded={panel === 'slot'}
            aria-controls={`${formId}-slot`}
            onClick={() => {
              setError(null)
              setPanel((current) => (current === 'slot' ? null : 'slot'))
            }}
          >
            Hold calendar slot
          </button>
        </div>
      </header>

      {error && (
        <p className="hub__error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="hub__notice">{notice}</p>}
      {summary?.warnings.map((warning) => (
        <p key={warning} className="hub__error" role="status">
          {warning}
        </p>
      ))}

      {panel === 'task' && (
        <form
          id={`${formId}-task`}
          className="card hub__form"
          onSubmit={(e) => {
            e.preventDefault()
            void onCreateTask()
          }}
        >
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
                  placeholder="Optional in demo mode"
                />
              </label>
            )}
          </div>
          <div className="hub__form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Save task
            </button>
            <button type="button" className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {panel === 'slot' && (
        <form
          id={`${formId}-slot`}
          className="card hub__form"
          onSubmit={(e) => {
            e.preventDefault()
            void onHoldSlot()
          }}
        >
          <p className="hub__form-help">
            Holds 30 minutes on {dayLabel(dateToKey(slotPreview.start))} at{' '}
            {slotPreview.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
          </p>
          <div className="hub__form-grid">
            <label className="field">
              <span className="field__label">Lead name</span>
              <input className="input" value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Alex Buyer" />
            </label>
            <label className="field">
              <span className="field__label">Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field field--wide">
              <span className="field__label">Note</span>
              <input className="input" value={slotNote} onChange={(e) => setSlotNote(e.target.value)} placeholder="Refinance questions" />
            </label>
          </div>
          <div className="hub__form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Hold slot
            </button>
            <button type="button" className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="hub__stats">
        <li className="card hub__stat">
          <span className="hub__stat-num">{stats ? stats.upcomingEvents : '—'}</span>
          <span className="eyebrow">Next 7 days</span>
        </li>
        <li className="card hub__stat">
          <span className="hub__stat-num">{stats ? stats.openTasks : '—'}</span>
          <span className="eyebrow">Open tasks</span>
        </li>
        <li className="card hub__stat">
          <span className="hub__stat-num">{stats ? stats.recentReplies : '—'}</span>
          <span className="eyebrow">Recent replies</span>
        </li>
        <li className="card hub__stat">
          <span className="hub__stat-num">{stats ? stats.escalations : '—'}</span>
          <span className="eyebrow">Escalations</span>
        </li>
      </ul>

      <div className="hub__grid">
        <section className="card hub__card" aria-labelledby="hub-calendar">
          <div className="hub__card-head">
            <h2 id="hub-calendar">Calendar</h2>
            <span className="mono hub__count">7 days</span>
          </div>
          {!ready ? (
            <p className="hub__empty">Loading calendar…</p>
          ) : events.length === 0 ? (
            <p className="hub__empty">Nothing on the calendar for the next 7 days.</p>
          ) : (
            <ul className="hub__list">
              {events.map((event) => (
                <li key={event.id} className="hub__row">
                  <div className="hub__row-top">
                    <span className="hub__source">{sourceLabel(event.source)}</span>
                    <span className="hub__when">{formatEventWhen(event)}</span>
                  </div>
                  {event.htmlLink ? (
                    <a className="hub__item-title" href={event.htmlLink} target="_blank" rel="noreferrer">
                      {event.summary}
                    </a>
                  ) : (
                    <div className="hub__item-title">{event.summary}</div>
                  )}
                  {event.description && <p className="hub__item-meta">{event.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card hub__card" aria-labelledby="hub-tasks">
          <div className="hub__card-head">
            <h2 id="hub-tasks">Tasks</h2>
            <span className="mono hub__count">{googleTasks.length + fubTasks.length} open</span>
          </div>
          <h3 className="hub__subhead">Google Tasks</h3>
          {!ready ? (
            <p className="hub__empty">Loading tasks…</p>
          ) : googleTasks.length === 0 ? (
            <p className="hub__empty">No open Google Tasks.</p>
          ) : (
            <ul className="hub__list">
              {googleTasks.map((task) => (
                <TaskRow key={`${task.source}-${task.id}`} task={task} />
              ))}
            </ul>
          )}
          <h3 className="hub__subhead">Follow Up Boss</h3>
          {!ready ? null : fubTasks.length === 0 ? (
            <p className="hub__empty">No open Follow Up Boss tasks.</p>
          ) : (
            <ul className="hub__list">
              {fubTasks.map((task) => (
                <TaskRow key={`${task.source}-${task.id}`} task={task} />
              ))}
            </ul>
          )}
        </section>

        <section className="card hub__card hub__activity" aria-labelledby="hub-activity">
          <div className="hub__card-head">
            <h2 id="hub-activity">Assistant activity</h2>
            <Link to="/assistant" className="hub__more">
              Open assistant
            </Link>
          </div>
          {!ready ? (
            <p className="hub__empty">Loading activity…</p>
          ) : activity.length === 0 ? (
            <p className="hub__empty">No activity yet. Run an inbox sweep to draft lead replies.</p>
          ) : (
            <ul className="hub__list">
              {activity.map((item) => (
                <li key={item.id} className="hub__row">
                  <div className="hub__row-top">
                    <span className={`pill pill--${item.decision}`}>{DECISION_LABEL[item.decision]}</span>
                    <span className="mono hub__channel">{item.channel}</span>
                    <span className="hub__when">{relativeTime(item.at)}</span>
                  </div>
                  <div className="hub__item-title">{item.from}</div>
                  {item.subject && <div className="hub__item-meta">{item.subject}</div>}
                  <p className="hub__item-meta">{item.summary}</p>
                  {item.replyPreview && <blockquote className="hub__quote">{item.replyPreview}</blockquote>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: HubTask }) {
  return (
    <li className="hub__row">
      <div className="hub__row-top">
        <span className="hub__source">{sourceLabel(task.source)}</span>
        <span className="hub__when">{formatDue(task.due)}</span>
      </div>
      <div className="hub__item-title">{task.title}</div>
      {task.personName && <div className="hub__item-meta">{task.personName}</div>}
      {task.notes && <p className="hub__item-meta">{task.notes}</p>}
    </li>
  )
}
