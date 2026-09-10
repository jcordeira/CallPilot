import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { BookingPage, shortClientName, shortTypeName } from './BookingPage'
import { WeekPage } from './WeekPage'
import { renderApp } from '../test/render'
import { initialState } from '../state/store'

// Tue Sep 1, 2026 at 10:00 AM ET. Seed events land in the week of Aug 31.
const NOW = new Date('2026-09-01T14:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(route = '/book') {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderApp(
    <Routes>
      <Route path="/book" element={<BookingPage />} />
      <Route path="/week" element={<WeekPage />} />
    </Routes>,
    { route },
  )
  return user
}

describe('BookingPage', () => {
  it('selects the first open day, honouring notice, busy time and buffer', () => {
    setup()
    // 24h notice from Tue 10 AM → Wed Sep 2 from 10 AM. Standup 9–10 + 15 buffer blocks 10:00.
    expect(screen.getByText('Wed, Sep 2')).toBeInTheDocument()
    const list = screen.getByRole('listbox', { name: /available times/i })
    const labels = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(labels[0]).toBe('10:30 AM')
    expect(labels).not.toContain('10:00 AM')
    expect(labels).not.toContain('12:00 PM') // lunch
    expect(labels).not.toContain('2:00 PM') // Intro — T. Nakamura 2:00–2:30
  })

  it('walks through slot → details → confirmation and books onto the host calendar', async () => {
    const user = setup()
    await user.click(screen.getByRole('option', { name: '10:30 AM' }))
    await user.click(screen.getByRole('button', { name: 'Confirm 10:30 AM' }))

    expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument()
    // Validation blocks an empty submit.
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^Name/), 'Jordan Alvarez')
    await user.type(screen.getByLabelText(/^Email/), 'jordan@example.com')
    await user.type(screen.getByLabelText(/Guests/), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(screen.getByText('One of the guest emails looks wrong.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/Guests/))
    await user.type(screen.getByLabelText(/Guests/), 'pat@example.com, sam@example.com')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(screen.getByRole('heading', { name: "You're booked" })).toBeInTheDocument()
    expect(screen.getByText('Wed, Sep 2 · 10:30 AM')).toBeInTheDocument()
    const summary = screen.getByText('Wed, Sep 2 · 10:30 AM').closest('.confirmed__card')!
    expect(within(summary as HTMLElement).getByText('Intro Call')).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('Google Meet')).toBeInTheDocument()

    // Book another time returns to the picker; the slot just booked is now gone.
    await user.click(screen.getByRole('button', { name: 'Book another time' }))
    const list = screen.getByRole('listbox', { name: /available times/i })
    const labels = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(labels).not.toContain('10:30 AM')
    // 10:30 + 15 min call + 15 min buffer frees 11:00 exactly
    expect(labels).toContain('11:00 AM')
  })

  it('changes slot spacing with the call type', async () => {
    const user = setup()
    await user.click(screen.getByRole('radio', { name: /Strategy Session/ }))
    expect(screen.getByText(/open · 45 min/)).toBeInTheDocument()
    const list = screen.getByRole('listbox', { name: /available times/i })
    const labels = within(list).getAllByRole('option').map((o) => o.textContent)
    // 45 + 15 → hourly steps from 9: 9 (standup), 10 (buffer), 11 ok, 12 lunch, 13 ok, 14 (Nakamura) ...
    expect(labels).toEqual(['11:00 AM', '1:00 PM', '3:00 PM', '4:00 PM'])
  })

  it('shows times in the chosen zone and resets the selected slot', async () => {
    const user = setup()
    await user.click(screen.getByRole('option', { name: '10:30 AM' }))
    expect(screen.getByRole('button', { name: 'Confirm 10:30 AM' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Time zone'), 'America/Los_Angeles')
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '7:30 AM' })).toBeInTheDocument()
    expect(screen.getByText(/Times shown in Pacific Time/)).toBeInTheDocument()
  })

  it('uses the buffer from settings', () => {
    const state = initialState()
    state.settings = { ...state.settings, bufferMinutes: 45 }
    renderApp(<BookingPage />, { route: '/book', state })
    // 15 + 45 → hourly steps: 9 (standup), 10 (standup + 45 buffer → 10:45), 11 ok, 12 lunch, 1 ok,
    // 2 (Nakamura), 3 (Nakamura ends 2:30 + 45 buffer → 3:15), 4 ok
    const list = screen.getByRole('listbox', { name: /available times/i })
    const labels = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['11:00 AM', '1:00 PM', '4:00 PM'])
  })
})

describe('title helpers', () => {
  it('shortens type and client names for calendar titles', () => {
    expect(shortTypeName('Intro Call')).toBe('Intro')
    expect(shortTypeName('Strategy Session')).toBe('Strategy')
    expect(shortTypeName('Deep Dive')).toBe('Deep Dive')
    expect(shortClientName('Jordan Alvarez')).toBe('J. Alvarez')
    expect(shortClientName('Cher')).toBe('Cher')
  })
})
