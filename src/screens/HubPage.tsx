import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchActivity, runSweep, type ActivityItem } from '../lib/assistantApi'
import {
  createHubEvent,
  createHubTask,
  disconnectGoogle,
  fetchHubSummary,
  fetchLeadHeat,
  fetchCommandPanel,
  fetchReminderPanel,
  fetchCalendarGuestPanel,
  fetchWhatsappPanel,
  googleConnectUrl,
  previewCalendarGuests,
  previewReminders,
  previewWhatsappAutoreply,
  rescoreLeads,
  type CommandPanel,
  type ReminderPanel,
  type CalendarGuestPreview,
  type CalendarGuestPanel,
  type WhatsappPanel,
  type HubCalendarEvent,
  type HubSummary,
  type HubTask,
  type ScoredLead,
} from '../lib/hubApi'
import { FubPersonLink, TextWithPerson } from '../components/FubPersonLink'
import { matchPersonInText, personIdForName, type NamedPerson } from '../lib/fubLink'
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

function heatLabel(band: ScoredLead['band']): string {
  if (band === 'hot') return 'Hot now'
  if (band === 'warm') return 'Warm'
  if (band === 'cool') return 'Cool'
  return 'Cold'
}

function roleLabel(role?: ScoredLead['assigneeRole']): string {
  if (role === 'lo') return 'LO'
  if (role === 'loa') return 'LOA'
  return ''
}

