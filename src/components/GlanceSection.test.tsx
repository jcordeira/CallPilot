import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlanceSection } from './GlanceSection'
import type { GlanceBoard, GlanceItem } from '../lib/hubApi'
import { renderApp } from '../test/render'

const items: GlanceItem[] = [
  {
    key: 'fub:task:1',
    id: '1',
    kind: 'task',
    source: 'fub',
    title: 'Send checklist',
    whenLabel: 'Today',
    dayKey: '2026-10-19',
    at: '2026-10-19T23:59:59',
    overdue: true,
    personId: 1001,
    personName: 'Alex Buyer',
  },
  {
    key: 'google:appointment:e',
    id: 'e',
    kind: 'appointment',
    source: 'google',
    title: 'Call Jordan',
    whenLabel: '2:00 PM',
    dayKey: '2026-10-19',
    at: '2026-10-19T18:00:00.000Z',
    overdue: false,
  },
  {
    key: 'google:task:g',
    id: 'g',
    kind: 'task',
    source: 'google',
    title: 'Review lock',
    whenLabel: 'Oct 20',
    dayKey: '2026-10-20',
    at: '2026-10-20T23:59:59',
    overdue: false,
  },
]

const detail = {
  description: 'Bring the folder',
  location: 'Office',
  attendees: [{ label: 'Alex Buyer' }],
  meetLink: 'https://meet.google.com/abc-defg-hij',
  personNotes: [
    { id: 'n1', headline: 'Docs requested', body: 'Pay stubs.', long: false },
    { id: 'n2', headline: 'Older rate conversation', body: 'A long note that stays collapsed until show more.', long: true },
    { id: 'n3', headline: 'First inquiry', body: 'Inbound from the website.', long: false },
  ],
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function Lists({ board }: { board: GlanceBoard }) {
  const [items, setItems] = useState(board.all)
  const today = items.filter((item) => item.overdue)
  return (
    <>
      <GlanceSection
        title="Today at a glance"
        headingId="today"
        mode="today"
        items={today}
        warnings={board.warnings}
        needsTasks={board.needsTasks}
        error={null}
        loading={false}
        onDone={(item) => setItems((prev) => prev.filter((row) => row.key !== item.key))}
        onRestore={(item) => setItems((prev) => (prev.some((row) => row.key === item.key) ? prev : [item, ...prev]))}
      />
      <GlanceSection
        title="All tasks & appointments"
        headingId="all"
        mode="all"
        items={items}
        warnings={[]}
        needsTasks={false}
        error={null}
        loading={false}
        todayKey="2026-10-19"
        onDone={(item) => setItems((prev) => prev.filter((row) => row.key !== item.key))}
        onRestore={(item) => setItems((prev) => (prev.some((row) => row.key === item.key) ? prev : [item, ...prev]))}
      />
    </>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Glance sections', () => {
  it('keeps the row to one line and loads details, notes, and mark-done on tap', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/hub/glance-detail')) return json(detail)
        if (url.includes('/api/hub/glance-done')) return json({ done: true })
        if (url.includes('/api/hub/glance-undo')) return json({ done: true })
        return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderApp(
      <Lists
        board={{
          today: [],
          all: items,
          warnings: ['Google unavailable'],
          needsTasks: true,
          todayKey: '2026-10-19',
          generatedAt: '2026-10-19T15:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Today at a glance' })).toBeInTheDocument()
    expect(screen.getByText('Google unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect Google' })).toHaveAttribute('href', '/api/google/connect')
    const alex = screen.getAllByRole('link', { name: 'Alex Buyer' })
    expect(alex[0]).toHaveAttribute('href', 'https://teamcordeira.followupboss.com/2/people/view/1001')
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
    expect(screen.queryByText('Bring the folder')).not.toBeInTheDocument()
    expect(screen.queryByText('Pay stubs.')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Complete Call Jordan' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: 'Complete Send checklist' }).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: /Call Jordan/ })[0])
    expect(await screen.findByText('Bring the folder')).toBeInTheDocument()
    expect(screen.getByText('Location: Office')).toBeInTheDocument()
    expect(screen.getByText(/With Alex Buyer/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join Meet' })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij')
    expect(screen.getByText('Docs requested')).toBeInTheDocument()
    expect(screen.queryByText('First inquiry')).not.toBeInTheDocument()
    expect(screen.queryByText(/A long note/)).not.toBeInTheDocument()
    const more = screen.getAllByRole('button', { name: 'Show more' })
    await user.click(more[0])
    expect(screen.getByText(/A long note/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Show more' }).at(-1)!)
    expect(screen.getByText('First inquiry')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Appointments' }))
    expect(screen.queryByRole('button', { name: /Review lock/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Call Jordan/ }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    await user.click(screen.getByRole('button', { name: 'FUB' }))
    expect(screen.queryByRole('button', { name: /Call Jordan/ })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('checkbox', { name: 'Complete Send checklist' })[0])
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(calls.some((call) => call.startsWith('POST') && call.includes('/api/hub/glance-done'))).toBe(true)
    expect(await screen.findByText('Nothing due today.')).toBeInTheDocument()
  })

  it('shows the first 10 today items until Show all expands them', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      key: `fub:task:${index}`,
      id: String(index),
      kind: 'task' as const,
      source: 'fub' as const,
      title: `Task ${index}`,
      whenLabel: 'Today',
      dayKey: '2026-10-19',
      at: `2026-10-19T${String(index).padStart(2, '0')}:00:00.000Z`,
      overdue: index < 2,
    }))
    const user = userEvent.setup()
    renderApp(
      <GlanceSection
        title="Today at a glance"
        headingId="today-cap"
        mode="today"
        items={many}
        warnings={[]}
        needsTasks={false}
        error={null}
        loading={false}
        onDone={() => undefined}
        onRestore={() => undefined}
      />,
    )
    expect(screen.getByText('Task 0')).toBeInTheDocument()
    expect(screen.getByText('Task 9')).toBeInTheDocument()
    expect(screen.queryByText('Task 10')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all (12)' }))
    expect(screen.getByText('Task 11')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Task 11')).not.toBeInTheDocument()
  })

  it('undoes a completed task and restores the row when the complete call fails', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/hub/glance-undo')) return json({ done: true })
        if (url.includes('/api/hub/glance-done') && calls.filter((call) => call.includes('glance-done')).length === 1) {
          return json({ done: true })
        }
        return new Response(JSON.stringify({ ok: false, error: 'Google Tasks update failed' }), { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderApp(
      <GlanceSection
        title="Today at a glance"
        headingId="today-undo"
        mode="today"
        items={items.filter((item) => item.kind === 'task' && item.overdue)}
        warnings={[]}
        needsTasks={false}
        error={null}
        loading={false}
        onDone={() => undefined}
        onRestore={() => undefined}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Complete Send checklist' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(calls.some((call) => call.includes('/api/hub/glance-undo'))).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Complete Send checklist' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Complete Send checklist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Tasks update failed')
    expect(screen.getByRole('checkbox', { name: 'Complete Send checklist' })).toBeInTheDocument()
  })
})
