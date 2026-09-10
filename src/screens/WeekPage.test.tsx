import { describe, expect, it } from 'vitest'
import { layoutColumn } from './WeekPage'
import type { CalendarEvent } from '../lib/types'

const ev = (id: string, start: number, end: number): CalendarEvent => ({ id, userId: 'u', dateKey: '2026-09-10', start, end, title: id, kind: 'task' })

describe('layoutColumn', () => {
  it('gives non-overlapping events the full width', () => {
    const out = layoutColumn([ev('a', 9, 10), ev('b', 10, 11)])
    expect(out.map((p) => [p.event.id, p.lane, p.lanes])).toEqual([['a', 0, 1], ['b', 0, 1]])
  })
  it('splits overlapping events into lanes and shares the lane count across the cluster', () => {
    const out = layoutColumn([ev('a', 9.5, 10.5), ev('b', 10, 10.5), ev('c', 10.5, 11), ev('d', 14, 15)])
    const byId = Object.fromEntries(out.map((p) => [p.event.id, [p.lane, p.lanes]]))
    expect(byId.a).toEqual([0, 2])
    expect(byId.b).toEqual([1, 2])
    // c starts exactly when the cluster ends → no overlap, full width
    expect(byId.c).toEqual([0, 1])
    // d is a separate cluster
    expect(byId.d).toEqual([0, 1])
  })
})
