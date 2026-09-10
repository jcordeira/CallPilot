import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'

describe('reducer', () => {
  it('toggles a connection', () => {
    const s = reducer(initialState(), { type: 'connection/toggle', provider: 'icloud' })
    expect(s.settings.connections.find((c) => c.provider === 'icloud')?.enabled).toBe(true)
  })
  it('adds a booking and its calendar event together', () => {
    const s0 = initialState()
    const s = reducer(s0, {
      type: 'booking/add',
      booking: { id: 'b1', callTypeId: 'intro', hostId: 'maya', dateKey: '2026-09-15', start: 9, end: 9.25, clientName: 'A', clientEmail: 'a@x.io', guests: [], notes: '', timeZone: 'America/New_York', createdAt: '' },
      event: { id: 'e1', userId: 'maya', dateKey: '2026-09-15', start: 9, end: 9.25, title: 'Intro — A', kind: 'client' },
    })
    expect(s.bookings).toHaveLength(1)
    expect(s.events).toHaveLength(s0.events.length + 1)
  })
  it('refuses duplicate invites by email', () => {
    const s0 = initialState()
    const dup = { ...s0.team[1], id: 'x' }
    expect(reducer(s0, { type: 'team/invite', member: dup }).team).toHaveLength(s0.team.length)
  })
})