function EventTitle({ summary, htmlLink, people }: { summary: string; htmlLink?: string; people: NamedPerson[] }) {
  const match = matchPersonInText(summary, people)
  if (!match) {
    if (htmlLink) {
      return (
        <a className="hub__item-title" href={htmlLink} target="_blank" rel="noreferrer">
          {summary}
        </a>
      )
    }
    return <div className="hub__item-title">{summary}</div>
  }
  const before = summary.slice(0, match.index)
  const after = summary.slice(match.index + match.label.length)
  return (
    <div className="hub__item-title">
      {before}
      <FubPersonLink personId={match.personId}>{match.label}</FubPersonLink>
      {after}
      {htmlLink ? (
        <>
          {' '}
          <a href={htmlLink} target="_blank" rel="noreferrer">
            Calendar
          </a>
        </>
      ) : null}
    </div>
  )
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
  const [leads, setLeads] = useState<ScoredLead[]>([])
  const [reminders, setReminders] = useState<ReminderPanel | null>(null)
  const [commands, setCommands] = useState<CommandPanel | null>(null)
  const [whatsapp, setWhatsapp] = useState<WhatsappPanel | null>(null)
  const [guests, setGuests] = useState<CalendarGuestPanel | null>(null)
  const [guestPreview, setGuestPreview] = useState<CalendarGuestPreview[] | null>(null)
  const [leadDemo, setLeadDemo] = useState(false)
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
      const [nextSummary, nextActivity, heat, reminderPanel, whatsappPanel, guestPanel, commandPanel] = await Promise.all([
        fetchHubSummary(),
        fetchActivity(12),
        fetchLeadHeat().catch(() => null),
        fetchReminderPanel().catch(() => null),
        fetchWhatsappPanel().catch(() => null),
        fetchCalendarGuestPanel().catch(() => null),
        fetchCommandPanel().catch(() => null),
      ])
      setSummary(nextSummary)
      setActivity(nextActivity.items)
      setReminders(reminderPanel && Array.isArray(reminderPanel.recent) ? reminderPanel : null)
      setWhatsapp(whatsappPanel && Array.isArray(whatsappPanel.recent) ? whatsappPanel : null)
      setGuests(guestPanel && Array.isArray(guestPanel.recent) ? guestPanel : null)
      setCommands(commandPanel && Array.isArray(commandPanel.recent) ? commandPanel : null)
      setLeads(heat?.leads ?? nextSummary.leads ?? [])
      setLeadDemo(heat?.demo ?? nextSummary.stats.demo)
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

  const onRescore = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const heat = await rescoreLeads()
      setLeads(heat.leads)
      setLeadDemo(heat.demo)
      setNotice(`Rescored ${heat.leads.length} leads in Follow Up Boss.`)
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not rescore leads')
    } finally {
      setBusy(false)
    }
  }

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

  const onPreviewReminders = async () => {
    setBusy(true)
    try {
      const result = await previewReminders()
      const count = result.deliveries?.length ?? 0
      setNotice(
        result.skipped === 'demo'
          ? 'Preview skipped in demo mode. Nothing was sent.'
          : `Preview only — ${count} ${count === 1 ? 'delivery' : 'deliveries'}, nothing sent.`,
      )
      await load()
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not preview reminders')
    } finally {
      setBusy(false)
    }
  }

  const onPreviewWhatsapp = async () => {
    setBusy(true)
    try {
      const result = await previewWhatsappAutoreply()
      const count = result.deliveries?.length ?? 0
      setNotice(
        result.skipped === 'demo'
          ? 'WhatsApp preview skipped in demo mode. Nothing was sent.'
          : `WhatsApp preview only — ${count} ${count === 1 ? 'auto-reply' : 'auto-replies'}, nothing sent.`,
      )
      await load()
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not preview WhatsApp auto-replies')
    } finally {
      setBusy(false)
    }
  }

  const onPreviewGuests = async () => {
    setBusy(true)
    try {
      const result = await previewCalendarGuests()
      if (result.skipped === 'demo') {
        setNotice('Calendar preview skipped in demo mode. Nobody was invited.')
      } else if (result.skipped === 'scope') {
        setNotice('Google needs a reconnect before LoanPilot can add guests.')
      } else {
        const adds = (result.previews ?? []).filter((item) => item.action === 'add')
        setGuestPreview(result.previews ?? [])
        setNotice(
          `Calendar preview only — ${adds.length} ${adds.length === 1 ? 'event' : 'events'} would add a guest. Nobody was invited.`,
        )
      }
      await load()
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof Error ? e.message : 'Could not preview calendar guests')
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

  const people: NamedPerson[] = leads
    .filter((lead) => lead.personId > 0 && lead.name.trim().length > 2)
    .map((lead) => ({ personId: lead.personId, name: lead.name }))
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
            Upcoming calls, open tasks, and which leads are hot again for Joseph and Frank. Grok still drafts the replies.
          </p>
          {summary?.google?.connected ? (
            <p className="hub__demo hub__demo--ok">
              Google connected{summary.google.email ? ` as ${summary.google.email}` : ''}
              {summary.google.source === 'env' ? ' (env token)' : ''}.
            </p>
          ) : summary?.stats.demo ? (
            <p className="hub__demo">
              Google Calendar is not connected — you&apos;re seeing sample events until you connect.
            </p>
          ) : summary ? (
            <p className="hub__demo">
              Google Calendar is not connected. Connect it to show your real events and tasks.
            </p>
          ) : null}
        </div>
        <div className="hub__actions">
          {summary?.google?.needsCalendarWrite ? (
            <a className="btn btn--primary" href={googleConnectUrl()}>
              Reconnect Google
            </a>
          ) : null}
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
          <button type="button" className="btn" onClick={() => void onRescore()} disabled={busy}>
            {busy ? 'Working…' : 'Rescore leads'}
          </button>
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
                  placeholder={summary?.stats.demo ? 'Optional in demo mode' : 'Required — Follow Up Boss person ID'}
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
        {reminders && (
          <section className="card hub__card hub__reminders" aria-labelledby="hub-reminders">
            <div className="hub__card-head">
              <h2 id="hub-reminders">Missed-item reminders</h2>
              <span className="mono hub__count">
                {reminders.enabled ? (reminders.dryRun ? 'Dry run' : 'On') : 'Off'}
              </span>
            </div>
            <p className="hub__form-help hub__heat-note">
              {reminders.enabled
                ? `Looking back ${reminders.lookbackHours}h. Unanswered texts wait ${reminders.textWindowMinutes} minutes.`
                : 'Off until LOA_REMINDERS_ENABLED=true. Preview does not text anyone or post notes.'}
              {' '}
              {reminders.googleMissedCalls}
            </p>
            <ul className="hub__list">
              {reminders.seats.map((seat) => (
                <li key={`${seat.role}-${seat.userId}`} className="hub__row">
                  <div className="hub__row-top">
                    <span className="pill">{seat.role === 'lo' ? 'LO' : 'LOA'}</span>
                    <span className="hub__when">{seat.phoneSet ? 'SMS on' : 'No mobile'}</span>
                  </div>
                  <div className="hub__item-title">{seat.name}</div>
                  <div className="hub__item-meta">
                    {seat.fubNote ? 'FUB mention note and one SMS digest' : 'SMS digest for overdue tasks and missed FUB calls'}
                    {seat.role === 'lo' ? ', plus overdue Google Tasks' : ''}
                  </div>
                </li>
              ))}
            </ul>
            <h3 className="hub__subhead">Recent</h3>
            {reminders.recent.length === 0 ? (
              <p className="hub__empty">No reminders yet.</p>
            ) : (
              <ul className="hub__list">
                {reminders.recent.slice(0, 8).map((item) => (
                  <li key={item.id} className="hub__row">
                    <div className="hub__row-top">
                      <span className={`pill pill--${item.status}`}>{item.dryRun ? 'Preview' : item.status}</span>
                      <span className="mono hub__channel">{item.channel}</span>
                      <span className="hub__when">{relativeTime(item.at)}</span>
                    </div>
                    <div className="hub__item-title">{item.seatName}</div>
                    {item.personName && (
                      <div className="hub__item-meta">
                        <FubPersonLink personId={item.personId && item.personId > 0 ? item.personId : personIdForName(item.personName, people)}>
                          {item.personName}
                        </FubPersonLink>
                      </div>
                    )}
                    <p className="hub__item-meta">
                      <TextWithPerson text={item.summary} people={people} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="hub__form-actions hub__reminder-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void onPreviewReminders()}>
                {busy ? 'Working…' : 'Preview reminders'}
              </button>
            </div>
          </section>
        )}
        {summary?.google?.needsCalendarWrite && (
          <p className="hub__error" role="status">
            Google is connected without Calendar write access. Reconnect Google so LoanPilot can add guests to events.
          </p>
        )}
        {guests && (
          <section className="card hub__card" aria-labelledby="hub-guests">
            <div className="hub__card-head">
              <h2 id="hub-guests">Calendar guests</h2>
              <span className="mono hub__count">{guests.enabled ? (guests.dryRun ? 'Dry run' : 'On') : 'Off'}</span>
            </div>
            <p className="hub__form-help hub__heat-note">
              {guests.enabled
                ? `Adds ${guests.emails.join(', ')} to client appointments in the next ${guests.days} days.`
                : 'Off until CALENDAR_AUTO_GUEST_ENABLED=true. Preview does not change the calendar.'}
            </p>
            <p className="hub__item-meta">
              {guests.notify === 'ics'
                ? guests.gmailCanInvite
                  ? 'New guests get an email invite. Existing guests are not notified.'
                  : 'Guests are added quietly unless Gmail is connected or notify is set to all.'
                : 'Google notifies guests on each update.'}
            </p>
            <h3 className="hub__subhead">Would add</h3>
            {!guestPreview ? (
              <p className="hub__empty">Preview to see upcoming client appointments.</p>
            ) : guestPreview.filter((item) => item.action === 'add').length === 0 ? (
              <p className="hub__empty">No upcoming events need a guest added.</p>
            ) : (
              <ul className="hub__list">
                {guestPreview
                  .filter((item) => item.action === 'add')
                  .slice(0, 8)
                  .map((item) => (
                    <li key={item.id} className="hub__row">
                      <div className="hub__item-title">{item.summary}</div>
                      <p className="hub__item-meta">{item.reason}</p>
                    </li>
                  ))}
              </ul>
            )}
            <div className="hub__form-actions hub__reminder-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void onPreviewGuests()}>
                {busy ? 'Working…' : 'Preview calendar guests'}
              </button>
            </div>
          </section>
        )}
        {commands && (
          <section className="card hub__card" aria-labelledby="hub-commands">
            <div className="hub__card-head">
              <h2 id="hub-commands">Command mode</h2>
              <span className="mono hub__count">{commands.enabled ? (commands.dryRun ? 'Dry run' : 'On') : 'Off'}</span>
            </div>
            <p className="hub__form-help hub__heat-note">
              {commands.enabled
                ? `Texts from Joseph and the LOAs on ${commands.line ?? 'the Quo line'}${commands.dryRun ? ' are previews.' : '.'}`
                : 'Off until COMMAND_MODE_ENABLED=true. Client texts are ignored.'}
            </p>
            {commands.needsGoogleReconnect ? (
              <p className="hub__error" role="status">
                Reconnect Google so command mode can book and check free/busy.
              </p>
            ) : null}
            {commands.busyUntil ? (
              <p className="hub__item-meta">Holding calls until {new Date(commands.busyUntil).toLocaleString()}</p>
            ) : null}
            <h3 className="hub__subhead">Recent</h3>
            {commands.recent.length === 0 ? (
              <p className="hub__empty">No commands yet.</p>
            ) : (
              <ul className="hub__list">
                {commands.recent.slice(0, 8).map((item) => (
                  <li key={item.id} className="hub__row">
                    <div className="hub__row-top">
                      <span className={`pill pill--${item.status === 'error' ? 'error' : item.status === 'done' ? 'sent' : 'skipped'}`}>{item.dryRun ? 'Preview' : item.status}</span>
                      <span className="hub__when">{relativeTime(item.at)}</span>
                    </div>
                    <div className="hub__item-title">{item.actor}</div>
                    <p className="hub__item-meta">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {whatsapp && (
          <section className="card hub__card" aria-labelledby="hub-whatsapp">
            <div className="hub__card-head">
              <h2 id="hub-whatsapp">WhatsApp auto-reply</h2>
              <span className="mono hub__count">{whatsapp.enabled ? (whatsapp.dryRun ? 'Dry run' : 'On') : 'Off'}</span>
            </div>
            <p className="hub__form-help hub__heat-note">
              {whatsapp.enabled
                ? `Replies after ${whatsapp.waitMinutes} minutes with no answer. One reply per contact every ${whatsapp.cooldownHours} hours.`
                : 'Off until WHATSAPP_AUTOREPLY_ENABLED=true. Preview does not message anyone.'}
            </p>
            <p className="hub__item-meta">
              {whatsapp.pending} waiting
              {whatsapp.loPhoneSet ? '' : ' · no LO mobile'}
              {whatsapp.kapsoConfigured ? '' : ' · Kapso not configured'}
            </p>
            <h3 className="hub__subhead">Recent</h3>
            {whatsapp.recent.length === 0 ? (
              <p className="hub__empty">No WhatsApp auto-replies yet.</p>
            ) : (
              <ul className="hub__list">
                {whatsapp.recent.slice(0, 6).map((item) => (
                  <li key={item.id} className="hub__row">
                    <div className="hub__row-top">
                      <span className={`pill pill--${item.status}`}>{item.dryRun ? 'Preview' : item.status}</span>
                      <span className="hub__when">{relativeTime(item.at)}</span>
                    </div>
                    <div className="hub__item-title">
                      <TextWithPerson text={item.contactLabel} people={people} />
                    </div>
                    <p className="hub__item-meta">
                      <TextWithPerson text={item.summary} people={people} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="hub__form-actions hub__reminder-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void onPreviewWhatsapp()}>
                {busy ? 'Working…' : 'Preview WhatsApp'}
              </button>
            </div>
          </section>
        )}
        <section className="card hub__card hub__heat" aria-labelledby="hub-heat">
          <div className="hub__card-head">
            <h2 id="hub-heat">Lead heat</h2>
            <span className="mono hub__count">{leads.length} scored</span>
          </div>
          {leadDemo && (
            <p className="hub__form-help hub__heat-note">
              Sample scores until Follow Up Boss is connected. Hot leads route to Joseph (LO); warm and cool leads route to Frank (LOA).
            </p>
          )}
          {!ready ? (
            <p className="hub__empty">Loading lead heat…</p>
          ) : leads.length === 0 ? (
            <p className="hub__empty">No scored leads yet. Rescore to rank who Joseph and Frank should call.</p>
          ) : (
            <ul className="hub__list">
              {leads.map((lead) => {
                const role = roleLabel(lead.assigneeRole)
                return (
                  <li key={lead.personId} className="hub__row">
                    <div className="hub__row-top">
                      <span className={`pill pill--${lead.band}`}>{heatLabel(lead.band)}</span>
                      <span className="mono hub__channel">{lead.score}</span>
                      <span className="hub__when">{lead.due ? formatDue(lead.due) : 'No task'}</span>
                    </div>
                    <div className="hub__item-title">
                      <FubPersonLink personId={lead.personId}>{lead.name}</FubPersonLink>
                    </div>
                    <div className="hub__item-meta">
                      {lead.assignee ? `${lead.assignee}${role ? ` · ${role}` : ''}` : 'No assignee'}
                      {lead.taskType ? ` · ${lead.taskType}` : ''}
                    </div>
                    {lead.reasons.length > 0 && <p className="hub__item-meta">{lead.reasons.join(' · ')}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card hub__card" aria-labelledby="hub-calendar">
          <div className="hub__card-head">
            <h2 id="hub-calendar">Calendar</h2>
            <span className="mono hub__count">7 days</span>
          </div>
          {!ready ? (
            <p className="hub__empty">Loading calendar…</p>
          ) : events.length === 0 ? (
            <p className="hub__empty">
              {summary && !summary.stats.demo && !summary.google.connected
                ? 'Connect Google Calendar to see upcoming events.'
                : 'Nothing on the calendar for the next 7 days.'}
            </p>
          ) : (
            <ul className="hub__list">
              {events.map((event) => (
                <li key={event.id} className="hub__row">
                  <div className="hub__row-top">
                    <span className="hub__source">{sourceLabel(event.source)}</span>
                    <span className="hub__when">{formatEventWhen(event)}</span>
                  </div>
                  <EventTitle summary={event.summary} htmlLink={event.htmlLink} people={people} />
                  {event.description && (
                    <p className="hub__item-meta">
                      <TextWithPerson text={event.description} people={people} />
                    </p>
                  )}
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
            <p className="hub__empty">
              {summary && !summary.stats.demo && !summary.google.connected
                ? 'Connect Google to see tasks.'
                : 'No open Google Tasks.'}
            </p>
          ) : (
            <ul className="hub__list">
              {googleTasks.map((task) => (
                <TaskRow key={`${task.source}-${task.id}`} task={task} people={people} />
              ))}
            </ul>
          )}
          <h3 className="hub__subhead">Follow Up Boss</h3>
          {!ready ? null : fubTasks.length === 0 ? (
            <p className="hub__empty">No open Follow Up Boss tasks.</p>
          ) : (
            <ul className="hub__list">
              {fubTasks.map((task) => (
                <TaskRow key={`${task.source}-${task.id}`} task={task} people={people} />
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
                  <div className="hub__item-title">
                    <FubPersonLink personId={item.fubPersonId}>{item.from}</FubPersonLink>
                  </div>
                  {item.subject && <div className="hub__item-meta">{item.subject}</div>}
                  <p className="hub__item-meta">
                    <TextWithPerson text={item.summary} people={people} />
                  </p>
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

function TaskRow({ task, people }: { task: HubTask; people: NamedPerson[] }) {
  const linkedId = task.personId && task.personId > 0 ? task.personId : personIdForName(task.personName, people)
  return (
    <li className="hub__row">
      <div className="hub__row-top">
        <span className="hub__source">{sourceLabel(task.source)}</span>
        <span className="hub__when">{formatDue(task.due)}</span>
      </div>
      <div className="hub__item-title">
        <TextWithPerson text={task.title} people={people} />
      </div>
      {task.personName && (
        <div className="hub__item-meta">
          <FubPersonLink personId={linkedId}>{task.personName}</FubPersonLink>
        </div>
      )}
      {task.assignedTo && <div className="hub__item-meta">Assigned to {task.assignedTo}</div>}
      {task.notes && <p className="hub__item-meta">{task.notes}</p>}
    </li>
  )
}
