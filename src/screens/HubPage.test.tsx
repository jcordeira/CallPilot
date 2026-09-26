import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'
import { renderApp } from '../test/render'

const summary = {
  ok: true,
  data: {
    events: [
      {
        id: 'e1',
        summary: 'Call: Jordan Hale',
        description: 'Pre-approval questions',
        startIso: '2026-09-25T18:00:00.000Z',
        endIso: '2026-09-25T18:30:00.000Z',
        allDay: false,
        source: 'demo',
      },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Send pre-approval checklist to Alex Buyer',
        status: 'needsAction',
        source: 'demo',
        due: '2026-09-26',
      },
      {
        id: 't2',
        title: 'Follow up: pre-approval documents',
        status: 'needsAction',
        source: 'fub',
        personName: 'Alex Buyer',
        due: '2026-09-26',
      },
    ],
    activity: [],
    warnings: [],
    stats: { upcomingEvents: 1, openTasks: 2, recentReplies: 1, escalations: 0, demo: true },
    google: { configured: true, connected: false, source: null },
    leads: [
      {
        personId: 1001,
        name: 'Alex Buyer',
        score: 92,
        band: 'hot',
        reasons: ['Inbound email or text in the last 24 hours', 'Engagement: pre-approval, docs ready, ready to buy'],
        assignee: 'Joseph Cordeira',
        assigneeRole: 'lo',
        taskType: 'Call',
        due: '2026-09-25',
        scoredAt: '2026-09-25T15:00:00.000Z',
      },
      {
        personId: 1002,
        name: 'Jordan Hale',
        score: 72,
        band: 'warm',
        reasons: ['Engagement: refinance, rate'],
        assignee: 'Frank Cordeira',
        assigneeRole: 'loa',
        taskType: 'Text',
        due: '2026-09-26',
        scoredAt: '2026-09-25T15:00:00.000Z',
      },
    ],
  },
}

const activity = {
  items: [
    {
      id: 'a1',
      at: '2026-09-25T15:00:00.000Z',
      channel: 'gmail',
      from: 'alex.buyer@gmail.com',
      subject: 'Question about pre-approval documents',
      senderKind: 'lead',
      decision: 'replied',
      summary: 'Drafted reply listing typical pre-approval docs.',
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockHub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/hub/summary')) {
        return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/hub/leads')) {
        return new Response(JSON.stringify({ ok: true, data: { leads: summary.data.leads, demo: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/google/status')) {
        return new Response(JSON.stringify({ ok: true, data: summary.data.google }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/assistant/activity')) {
        return new Response(JSON.stringify(activity), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }),
  )
}

describe('Hub', () => {
  it('is the home screen and the nav is Hub, Assistant, Week, Book, Settings', async () => {
    mockHub()
    renderApp(<App />, { route: '/' })
    expect(await screen.findByRole('heading', { name: 'Hub' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(Array.from(nav.querySelectorAll('a')).map((link) => link.textContent)).toEqual([
      'Hub',
      'Assistant',
      'Week',
      'Book',
      'Settings',
    ])
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toBeInTheDocument()
    expect(await screen.findByText('Call: Jordan Hale')).toBeInTheDocument()
    expect(screen.getByText('Send pre-approval checklist to Alex Buyer')).toBeInTheDocument()
    expect(screen.getByText('Follow up: pre-approval documents')).toBeInTheDocument()
    expect(screen.getByText('Drafted reply listing typical pre-approval docs.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lead heat' })).toBeInTheDocument()
    expect(screen.getByText('Hot now')).toBeInTheDocument()
    expect(screen.getByText(/Joseph Cordeira · LO/)).toBeInTheDocument()
    expect(screen.getByText(/Frank Cordeira · LOA/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rescore leads' })).toBeInTheDocument()
  })

  it('opens the add-task and hold-slot forms', async () => {
    mockHub()
    const user = userEvent.setup()
    renderApp(<App />, { route: '/hub' })
    await screen.findByRole('heading', { name: 'Hub' })
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save task' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hold calendar slot' }))
    expect(screen.getByLabelText('Lead name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hold slot' })).toBeInTheDocument()
  })
})
