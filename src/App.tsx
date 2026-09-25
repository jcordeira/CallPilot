import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { HubPage } from './screens/HubPage'
import { AssistantPage } from './screens/AssistantPage'
import { AssistantSettingsPage } from './screens/AssistantSettingsPage'
import { BookingPage } from './screens/BookingPage'
import { WeekPage } from './screens/WeekPage'
import { TeamPage } from './screens/TeamPage'
import { SettingsPage } from './screens/SettingsPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/hub" replace />} />
        <Route path="/hub" element={<HubPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/assistant/settings" element={<AssistantSettingsPage />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/book/:hostId" element={<BookingPage />} />
        <Route path="/week" element={<WeekPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/hub" replace />} />
      </Route>
    </Routes>
  )
}
