import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandCenterPage } from './CommandCenterPage'
import { renderApp } from '../test/render'

const center = {
  ok: true,
  data: {
    enabled: true,
    dryRun: false,
    ownerName: 'Joseph Cordeira',
    team: [{ name: 'Frankie Cordeira', phone: '+16315126480', title: 'LOA' }],
    thread: [
      {
        id: 'sms-1',
        at: '2026-10-02T14:00:00.000Z',
        actor: 'Frankie Cordeira',
        role: 'team',
        source: 'sms',
        command: 'when is Joe free today',
        reply: 'Open: Fri, Oct 2, 3:00 PM.',
        status: 'done',
        dryRun: false,
      },
    ],
    pending: {
      id: 'p1',
      kind: 'choice',
      summary: 'Pick a lead',
      choices: [
        { n: 1, label: 'Siddick Chowdhury' },
        { n: 2, label: 'Siddick Rahman' },
      ],
    },
    chips: [
      { label: "What's on today", text: "what's on today", send: true },
      { label: 'Text team', text: 'text the team: ', send: false },
    ],
  },
}

describe('Command Center', () => {
  it('shows Hub and SMS turns, choice buttons, and confirms a client text', async () => {
    const posts: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? init.body : ''
      if (init?.method === 'POST') posts.push({ url, body })
      if (url.includes('/api/hub/command-center') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(center), { status: 200 })
      }
      if (url.includes('/api/hub/command-center') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ...center,
          data: { ...center.data, pending: null, reply: 'Texted Siddick Chowdhury.' },
        }), { status: 200 })
      }
      if (url.includes('/api/hub/messages') && url.includes('q=')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { leads: [{ id: 42, name: 'Alex Buyer', phone: '+15165550100', stage: 'Lead' }] },
        }), { status: 200 })
      }
      if (url.includes('/api/hub/messages') && url.includes('phone=')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { messages: [{ id: 'm1', at: '2026-10-02T13:00:00.000Z', direction: 'in', text: 'Can we talk?' }] },
        }), { status: 200 })
      }
      if (url.includes('/api/hub/messages') && init?.method === 'POST') {
        const parsed = JSON.parse(body) as { confirmed?: boolean }
        if (!parsed.confirmed) {
          return new Response(JSON.stringify({ ok: true, data: { sent: false, needsConfirm: true, preview: 'Text Alex Buyer: on my way' } }), { status: 200 })
        }
        return new Response(JSON.stringify({ ok: true, data: { sent: true, id: 'sms-2' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'missing' }), { status: 404 })
    }))
    const user = userEvent.setup()
    renderApp(<CommandCenterPage />, { route: '/command' })
    expect(await screen.findByRole('heading', { name: 'Command Center' })).toBeInTheDocument()
    expect(screen.getByText('SMS')).toBeInTheDocument()
    expect(screen.getByText('when is Joe free today')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1. Siddick Chowdhury' }))
    expect(posts.some((post) => post.body.includes('"choice":"1"'))).toBe(true)
    const messages = screen.getByRole('region', { name: 'Messages' })
    await user.click(within(messages).getByRole('button', { name: 'Frankie' }))
    expect(await screen.findByText('Can we talk?')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search leads'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('button', { name: 'Alex Buyer' }))
    await user.type(screen.getByLabelText('Message'), 'on my way')
    await user.click(within(messages).getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Text Alex Buyer: on my way')).toBeInTheDocument()
    expect(posts.filter((post) => post.url.includes('/messages') && post.body.includes('"confirmed":true'))).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(posts.some((post) => post.url.includes('/messages') && post.body.includes('"confirmed":true'))).toBe(true)
  })
})
