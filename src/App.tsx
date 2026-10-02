import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { HubPage } from './screens/HubPage'
import { AssistantPage } from './screens/AssistantPage'
import { AssistantSettingsPage } from './screens/AssistantSettingsPage'
import { BookingPage } from './screens/BookingPage'
import { WeekPage } from './screens/WeekPage'
import { TeamPage } from './screens/TeamPage'
import { SettingsPage } from './screens/SettingsPage'
import { DemoModeProvider, FixtureScreen } from './state/demoMode'
import { HubAuthGate } from './state/hubAuth'
import { CalendarPage } from './screens/CalendarPage'

export function App() {
  return (
    <DemoModeProvider>
      <HubAuthGate>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/hub" replace />} />
          <Route path="/hub" element={<HubPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/assistant/settings" element={<AssistantSettingsPage />} />
          <Route path="/book" element={<FixtureScreen title="Book"><BookingPage /></FixtureScreen>} />
          <Route path="/book/:hostId" element={<FixtureScreen title="Book"><BookingPage /></FixtureScreen>} />
          <Route path="/week" element={<FixtureScreen title="Week"><WeekPage /></FixtureScreen>} />
          <Route path="/team" element={<FixtureScreen title="Team"><TeamPage /></FixtureScreen>} />
          <Route path="/settings" element={<FixtureScreen title="Settings"><SettingsPage /></FixtureScreen>} />
          <Route path="*" element={<Navigate to="/hub" replace />} />
        </Route>
      </Routes>
      </HubAuthGate>
    </DemoModeProvider>
  )
}
