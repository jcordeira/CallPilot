import { afterEach, describe, expect, it } from 'vitest'
import {
  hubSessionFromRequest,
  passwordMatches,
  requireHubSession,
  signHubSession,
  verifyHubSession,
} from '../../netlify/functions/_shared/hubSession'

afterEach(() => {
  delete process.env.HUB_PASSWORD
  delete process.env.HUB_SESSION_SECRET
})

describe('hub session', () => {
  it('signs a cookie that expires and rejects a bad password', () => {
    process.env.HUB_PASSWORD = 'correct horse'
    const token = signHubSession(Date.parse('2026-10-02T14:00:00.000Z'))
    expect(verifyHubSession(token, Date.parse('2026-10-03T14:00:00.000Z'))).toBe(true)
    expect(verifyHubSession(token, Date.parse('2026-10-20T14:00:00.000Z'))).toBe(false)
    expect(verifyHubSession(`${token}x`, Date.parse('2026-10-03T14:00:00.000Z'))).toBe(false)
    expect(passwordMatches('correct horse')).toBe(true)
    expect(passwordMatches('nope')).toBe(false)
    const req = new Request('https://site.example/api/hub/calendar', { headers: { cookie: `lp_hub=${encodeURIComponent(token)}` } })
    expect(hubSessionFromRequest(req, Date.parse('2026-10-03T14:00:00.000Z'))).toBe(true)
    expect(requireHubSession(new Request('https://site.example/api/hub/calendar'))?.status).toBe(401)
  })

  it('stays closed when the password is unset', () => {
    delete process.env.HUB_PASSWORD
    expect(requireHubSession(new Request('https://site.example/api/hub/calendar'))?.status).toBe(503)
  })
})
