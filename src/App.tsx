import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { BookingPage } from './screens/BookingPage'
import { WeekPage } from './screens/WeekPage'
import { TeamPage } from './screens/TeamPage'
import { SettingsPage } from './screens/SettingsPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/book/:hostId" element={<BookingPage />} />
        <Route path="/week" element={<WeekPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Route>
    </Routes>
  )
}
