import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarPage } from './CalendarPage'
import { nextDateKey, zonedParts } from '../lib/calendarTime'
import { renderApp } from '../test/render'

const start = new Date('2026-10-02T18:00:00.000Z')
const end = new Date('2026-10-02T18:30:00.000Z')

function payload() {
  return {
    ok: true,
    data: {
      events: [
        {
          id: 'e1',
          summary: 'Call: Alex Buyer',
          description: 'Pre-approval',
          location: 'Phone',
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          allDay: false,
          source: 'demo',
          attendees: [{ email: 'fcordeirajr@cliffcomortgage.com' }],
        },
      ],
      demo: true,
      timezone: 'America/New_York',
      google: { configured: true, connected: true, email: 'joseph@teamcordeira.com', source: 'oauth' as const, canWrite: false, needsGmailSend: false, reconnect: true },
      leads: [{ personId: 1001, name: 'Alex Buyer' }],
    },
  }
}

describe('Calendar page', () => {
  it('links a matched lead, edits, and asks before notifying guests', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/api/hub/people')) {
        return new Response(JSON.stringify({ ok: true, data: { people: [{ id: 1001, name: 'Alex Buyer', email: 'alex.buyer@gmail.com' }] } }), { status: 200 })
      }
      if (url.includes('/api/hub/calendar') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(payload()), { status: 200 })
      }
      if (url.includes('/api/hub/calendar')) {
        return new Response(JSON.stringify({ ok: true, data: { id: 'e1', event: payload().data.events[0] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }))
    const user = userEvent.setup()
    renderApp(<CalendarPage />, { route: '/calendar' })
    expect(await screen.findByRole('link', { name: 'Alex Buyer' })).toHaveAttribute('href', 'https://teamcordeira.followupboss.com/2/people/view/1001')
    expect(screen.getByText(/· \d{1,2}:\d{2}:\d{2} (AM|PM) ET/)).toBeInTheDocument()
    const gutter = document.querySelector('.cal__hours')?.textContent ?? ''
    expect(gutter).toContain('12 AM')
    expect(gutter).toContain('8 AM')
    expect(gutter).toContain('11 PM')
    expect(gutter).not.toContain('18')
    expect(document.querySelectorAll('.cal__hour')).toHaveLength(24)
    expect(screen.getByTestId('now-line')).toBeInTheDocument()
    expect(screen.getAllByText('2 PM').length).toBeGreaterThan(1)
    if (start.getTime() > Date.now()) expect(screen.getByText(/Next: Call: Alex Buyer in /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect Google' })).toHaveAttribute('href', '/api/google/connect')
    await user.click(screen.getByRole('tab', { name: 'Day' }))
    expect(screen.getByTestId('now-line')).toBeInTheDocument()
    expect(document.querySelectorAll('.cal__hour')).toHaveLength(24)
    await user.click(screen.getByRole('tab', { name: 'Agenda' }))
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete this event?' })
    expect(confirm).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    const editor = screen.getByRole('dialog', { name: 'Edit event' })
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'New booking' }))
    expect(screen.getByRole('combobox', { name: 'Start hour' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Start minute' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Start AM or PM' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'End AM or PM' })).toBeInTheDocument()
    expect(document.querySelector('input[type="time"]')).toBeNull()
    await user.type(screen.getByLabelText('Title'), 'Alex Buyer call refi')
    await user.click(screen.getByRole('button', { name: 'Frankie' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('dialog', { name: 'Notify guests?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "Don't notify" }))
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/calendar'))).toBe(true)
    expect(screen.getByText(/cannot edit events/)).toBeInTheDocument()
  })

  it('creates a timed event from visible 12-hour pickers', async () => {
    let posted = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/hub/calendar') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(payload()), { status: 200 })
      }
      if (url.includes('/api/hub/calendar') && init?.method === 'POST') {
        posted = String(init.body)
        return new Response(JSON.stringify({ ok: true, data: { id: 'new-timed' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }))
    const user = userEvent.setup()
    renderApp(<CalendarPage />, { route: '/calendar' })
    await screen.findByRole('button', { name: 'New booking' })
    await user.click(screen.getByRole('button', { name: 'New booking' }))
    const dialog = screen.getByRole('dialog', { name: 'New booking' })
    expect(within(dialog).getByRole('combobox', { name: 'Start hour' })).toBeVisible()
    expect(within(dialog).getByRole('combobox', { name: 'End hour' })).toBeVisible()
    expect(within(dialog).getAllByText('Hour').length).toBeGreaterThan(0)
    expect(dialog.querySelector('input[type="time"]')).toBeNull()
    const day = (within(dialog).getByLabelText('Date') as HTMLInputElement).value
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Start hour' }), '2')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Start minute' }), '0')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Start AM or PM' }), 'PM')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'End hour' }), '3')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'End minute' }), '0')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'End AM or PM' }), 'PM')
    await user.type(within(dialog).getByLabelText('Title'), 'Closing call')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    const body = JSON.parse(posted) as { summary: string; allDay: boolean; startIso: string; endIso: string }
    expect(body.summary).toBe('Closing call')
    expect(body.startIso).toContain('T')
    expect(body.allDay).toBe(false)
    const startParts = zonedParts(new Date(body.startIso))
    const endParts = zonedParts(new Date(body.endIso))
    expect(`${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`).toBe(day)
    expect(startParts.hour).toBe(14)
    expect(startParts.minute).toBe(0)
    expect(endParts.hour).toBe(15)
    expect(endParts.minute).toBe(0)
  })

  it('creates an all-day event without time pickers and shows it in the all-day row', async () => {
    const body = payload()
    body.data.events.push({
      id: 'all-1',
      summary: 'Home inspection',
      description: '',
      location: '',
      startIso: '2026-10-02T12:00:00.000Z',
      endIso: '2026-10-04T12:00:00.000Z',
      allDay: true,
      source: 'demo',
      attendees: [],
    })
    let posted = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/hub/calendar') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(body), { status: 200 })
      }
      if (url.includes('/api/hub/calendar') && init?.method === 'POST') {
        posted = String(init.body)
        return new Response(JSON.stringify({ ok: true, data: { id: 'new-all' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }))
    const user = userEvent.setup()
    renderApp(<CalendarPage />, { route: '/calendar' })
    const row = (await screen.findAllByTestId('all-day-row')).find((cell) => cell.textContent?.includes('Home inspection'))
    expect(row).toBeTruthy()
    expect(document.querySelector('.cal__event')?.textContent).toContain('Alex Buyer')
    expect(document.querySelector('.cal__event')?.textContent).not.toContain('Home inspection')
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Home inspection' }))
    const editor = screen.getByRole('dialog', { name: 'Edit event' })
    expect(within(editor).getByRole('checkbox', { name: 'All day' })).toBeChecked()
    expect(within(editor).queryByRole('combobox', { name: 'Start hour' })).not.toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'New booking' }))
    const dialog = screen.getByRole('dialog', { name: 'New booking' })
    const day = (within(dialog).getByLabelText('Date') as HTMLInputElement).value
    await user.type(within(dialog).getByLabelText('Title'), 'Out of office')
    await user.click(within(dialog).getByRole('checkbox', { name: 'All day' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Start hour' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: 'End hour' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    const created = JSON.parse(posted) as { summary: string; allDay: boolean; startIso: string; endIso: string }
    expect(created.summary).toBe('Out of office')
    expect(created.allDay).toBe(true)
    expect(created.startIso).toBe(`${day}T12:00:00.000Z`)
    expect(created.endIso).toBe(`${nextDateKey(day)}T12:00:00.000Z`)
  })

  it('asks to reconnect for Frankie invites when calendar write is already granted', async () => {
    const body = payload()
    body.data.google = {
      configured: true,
      connected: true,
      email: 'joseph@teamcordeira.com',
      source: 'oauth',
      canWrite: true,
      needsGmailSend: true,
      reconnect: true,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/hub/people')) {
        return new Response(JSON.stringify({ ok: true, data: { people: [] } }), { status: 200 })
      }
      if (url.includes('/api/hub/calendar')) {
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }))
    renderApp(<CalendarPage />, { route: '/calendar' })
    expect(await screen.findByRole('link', { name: 'Reconnect Google' })).toHaveAttribute('href', '/api/google/connect')
    expect(screen.getByText(/Frankie gets a calendar invite/)).toBeInTheDocument()
    expect(screen.queryByText(/cannot edit events/)).not.toBeInTheDocument()
  })
})