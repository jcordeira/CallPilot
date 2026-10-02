import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarPage } from './CalendarPage'
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
    expect(screen.getByRole('link', { name: 'Reconnect Google' })).toHaveAttribute('href', '/api/google/connect')
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
    await user.type(screen.getByLabelText('Title'), 'Alex Buyer call refi')
    await user.click(screen.getByRole('button', { name: 'Frankie' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('dialog', { name: 'Notify guests?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "Don't notify" }))
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/calendar'))).toBe(true)
    expect(screen.getByText(/cannot edit events/)).toBeInTheDocument()
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