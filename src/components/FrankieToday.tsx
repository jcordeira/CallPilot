import { useState } from 'react'
import { FubPersonLink } from './FubPersonLink'
import type { FrankieTodayBoard } from '../lib/hubApi'

function daysLabel(days: number | null): string {
  if (days == null) return 'Never touched'
  if (days === 0) return 'Touched today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export function FrankieToday({ board, loading }: { board: FrankieTodayBoard | null; loading: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const people = Array.isArray(board?.people) ? board.people : []
  const sections = Array.isArray(board?.sections) ? board.sections : []
  const cap = board?.cap ?? 30
  const visible = showAll ? people : people.slice(0, cap)
  const hidden = Math.max(0, people.length - cap)
  return (
    <section className="card hub__card" aria-labelledby="hub-frankie-today">
      <div className="hub__card-head">
        <h2 id="hub-frankie-today">Frankie Today</h2>
        <span className="mono hub__count">{board ? board.totalDue : '—'}</span>
      </div>
      <p className="hub__form-help">People Frankie should contact. Nothing here texts, emails, or creates a task.</p>
      {loading && !board ? <p className="hub__empty">Loading Frankie Today…</p> : null}
      {board?.warnings.map((warning) => (
        <p key={warning} className="hub__form-help">{warning}</p>
      ))}
      {sections.length > 0 ? (
        <p className="hub__item-meta">
          {sections.map((section) => `${section.label} ${section.total}`).join(' · ')}
        </p>
      ) : null}
      {board && people.length === 0 && !loading ? <p className="hub__empty">Nobody is due on this pass.</p> : null}
      <ul className="hub__list">
        {visible.map((person) => (
          <li key={person.id} className="hub__row">
            <details>
              <summary>
                <span className="hub__item-title">{person.name}</span>
                <span className="hub__item-meta">
                  {person.reason} · {daysLabel(person.daysSinceTouch)}
                </span>
              </summary>
              <div className="hub__item-meta">
                <div>Source {person.source}</div>
                <div>Assigned {person.assignedTo}</div>
                {person.tags.length > 0 ? <div>Also {person.tags.join(', ')}</div> : null}
                <FubPersonLink personId={person.id}>Open in Follow Up Boss</FubPersonLink>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className="btn" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show less' : `Show all (${people.length})`}
        </button>
      ) : null}
    </section>
  )
}
