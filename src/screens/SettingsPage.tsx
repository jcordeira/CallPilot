import { useState } from 'react'
import { useStore } from '../state/store'
import { Toggle } from '../components/Toggle'
import { CheckboxMark } from '../components/Checkbox'
import { BreakEditorModal } from '../components/BreakEditorModal'
import { BUFFER_OPTIONS } from '../data/fixtures'
import { daysLabel } from '../lib/options'
import { fmt, span } from '../lib/time'
import type { Location, RecurringBreak } from '../lib/types'
import './SettingsPage.css'

const CONF_OPTIONS: Location[] = ['Google Meet', 'Zoom', 'Phone call', 'In person']

export function SettingsPage() {
  const { state, dispatch } = useStore()
  const s = state.settings
  const [editor, setEditor] = useState<{ open: boolean; brk?: RecurringBreak }>({ open: false })

  const bufferLabel = s.bufferMinutes === 0 ? 'None' : `${s.bufferMinutes} minutes`
  const rules = [
    { label: 'Working hours', value: `${daysLabel(s.workingHours.days)}, ${clock(s.workingHours.start)} – ${clock(s.workingHours.end)} ET` },
    { label: 'Buffer between calls', value: bufferLabel },
    { label: 'Minimum notice', value: `${s.minNoticeHours} hours` },
    { label: 'Max calls per day', value: String(s.maxCallsPerDay) },
  ]

  return (
    <div className="page page--narrow">
      <h1 className="page-title settings__title">Settings</h1>

      <div className="eyebrow settings__label">Calendar connections</div>
      <div className="card settings__section">
        {s.connections.map((c) => (
          <div key={c.provider} className="conn">
            <span className="conn__tile mono" aria-hidden="true">{c.tag}</span>
            <div className="conn__who">
              <div className="conn__name">{c.name}</div>
              <div className="conn__account">{c.account ?? 'Not connected'}</div>
            </div>
            <span className={`mono conn__state${c.enabled ? '' : ' conn__state--off'}`}>{c.enabled ? '2-WAY SYNC ON' : 'OFF'}</span>
            <Toggle checked={c.enabled} onChange={() => dispatch({ type: 'connection/toggle', provider: c.provider })} label={`${c.name} two-way sync`} />
          </div>
        ))}
        <div className="card-footer">Two-way sync: bookings write to the connected calendar, and busy time there blocks new bookings here.</div>
      </div>

      <div className="eyebrow settings__label">Email notifications</div>
      <div className="card settings__section">
        {s.emails.map((e) => (
          <button
            key={e.id}
            type="button"
            role="checkbox"
            aria-checked={e.enabled}
            className="emailrow"
            onClick={() => dispatch({ type: 'email/toggle', id: e.id })}
          >
            <CheckboxMark checked={e.enabled} />
            <span className="emailrow__text">
              <span className="emailrow__name">{e.name}</span>
              <span className="emailrow__desc">{e.description}</span>
            </span>
          </button>
        ))}
        <div className="card-footer">SMS is off. Everything goes out by email.</div>
      </div>

      <div className="eyebrow settings__label">Conferencing &amp; hours</div>
      <div className="card settings__section settings__conf">
        <div className="settings__h">Default meeting link</div>
        <div className="chips" role="radiogroup" aria-label="Default meeting link">
          {CONF_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={s.conferencing === o}
              className={`chip${s.conferencing === o ? ' chip--selected' : ''}`}
              onClick={() => dispatch({ type: 'conferencing/set', value: o })}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="rules">
          {rules.map((r) => (
            <div key={r.label}>
              <div className="mono rules__label">{r.label}</div>
              <div className="rules__value">{r.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="eyebrow settings__label settings__label--breaks">Breaks clients can't book</div>
      <div className="card">
        <div className="buffer">
          <div className="settings__h settings__h--tight">Buffer after every appointment</div>
          <div className="settings__help">Held open on your calendar. Clients never see these minutes as bookable.</div>
          <div className="chips chips--tight" role="radiogroup" aria-label="Buffer after every appointment">
            {BUFFER_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={s.bufferMinutes === m}
                className={`chip chip--mono${s.bufferMinutes === m ? ' chip--selected' : ''}`}
                onClick={() => dispatch({ type: 'buffer/set', minutes: m })}
              >
                {m === 0 ? 'None' : `${m} min`}
              </button>
            ))}
          </div>
        </div>

        <div className="breaks__intro">
          <div className="settings__h settings__h--tight">Recurring breaks</div>
          <div className="settings__help settings__help--tight">Blocked windows that repeat every week.</div>
        </div>
        {s.breaks.length === 0 && (
          <div className="empty breaks__empty">No recurring breaks yet. Clients can book any time inside your working hours.</div>
        )}
        {s.breaks.map((b) => (
          <div key={b.id} className="brk">
            <div className="brk__who">
              <div className={`brk__name${b.enabled ? '' : ' brk__name--off'}`}>{b.name}</div>
              <div className="mono brk__meta">{span(b.start, b.end)} · {daysLabel(b.days)}</div>
            </div>
            <button type="button" className="brk__edit" onClick={() => setEditor({ open: true, brk: b })} aria-label={`Edit ${b.name}`}>Edit</button>
            <Toggle checked={b.enabled} onChange={() => dispatch({ type: 'break/toggle', id: b.id })} label={`${b.name} break`} />
          </div>
        ))}
        <div className="breaks__foot">
          <button type="button" className="btn btn--dashed" onClick={() => setEditor({ open: true })}>+ Add a break</button>
        </div>
      </div>

      {editor.open && <BreakEditorModal existing={editor.brk} onClose={() => setEditor({ open: false })} />}
    </div>
  )
}

/** "9:00" — a bare clock reading without the meridiem, for the hours summary. */
function clock(h: number): string {
  return fmt(h).replace(/ (AM|PM)$/, '')
}
