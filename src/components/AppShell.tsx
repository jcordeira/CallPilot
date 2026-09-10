import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../state/store'
import { HOST_ID } from '../data/fixtures'
import { initials } from '../lib/people'
import { useTimeZone } from '../state/timezone'
import './AppShell.css'

const NAV = [
  { to: '/book', label: 'Booking page' },
  { to: '/week', label: 'My week' },
  { to: '/team', label: 'Team' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  const { state } = useStore()
  const { zoneShort } = useTimeZone()
  const host = state.team.find((m) => m.id === HOST_ID) ?? state.team[0]

  return (
    <div className="shell">
      <header className="header">
        <div className="header__inner">
          <NavLink to="/book" className="brand" aria-label="CallPilot home">
            <span className="brand__mark" aria-hidden="true">C</span>
            <span className="brand__name">CallPilot</span>
          </NavLink>
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}>
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
