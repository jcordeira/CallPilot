import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../state/store'
import { HOST_ID } from '../data/fixtures'
import { initials } from '../lib/people'
import { useTimeZone } from '../state/timezone'
import './AppShell.css'

const NAV = [
  { to: '/hub', label: 'Hub', end: true },
  { to: '/assistant', label: 'Assistant', end: false },
  { to: '/week', label: 'Week', end: true },
  { to: '/book', label: 'Book', end: false },
  { to: '/settings', label: 'Settings', end: true },
]

export function AppShell() {
  const { state } = useStore()
  const { zoneShort } = useTimeZone()
  const host = state.team.find((m) => m.id === HOST_ID) ?? state.team[0]

  return (
    <div className="shell">
      <header className="header">
        <div className="header__inner">
          <NavLink to="/hub" className="brand" aria-label="LoanPilot home">
            <span className="brand__mark" aria-hidden="true">L</span>
            <span className="brand__name">LoanPilot</span>
          </NavLink>
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="header__right">
            <span className="header__tz mono" title="Current time zone">{zoneShort}</span>
            <span className="avatar header__avatar" aria-label={host.name}>{initials(host.name)}</span>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
