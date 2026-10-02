import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../state/store'
import { HOST_ID } from '../data/fixtures'
import { initials } from '../lib/people'
import { useDemoMode } from '../state/demoMode'
import { useHubAuth } from '../state/hubAuth'
import { useTimeZone } from '../state/timezone'
import './AppShell.css'

const LIVE_NAV = [
  { to: '/hub', label: 'Hub', end: true },
  { to: '/command', label: 'Command', end: true },
  { to: '/calendar', label: 'Calendar', end: true },
  { to: '/assistant', label: 'Assistant', end: false },
]

const DEMO_NAV = [
  ...LIVE_NAV,
  { to: '/week', label: 'Week', end: true },
  { to: '/book', label: 'Book', end: false },
  { to: '/settings', label: 'Settings', end: true },
]

export function AppShell() {
  const { state } = useStore()
  const { zoneShort } = useTimeZone()
  const demo = useDemoMode() === true
  const { signedIn, signOut } = useHubAuth()
  const host = demo ? (state.team.find((m) => m.id === HOST_ID) ?? state.team[0]) : null
  const NAV = demo ? DEMO_NAV : LIVE_NAV

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
            {signedIn && <button type="button" className="btn" onClick={signOut}>Sign out</button>}
            {host && <span className="avatar header__avatar" aria-label={host.name}>{initials(host.name)}</span>}
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
