import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env'
import { readCookie } from './googleAuth'
import { jsonFail } from './http'

export const HUB_COOKIE = 'lp_hub'

export function hubPassword(): string {
  return env('HUB_PASSWORD')
}

export function hubSessionSecret(): string {
  return env('HUB_SESSION_SECRET') || hubPassword()
}

function sessionDays(): number {
  const days = Number(env('HUB_SESSION_DAYS', '7'))
  if (!Number.isFinite(days) || days <= 0) return 7
  return Math.min(30, days)
}

export function signHubSession(now = Date.now()): string {
  const exp = Math.floor(now + sessionDays() * 86_400_000)
  const payload = String(exp)
  const sig = createHmac('sha256', hubSessionSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyHubSession(token: string | null, now = Date.now()): boolean {
  if (!token || !hubPassword() || !hubSessionSecret()) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const exp = Number(payload)
  if (!Number.isFinite(exp) || exp * 1 <= now) return false
  const expected = createHmac('sha256', hubSessionSecret()).update(payload).digest('base64url')
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function passwordMatches(provided: string): boolean {
  const expected = hubPassword()
  if (!expected || !provided) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function hubSessionFromRequest(req: Request, now = Date.now()): boolean {
  return verifyHubSession(readCookie(req.headers.get('cookie'), HUB_COOKIE), now)
}

export function hubSessionCookie(token: string, secure: boolean): string {
  const maxAge = Math.floor(sessionDays() * 86_400)
  const parts = [`${HUB_COOKIE}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearHubSessionCookie(secure: boolean): string {
  const parts = [`${HUB_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** Null when the request may continue. */
export function requireHubSession(req: Request): Response | null {
  if (hubSessionFromRequest(req)) return null
  if (!hubPassword()) return jsonFail('Set HUB_PASSWORD before using the Hub', 503)
  return jsonFail('Sign in required', 401)
}
