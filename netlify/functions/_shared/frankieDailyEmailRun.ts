import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { env, isDemoMode } from './env'
import { gmailCanSend, loadGoogleTokens, resolveGoogleAccessToken } from './googleAuth'
import {
  FRANKIE_EMAIL_TO,
  buildFrankieDailyEmail,
  frankieDailyEmailEnabled,
  isFrankieEmailHour,
  isWeekdayEt,
  type FrankieEmail,
} from './frankieDailyEmail'
import { etDayKey, type FrankieBoard } from './frankieToday'
import { loadFrankieToday } from './frankieTodayRun'

export type FrankieEmailResult = {
  ok: true
  sent: boolean
  reason: string
  day: string
  to: string
  id?: string
}

const memorySent = new Set<string>()

function store() {
  try {
    return getStore('loanpilot-frankie-today')
  } catch {
    return null
  }
}

export function resetFrankieEmailForTests(): void {
  memorySent.clear()
}

async function alreadySent(day: string): Promise<boolean> {
  if (memorySent.has(day)) return true
  const blob = store()
  if (!blob) return false
  try {
    const raw = (await blob.get(`email/${day}`, { type: 'json' })) as { id?: string } | null
    return Boolean(raw)
  } catch {
    return false
  }
}

async function claimDay(day: string): Promise<boolean> {
  if (memorySent.has(day)) return false
  memorySent.add(day)
  const blob = store()
  if (!blob) return true
  try {
    const written = await blob.setJSON(`email/${day}`, { at: new Date().toISOString(), token: randomUUID() }, { onlyIfNew: true })
    if (written && (written as { modified?: boolean }).modified === false) {
      memorySent.delete(day)
      return false
    }
    return true
  } catch {
    memorySent.delete(day)
    return false
  }
}

async function releaseDay(day: string): Promise<void> {
  memorySent.delete(day)
  const blob = store()
  if (!blob) return
  try {
    await blob.delete(`email/${day}`)
  } catch {
    /* the next run can retry */
  }
}

async function markSent(day: string, id: string): Promise<void> {
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON(`email/${day}`, { at: new Date().toISOString(), id })
    await blob.setJSON('email-last', { day, id, at: new Date().toISOString() })
  } catch {
    /* the claim already blocks a second send */
  }
}

async function connectedGmailToken(): Promise<string | null> {
  const staticToken = env('GMAIL_ACCESS_TOKEN').trim()
  if (staticToken) return staticToken
  const stored = await loadGoogleTokens()
  if (!stored?.accessToken || !gmailCanSend(stored.scope)) return null
  const { accessToken } = await resolveGoogleAccessToken()
  return accessToken
}

function encodeRaw(message: string): string {
  return Buffer.from(message, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Gmail API send used for Frankie's calendar invites. Sends as the connected Google user. */
export async function sendFrankieGmail(email: FrankieEmail): Promise<{ id: string }> {
  const token = await connectedGmailToken()
  if (!token || isDemoMode()) throw new Error('Gmail is not connected')
  const boundary = `frankie-${randomUUID()}`
  const raw = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    email.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    email.html,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encodeRaw(raw) }),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400)
    throw new Error(`Gmail send failed: ${res.status} ${body}`.slice(0, 500))
  }
  const data = (await res.json()) as { id?: string }
  return { id: data.id ?? 'sent' }
}

export async function previewFrankieDailyEmail(now = new Date()): Promise<FrankieEmail> {
  const board = await loadFrankieToday({ now })
  return buildFrankieDailyEmail(board, now)
}

export async function frankieEmailMeta(): Promise<{
  enabled: boolean
  to: string
  from: string
  schedule: string
  sentToday: boolean
}> {
  const now = new Date()
  const day = etDayKey(now)
  return {
    enabled: frankieDailyEmailEnabled(),
    to: FRANKIE_EMAIL_TO,
    from: 'joseph@teamcordeira.com',
    schedule: 'weekdays 8:00 AM ET',
    sentToday: await alreadySent(day),
  }
}

export async function runFrankieDailyEmail(options?: {
  now?: Date
  load?: () => Promise<FrankieBoard>
  send?: (email: FrankieEmail) => Promise<{ id: string }>
  claim?: (day: string) => Promise<boolean>
  release?: (day: string) => Promise<void>
  sent?: (day: string) => Promise<boolean>
}): Promise<FrankieEmailResult> {
  const now = options?.now ?? new Date()
  const day = etDayKey(now)
  const base = { ok: true as const, sent: false, day, to: FRANKIE_EMAIL_TO }
  if (!frankieDailyEmailEnabled()) return { ...base, reason: 'disabled' }
  if (!isFrankieEmailHour(now)) return { ...base, reason: isWeekdayEt(now) ? 'before-8' : 'weekend' }
  const sent = options?.sent ?? alreadySent
  if (await sent(day)) return { ...base, reason: 'already-sent' }
  if (!options?.send && isDemoMode()) return { ...base, reason: 'demo' }
  const load = options?.load ?? (() => loadFrankieToday({ now }))
  const board = await load()
  const email = buildFrankieDailyEmail(board, now)
  const claim = options?.claim ?? claimDay
  if (!(await claim(day))) return { ...base, reason: 'already-sent' }
  try {
    const send = options?.send ?? sendFrankieGmail
    const result = await send(email)
    if (!options?.send) await markSent(day, result.id)
    return { ...base, sent: true, reason: 'sent', id: result.id }
  } catch (err) {
    await (options?.release ?? releaseDay)(day)
    return { ...base, reason: err instanceof Error ? err.message : 'send-failed' }
  }
}
