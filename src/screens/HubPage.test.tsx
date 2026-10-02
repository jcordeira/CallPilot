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
        personId: 1001,
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
      fubPersonId: 1001,
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function hasText(expected: string | RegExp) {
  return (_content: string, node: Element | null) => {
    const text = node?.textContent ?? ''
    const ok = typeof expected === 'string' ? text === expected : expected.test(text)
    if (!ok || !node) return false
    return Array.from(node.children).every((child) => {
      const childText = child.textContent ?? ''
      return typeof expected === 'string' ? childText !== expected : !expected.test(childText)
    })
  }
}

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
    expect(await screen.findByRole('link', { name: 'Week' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(Array.from(nav.querySelectorAll('a')).map((link) => link.textContent)).toEqual([
      'Hub',
      'Calendar',
      'Assistant',
      'Week',
      'Book',
      'Settings',
    ])
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toBeInTheDocument()
    expect(await screen.findByText(hasText('Call: Jordan Hale'))).toBeInTheDocument()
    expect(screen.getByText(hasText('Send pre-approval checklist to Alex Buyer'))).toBeInTheDocument()
    expect(screen.getByText(hasText('Follow up: pre-approval documents'))).toBeInTheDocument()
    expect(screen.getByText('Drafted reply listing typical pre-approval docs.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lead heat' })).toBeInTheDocument()
    expect(screen.getByText('Hot now')).toBeInTheDocument()
    expect(screen.getByText(/Joseph Cordeira · LO/)).toBeInTheDocument()
    expect(screen.getByText(/Frank Cordeira · LOA/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rescore leads' })).toBeInTheDocument()
    const profile = (id: number) => `https://teamcordeira.followupboss.com/2/people/view/${id}`
    const alex = screen.getAllByRole('link', { name: 'Alex Buyer' })
    expect(alex.length).toBeGreaterThanOrEqual(2)
    for (const link of alex) {
      expect(link).toHaveAttribute('href', profile(1001))
      expect(link).toHaveAttribute('target', '_blank')
    }
    const jordan = screen.getAllByRole('link', { name: 'Jordan Hale' })
    expect(jordan.length).toBeGreaterThanOrEqual(2)
    for (const link of jordan) {
      expect(link).toHaveAttribute('href', profile(1002))
      expect(link).toHaveAttribute('target', '_blank')
    }
    expect(screen.getByRole('link', { name: 'alex.buyer@gmail.com' })).toHaveAttribute('href', profile(1001))
  })

  it('shows reminder activity and previews without sending', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/hub/reminders') && (init?.method ?? 'GET') === 'GET') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                enabled: false,
                dryRun: true,
                lookbackHours: 24,
                textWindowMinutes: 120,
                timezone: 'America/New_York',
                smsConfigured: false,
                quoFromConfigured: false,
                googleMissedCalls: 'Google Calendar has no missed-call feed in LoanPilot.',
                seats: [
                  { userId: 16, name: 'Frankie Cordeira', role: 'loa', phoneSet: true, fubNote: true },
                  { userId: 1, name: 'Joseph Cordeira', role: 'lo', phoneSet: true, fubNote: false },
                ],
                recent: [
                  {
                    id: 'r1',
                    at: '2026-10-02T14:00:00.000Z',
                    trigger: 'schedule',
                    dryRun: true,
                    seatUserId: 16,
                    seatName: 'Frankie Cordeira',
                    seatRole: 'loa',
                    channel: 'sms',
                    personId: 1001,
                    personName: 'Alex Buyer',
                    summary: 'LoanPilot: Frankie Cordeira, 1 item needs you. Missed inbound call from Alex Buyer.',
                    itemKeys: ['fub-task:1'],
                    status: 'preview',
                  },
                ],
                subscribe: ['callsCreated', 'callsUpdated'],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/reminders') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { enabled: false, dryRun: true, deliveries: [], deferred: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/summary')) {
          return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/api/hub/leads')) {
          return new Response(JSON.stringify({ ok: true, data: { leads: summary.data.leads, demo: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/assistant/activity')) {
          return new Response(JSON.stringify(activity), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderApp(<App />, { route: '/hub' })
    expect(await screen.findByRole('heading', { name: 'Missed-item reminders' })).toBeInTheDocument()
    expect(screen.getAllByText('Frankie Cordeira').length).toBeGreaterThan(0)
    expect(screen.getByText(/Google Calendar has no missed-call feed/)).toBeInTheDocument()
    expect(screen.getByText(/Frankie Cordeira, 1 item needs you/)).toBeInTheDocument()
    const reminderLead = screen.getAllByRole('link', { name: 'Alex Buyer' }).find((link) =>
      link.closest('#hub-reminders, [aria-labelledby="hub-reminders"]'),
    )
    expect(reminderLead).toHaveAttribute('href', 'https://teamcordeira.followupboss.com/2/people/view/1001')
    expect(reminderLead).toHaveAttribute('target', '_blank')
    await user.click(screen.getByRole('button', { name: 'Preview reminders' }))
    expect(await screen.findByText(/Preview only — 0 deliveries, nothing sent/)).toBeInTheDocument()
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/reminders'))).toBe(true)
    const post = calls.find((call) => call.startsWith('POST'))
    expect(post).toBeTruthy()
  })

  it('shows the WhatsApp auto-reply card and previews without sending', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/hub/whatsapp') && (init?.method ?? 'GET') === 'GET') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                enabled: false,
                dryRun: false,
                waitMinutes: 5,
                cooldownHours: 4,
                kapsoConfigured: false,
                quoConfigured: false,
                loPhoneSet: true,
                pending: 0,
                recent: [
                  {
                    id: 'w1',
                    at: '2026-10-02T14:00:00.000Z',
                    trigger: 'schedule',
                    dryRun: true,
                    contactLabel: 'Alex Buyer',
                    summary: "LoanPilot: WhatsApp from Alex Buyer, no reply in 5 min, auto-replied. 'Hi'",
                    status: 'preview',
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/whatsapp') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ ok: true, data: { enabled: false, dryRun: true, deliveries: [], skipped: 'disabled' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/summary')) {
          return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/api/hub/leads')) {
          return new Response(JSON.stringify({ ok: true, data: { leads: summary.data.leads, demo: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/assistant/activity')) {
          return new Response(JSON.stringify(activity), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderApp(<App />, { route: '/hub' })
    expect(await screen.findByRole('heading', { name: 'WhatsApp auto-reply' })).toBeInTheDocument()
    expect(screen.getByText(/Off until WHATSAPP_AUTOREPLY_ENABLED=true/)).toBeInTheDocument()
    expect(screen.getByText(hasText(/WhatsApp from Alex Buyer/))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview WhatsApp' }))
    expect(await screen.findByText(/WhatsApp preview only — 0 auto-replies, nothing sent/)).toBeInTheDocument()
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/whatsapp'))).toBe(true)
  })

  it('previews calendar guests without inviting anyone and asks to reconnect when write scope is missing', async () => {
    const calls: string[] = []
    const connected = {
      ...summary,
      data: {
        ...summary.data,
        google: {
          configured: true,
          connected: true,
          email: 'Joseph@teamcordeira.com',
          source: 'oauth',
          needsCalendarWrite: true,
        },
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/hub/calendar-guests') && (init?.method ?? 'GET') === 'GET') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                enabled: false,
                dryRun: false,
                emails: ['fcordeirajr@cliffcomortgage.com'],
                days: 60,
                notify: 'ics',
                gmailCanInvite: false,
                needsCalendarWrite: true,
                recent: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/calendar-guests') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                enabled: false,
                dryRun: true,
                added: 0,
                previews: [
                  {
                    id: 'evt-1',
                    summary: 'Siddick Chowdhury call refi',
                    startIso: '2026-10-05T15:00:00.000Z',
                    action: 'add',
                    reason: 'client call',
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/summary')) {
          return new Response(JSON.stringify(connected), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/api/hub/leads')) {
          return new Response(JSON.stringify({ ok: true, data: { leads: summary.data.leads, demo: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/assistant/activity')) {
          return new Response(JSON.stringify(activity), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderApp(<App />, { route: '/hub' })
    expect(await screen.findByRole('heading', { name: 'Calendar guests' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect Google' })).toBeInTheDocument()
    expect(screen.getByText(/without Calendar write access/)).toBeInTheDocument()
    expect(screen.getByText(/Off until CALENDAR_AUTO_GUEST_ENABLED=true/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview calendar guests' }))
    expect(await screen.findByText('Siddick Chowdhury call refi')).toBeInTheDocument()
    expect(screen.getByText(/Calendar preview only — 1 event would add a guest. Nobody was invited./)).toBeInTheDocument()
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/calendar-guests'))).toBe(true)
    expect(calls.some((call) => call.includes('/api/google'))).toBe(false)
  })

  it('shows the command mode card from the audit log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/hub/commands')) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                enabled: false,
                dryRun: true,
                line: '+15163869773',
                prefix: '',
                needsGoogleReconnect: false,
                recent: [
                  {
                    id: 'c1',
                    at: '2026-10-02T14:00:00.000Z',
                    actor: 'Joseph Cordeira',
                    role: 'owner',
                    command: 'book Siddick tomorrow 2pm',
                    summary: '[preview] Would book Siddick Chowdhury call refi Sat, Oct 3, 2:00 PM (30 min).',
                    status: 'preview',
                    dryRun: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/api/hub/summary')) {
          return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/api/hub/leads')) {
          return new Response(JSON.stringify({ ok: true, data: { leads: summary.data.leads, demo: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/assistant/activity')) {
          return new Response(JSON.stringify(activity), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    renderApp(<App />, { route: '/hub' })
    expect(await screen.findByRole('heading', { name: 'Command mode' })).toBeInTheDocument()
    expect(screen.getByText(/Off until COMMAND_MODE_ENABLED=true/)).toBeInTheDocument()
    expect(screen.getByText(/Would book Siddick Chowdhury call refi/)).toBeInTheDocument()
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

  it('hides fixture booking screens and sample copy when the hub is live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const live = {
          ok: true,
          data: {
            events: [],
            tasks: [],
            activity: [],
            warnings: [],
            stats: { upcomingEvents: 0, openTasks: 0, recentReplies: 0, escalations: 0, demo: false },
            google: { configured: true, connected: false, source: null },
            leads: [],
            demo: false,
          },
        }
        if (url.includes('/api/hub/')) {
          return new Response(JSON.stringify(live), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/api/assistant/activity')) {
          return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    renderApp(<App />, { route: '/hub' })
    expect(await screen.findByText(/real events and tasks/i)).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(Array.from(nav.querySelectorAll('a')).map((link) => link.textContent)).toEqual(['Hub', 'Calendar', 'Assistant'])
    expect(screen.queryByText(/sample events/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Maya Cordeira')).not.toBeInTheDocument()
    expect(screen.getByText('Connect Google Calendar to see upcoming events.')).toBeInTheDocument()
    expect(screen.getByText('Connect Google to see tasks.')).toBeInTheDocument()
  })

  it('shows an empty week screen instead of sample teammates when live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              events: [],
              tasks: [],
              activity: [],
              warnings: [],
              stats: { upcomingEvents: 0, openTasks: 0, recentReplies: 0, escalations: 0, demo: false },
              google: { configured: false, connected: false, source: null },
              leads: [],
              demo: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    renderApp(<App />, { route: '/week' })
    expect(await screen.findByRole('heading', { name: 'Week' })).toBeInTheDocument()
    expect(screen.getByText(/demo booking calendar/i)).toBeInTheDocument()
    expect(screen.queryByText('Maya Cordeira')).not.toBeInTheDocument()
    expect(screen.queryByText('Devon Reyes')).not.toBeInTheDocument()
  })
})
