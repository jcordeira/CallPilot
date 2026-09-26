import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@netlify/functions'
import handler from '../../netlify/functions/public-api'

const context = { requestId: 'test', params: {} } as Context

function call(path: string, init?: RequestInit) {
  return handler(new Request(`http://localhost${path}`, init), context)
}

afterEach(() => {
  delete process.env.LOANPILOT_API_KEY
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  process.env.ASSISTANT_DEMO_MODE = 'true'
})

describe('public API', () => {
  it('returns 401 when the key is missing or wrong', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const missing = await call('/api/v1/health')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ ok: false, error: 'Unauthorized' })

    const wrong = await call('/api/v1/health', { headers: { Authorization: 'Bearer nope' } })
    expect(wrong.status).toBe(401)
  })

  it('accepts demo-key and lists sample tasks', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    delete process.env.GOOGLE_TASKS_ACCESS_TOKEN
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    const res = await call('/api/v1/tasks', { headers: { 'X-Api-Key': 'demo-key' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { tasks: { title: string; source: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.data.tasks.some((task) => /pre-approval/i.test(task.title))).toBe(true)
    expect(body.data.tasks.some((task) => task.source === 'fub')).toBe(true)
  })

  it('accepts the configured key and rejects demo-key when demo mode is off', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'false'
    process.env.FOLLOW_UP_BOSS_API_KEY = 'fub-test'
    process.env.LOANPILOT_API_KEY = 'secret-key'
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN
    delete process.env.GOOGLE_TASKS_ACCESS_TOKEN

    const denied = await call('/api/v1/health', { headers: { 'X-Api-Key': 'demo-key' } })
    expect(denied.status).toBe(401)

    const ok = await call('/api/v1/health', { headers: { Authorization: 'Bearer secret-key' } })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; data: { service: string; aiProvider: string } }
    expect(body.ok).toBe(true)
    expect(body.data.service).toBe('loanpilot')
    expect(body.data.aiProvider).toBe('grok')
  })

  it('rejects the wrong method', async () => {
    const res = await call('/api/v1/health', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-key' },
    })
    expect(res.status).toBe(405)
  })
})
