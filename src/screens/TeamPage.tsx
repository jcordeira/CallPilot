import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import { AddTaskModal } from '../components/AddTaskModal'
import { InviteModal } from '../components/InviteModal'
import { clientCallsOn, nextOpenSlot, type AvailabilityRules } from '../lib/availability'
import { DOW, addDays, fmt, keyToDate, MONTHS, todayKey } from '../lib/time'
import { firstName, initials } from '../lib/people'
import type { TeamMember } from '../lib/types'
import './TeamPage.css'

const PERMISSIONS = [
  { title: 'See my schedule', body: 'Team members see your full week, including events synced from Google and Outlook. Private events show as busy.' },
  { title: 'Book on my behalf', body: 'Anyone on the team can place a task or an appointment on your calendar. You get an email when they do.' },
  { title: 'Their own calendars', body: 'Each user gets a booking page, their own connections, and their own hours. You can see and book into all of them.' },
]

export function TeamPage() {
  const { state } = useStore()
  const navigate = useNavigate()
  const [inviting, setInviting] = useState(false)
  const [bookingFor, setBookingFor] = useState<TeamMember | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const today = todayKey()

  const rows = useMemo(
    () =>
      state.team.map((m) => {
        const events = state.events.filter((e) => e.userId === m.id)
        const todays = events.filter((e) => e.dateKey === today)
        const ooo = todays.some((e) => e.allDay) || m.status === 'out-of-office'
        let load: string
        if (m.status === 'invited') load = 'Invite pending'
        else if (ooo) load = 'Out of office'
        else if (todays.length === 0) load = 'Clear'
        else {
          const calls = clientCallsOn(events, today)
          const hours = todays.reduce((acc, e) => acc + (e.end - e.start), 0)
          load = `${calls} ${calls === 1 ? 'call' : 'calls'} · ${trimHours(hours)}h`
        }
        const rules: AvailabilityRules = {
          workingHours: m.hours,
          bufferMinutes: state.settings.bufferMinutes,
          breaks: state.settings.breaks,
          minNoticeHours: 0,
          maxCallsPerDay: state.settings.maxCallsPerDay,
        }
        const next = m.status === 'invited' ? null : nextOpenSlot({ durationMinutes: 15, rules, events, horizonDays: 21 })
        return { m, load, next: next ? relativeSlot(next.dateKey, next.hour, today) : '—' }
      }),
    [state.team, state.events, state.settings, today],
  )

  return (
    <div className="page">
      <div className="team__toolbar">
        <div>
          <h1 className="page-title">Team</h1>
          <div className="page-subtitle">{state.team.length} users · shared calendars · booking on behalf enabled</div>
        </div>
        <button type="button" className="btn team__invite" onClick={() => setInviting(true)}>Invite user</button>
      </div>

      {notice && (
        <div className="team__notice" role="status">
          {notice}
          <button type="button" className="team__notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="card roster">
        <div className="roster__head mono" role="row">
          <div>Person</div><div>Today</div><div>Next open slot</div><div className="roster__actions-head">Actions</div>
        </div>
        {rows.map(({ m, load, next }) => (
          <div key={m.id} className="roster__row">
            <div className="roster__person">
              <span className="avatar roster__avatar" aria-hidden="true">{initials(m.name)}</span>
              <div className="roster__who">
                <div className="roster__name">{m.name}</div>
                <div className="roster__role">{m.role}{m.status === 'invited' ? ' · invited' : ''}</div>
              </div>
            </div>
            <div className="mono roster__cell"><span className="roster__cell-label">Today</span>{load}</div>
            <div className="mono roster__cell"><span className="roster__cell-label">Next open</span>{next}</div>
            <div className="roster__actions">
              <button type="button" className="btn btn--sm" onClick={() => navigate(`/week?user=${m.id}`)}>View</button>
              <button type="button" className="btn btn--sm btn--soft" onClick={() => setBookingFor(m)} disabled={m.status === 'invited'}>
                Book for {firstName(m.name)}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="perms">
        {PERMISSIONS.map((p) => (
          <div key={p.title} className="perm">
            <div className="perm__title">{p.title}</div>
            <div className="perm__body">{p.body}</div>
          </div>
        ))}
      </div>

      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onInvited={(member) => setNotice(`Invite sent to ${member.email}. They'll appear as active once they accept.`)}
        />
      )}
      {bookingFor && (
        <AddTaskModal
          forUserId={bookingFor.id}
          onClose={() => setBookingFor(null)}
          onAdded={(ev) => setNotice(`Added "${ev.title}" to ${firstName(bookingFor.name)}'s calendar. They've been emailed.`)}
        />
      )}
    </div>
  )
}

function trimHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '')
}

/** "Today 3:30 PM" / "Tomorrow 10:00 AM" / "Fri 9:30 AM" / "Sep 21, 9:00 AM" */
function relativeSlot(key: string, hour: number, today: string): string {
  const t = fmt(hour)
  if (key === today) return `Today ${t}`
  if (key === addDays(today, 1)) return `Tomorrow ${t}`
  const d = keyToDate(key)
  const within = key <= addDays(today, 6)
  if (within) return `${DOW[(d.getDay() + 6) % 7]} ${t}`
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${t}`
}
