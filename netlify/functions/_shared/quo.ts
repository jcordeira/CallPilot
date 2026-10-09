import { getStore, type Store } from '@netlify/blobs'
import { zonedParts } from './commandTime'
import { env, isDemoMode } from './env'

/** GSM-7 basic alphabet. One character is one septet. Accented letters in this set stay GSM-7. */
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM7 = new Set(GSM7_BASIC)
/** GSM 03.38 extension table. Each of these is two septets. € is U+20AC. */
const GSM7_EXT = new Set(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '\u20AC'])

const GSM7_PUNCTUATION: Record<string, string> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u202F': ' ',
  '\u2007': ' ',
  '\uFEFF': ' ',
}

/** Map smart punctuation, drop emoji, and keep GSM-7 basic plus extension characters. */
export function toGsm7(input: string): string {
  let mapped = ''
  for (const char of input) mapped += GSM7_PUNCTUATION[char] ?? char
  let out = ''
  for (const char of mapped) if (GSM7.has(char) || GSM7_EXT.has(char)) out += char
  return out
}

export type SmsEncoding = 'gsm7' | 'ucs2'

export type SmsSegmentCount = {
  encoding: SmsEncoding
  units: number
  segments: number
}

function segmentsFor(units: number, single: number, multi: number): number {
  if (units <= 0) return 0
  if (units <= single) return 1
  return Math.ceil(units / multi)
}

/**
 * Exact segment count. GSM-7 basic chars are 1 septet, extension chars are 2.
 * One segment holds 160 septets; each extra part holds 153. Any character outside
 * GSM-7 switches the whole message to UCS-2 (UTF-16 code units, 70 then 67).
 */
export function countSmsSegments(input: string): SmsSegmentCount {
  let septets = 0
  for (const char of input) {
    if (GSM7.has(char)) septets += 1
    else if (GSM7_EXT.has(char)) septets += 2
    else {
      const units = input.length
      return { encoding: 'ucs2', units, segments: segmentsFor(units, 70, 67) }
    }
  }
  return { encoding: 'gsm7', units: septets, segments: segmentsFor(septets, 160, 153) }
}

/** True when every character can be sent as GSM-7, including the two-septet extension set. */
export function isGsm7(input: string): boolean {
  return countSmsSegments(input).encoding === 'gsm7'
}

/** Segment count after GSM-7 normalization. Multipart GSM-7 packs 153 septets each. */
export function gsmSegmentCount(input: string): number {
  const counted = countSmsSegments(input)
  if (counted.encoding === 'gsm7') return counted.segments
  return countSmsSegments(toGsm7(input)).segments
}

const LINK_RE = /(?:https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]+)/i

export function collapseSms(input: string): string {
  return input.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim()
}

function segmentBudget(encoding: SmsEncoding, segments: number): number {
  if (segments <= 1) return encoding === 'gsm7' ? 160 : 70
  return encoding === 'gsm7' ? segments * 153 : segments * 67
}

function cutToUnits(text: string, maxUnits: number, encoding: SmsEncoding): string {
  if (maxUnits <= 0) return ''
  let out = ''
  let used = 0
  for (const char of text) {
    const cost = encoding === 'ucs2' ? char.length : GSM7_EXT.has(char) ? 2 : 1
    if (used + cost > maxUnits) break
    out += char
    used += cost
  }
  return out.trimEnd()
}

/**
 * Keep the opening lines and the first link inside the segment cap.
 * `fub` ends with `+N more in FUB`. `hub` ends with `See Hub`.
 */
export function fitSms(content: string, maxSegments = 2, style: 'fub' | 'hub' = 'fub'): string {
  const collapsed = collapseSms(content)
  if (maxSegments <= 0) return ''
  if (countSmsSegments(collapsed).segments <= maxSegments) return collapsed
  const link = collapsed.match(LINK_RE)?.[0]
  const withoutLink = link ? collapseSms(collapsed.split(link).join(' ')) : collapsed
  const lines = withoutLink.split('\n').map((line) => line.trim()).filter(Boolean)
  const encoding = countSmsSegments(collapsed).encoding
  const suffixFor = (dropped: number) => (style === 'hub' ? ' See Hub' : ` +${Math.max(dropped, 1)} more in FUB`)
  const join = (kept: string[], dropped: number) => {
    const head = kept.join('\n')
    const linkPart = link ? `${head ? ' ' : ''}${link}` : ''
    const suffix = dropped > 0 ? suffixFor(dropped) : ''
    return `${head}${linkPart}${suffix}`.trim()
  }
  const whole = join(lines, 0)
  if (countSmsSegments(whole).segments <= maxSegments) return whole
  for (let keep = lines.length - 1; keep >= 1; keep -= 1) {
    const candidate = join(lines.slice(0, keep), lines.length - keep)
    if (countSmsSegments(candidate).segments <= maxSegments) return candidate
  }
  const suffix = suffixFor(Math.max(lines.length, 1))
  const tail = `${link ? ` ${link}` : ''}${suffix}`
  const budget = segmentBudget(encoding, maxSegments) - countSmsSegments(tail).units
  const head = cutToUnits(lines[0] ?? withoutLink, budget, encoding)
  const cut = `${head}${tail}`.trim()
  if (countSmsSegments(cut).segments <= maxSegments) return cut
  const minimal = `${link ?? ''}${suffix}`.trim()
  if (countSmsSegments(minimal).segments <= maxSegments) return minimal
  return cutToUnits(suffix.trim(), segmentBudget(encoding, maxSegments), encoding)
}

const QUO_BACKOFF_MS = 30 * 60 * 1000
const SMS_TIME_ZONE = 'America/New_York'
const SMS_LIMIT_NOTICE_TO = '+15169969070'
let backoffUntilMs = 0

export type SmsPriority = 'high' | 'normal'
export type SmsTruncate = 'auto' | 'exempt'

export type SmsSendInput = {
  to: string
  content: string
  priority?: SmsPriority
  truncate?: SmsTruncate
  truncateStyle?: 'fub' | 'hub'
  now?: Date
}

export type SmsSkip = 'not_configured' | 'budget'

export type SmsSendResult = { id: string } | { skipped: SmsSkip }

type SmsUsage = {
  date: string
  total: number
  byPhone: Record<string, number>
  noticeSent: boolean
}

type UsageDecision = {
  allowed: boolean
  sendNotice: boolean
  reason?: 'daily' | 'recipient' | 'unavailable'
}

const memoryUsage = new Map<string, SmsUsage>()
let usageChain: Promise<void> = Promise.resolve()

export class QuoSmsError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(`Quo SMS failed: ${status} ${detail}`)
    this.name = 'QuoSmsError'
    this.status = status
  }
}

export function isQuoPaymentBlock(err: unknown): boolean {
  return err instanceof QuoSmsError && err.status === 402
}

export function resetQuoForTests() {
  backoffUntilMs = 0
  memoryUsage.clear()
  usageChain = Promise.resolve()
}

function positiveInt(key: string, fallback: number): number {
  const parsed = Number(env(key).trim())
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function smsLimits() {
  const daily = positiveInt('SMS_DAILY_SEGMENT_CAP', 60)
  return {
    maxSegments: positiveInt('SMS_MAX_SEGMENTS_PER_MESSAGE', 2),
    daily,
    perRecipient: positiveInt('SMS_PER_RECIPIENT_DAILY_CAP', 20),
    normalCeiling: Math.floor(daily * 0.8),
  }
}

export function dailyLimitNotice(cap: number): string {
  return `LoanPilot: daily text limit hit (${cap} segs). Alerts continue as FUB notes until midnight.`
}

function etDate(now: Date): string {
  const parts = zonedParts(now, SMS_TIME_ZONE)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function emptyUsage(date: string): SmsUsage {
  return { date, total: 0, byPhone: {}, noticeSent: false }
}

function cloneUsage(usage: SmsUsage): SmsUsage {
  return { date: usage.date, total: usage.total, byPhone: { ...usage.byPhone }, noticeSent: usage.noticeSent }
}

function normalizeUsage(raw: unknown, date: string): SmsUsage {
  const record = raw && typeof raw === 'object' ? raw as Partial<SmsUsage> : {}
  const byPhone: Record<string, number> = {}
  if (record.byPhone && typeof record.byPhone === 'object') {
    for (const [phone, count] of Object.entries(record.byPhone)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) byPhone[phone] = count
    }
  }
  return {
    date,
    total: typeof record.total === 'number' && record.total > 0 ? record.total : 0,
    byPhone,
    noticeSent: record.noticeSent === true,
  }
}

function applyUsage(current: SmsUsage, input: { phone: string; segments: number; priority: SmsPriority; bypass?: boolean }): { usage: SmsUsage; result: UsageDecision; changed: boolean } {
  const limits = smsLimits()
  const usage = cloneUsage(current)
  if (input.segments <= 0) return { usage, result: { allowed: true, sendNotice: false }, changed: false }
  const used = usage.byPhone[input.phone] ?? 0
  const recipientBlock = !input.bypass && used + input.segments > limits.perRecipient
  const absoluteBlock = !input.bypass && usage.total + input.segments > limits.daily
  const normalBlock = !input.bypass && input.priority !== 'high' && usage.total + input.segments > limits.normalCeiling
  if (recipientBlock || absoluteBlock || normalBlock) {
    const sendNotice = absoluteBlock && !usage.noticeSent
    if (sendNotice) {
      usage.noticeSent = true
      usage.total += 1
      usage.byPhone[SMS_LIMIT_NOTICE_TO] = (usage.byPhone[SMS_LIMIT_NOTICE_TO] ?? 0) + 1
    }
    const reason = recipientBlock && !absoluteBlock && !normalBlock ? 'recipient' as const : 'daily' as const
    return { usage, result: { allowed: false, sendNotice, reason }, changed: sendNotice }
  }
  usage.total += input.segments
  usage.byPhone[input.phone] = used + input.segments
  return { usage, result: { allowed: true, sendNotice: false }, changed: true }
}

function releaseUsage(current: SmsUsage, phone: string, segments: number): SmsUsage {
  const usage = cloneUsage(current)
  usage.total = Math.max(0, usage.total - segments)
  const next = Math.max(0, (usage.byPhone[phone] ?? 0) - segments)
  if (next === 0) delete usage.byPhone[phone]
  else usage.byPhone[phone] = next
  return usage
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = usageChain.then(fn, fn)
  usageChain = run.then(() => undefined, () => undefined)
  return run
}

async function commitBlob(blob: Store, date: string, mutate: (current: SmsUsage) => { usage: SmsUsage; result: UsageDecision; changed: boolean }): Promise<UsageDecision> {
  const key = `sms-usage/${date}`
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let current = emptyUsage(date)
    let etag: string | undefined
    try {
      const got = await blob.getWithMetadata(key, { type: 'json', consistency: 'strong' })
      if (got?.data) current = normalizeUsage(got.data, date)
      etag = got?.etag
    } catch {
      return { allowed: false, sendNotice: false, reason: 'unavailable' }
    }
    const applied = mutate(current)
    if (!applied.changed) return applied.result
    try {
      const wrote = await blob.setJSON(key, applied.usage, etag ? { onlyIfMatch: etag } : { onlyIfNew: true })
      if (!wrote.modified) continue
      return applied.result
    } catch {
      return { allowed: false, sendNotice: false, reason: 'unavailable' }
    }
  }
  return { allowed: false, sendNotice: false, reason: 'unavailable' }
}

async function commitUsage(input: { phone: string; segments: number; priority: SmsPriority; now: Date; bypass?: boolean }): Promise<UsageDecision> {
  const date = etDate(input.now)
  return serialized(async () => {
    const blob = quoStore()
    if (!blob) {
      const applied = applyUsage(memoryUsage.get(date) ?? emptyUsage(date), input)
      if (applied.changed) memoryUsage.set(date, applied.usage)
      return applied.result
    }
    return commitBlob(blob, date, (current) => applyUsage(current, input))
  })
}

async function rollbackUsage(phone: string, segments: number, now: Date): Promise<void> {
  if (segments <= 0) return
  const date = etDate(now)
  await serialized(async () => {
    const blob = quoStore()
    if (!blob) {
      memoryUsage.set(date, releaseUsage(memoryUsage.get(date) ?? emptyUsage(date), phone, segments))
      return
    }
    await commitBlob(blob, date, (current) => ({ usage: releaseUsage(current, phone, segments), result: { allowed: true, sendNotice: false }, changed: true }))
  })
}

export type SmsUsageStatus = {
  date: string
  used: number
  cap: number
  normalCeiling: number
  perRecipientCap: number
  noticeSent: boolean
}

/** Today's segments versus the daily cap. Does not increment the counter. */
export async function getSmsUsage(now = new Date()): Promise<SmsUsageStatus> {
  const date = etDate(now)
  const limits = smsLimits()
  const status = (usage?: SmsUsage): SmsUsageStatus => ({
    date,
    used: usage?.total ?? 0,
    cap: limits.daily,
    normalCeiling: limits.normalCeiling,
    perRecipientCap: limits.perRecipient,
    noticeSent: usage?.noticeSent === true,
  })
  const blob = quoStore()
  if (!blob) return status(memoryUsage.get(date))
  const got = await blob.getWithMetadata(`sms-usage/${date}`, { type: 'json', consistency: 'strong' })
  return status(got?.data ? normalizeUsage(got.data, date) : undefined)
}

function quoStore(): Store | null {
  try {
    return getStore({ name: 'loanpilot-quo', consistency: 'strong' })
  } catch {
    return null
  }
}

async function readBackoffUntil(): Promise<number> {
  if (backoffUntilMs > Date.now()) return backoffUntilMs
  const blob = quoStore()
  if (!blob) return backoffUntilMs
  try {
    const raw = (await blob.get('sms-backoff', { type: 'json', consistency: 'strong' })) as { until?: string } | null
    const until = raw?.until ? Date.parse(raw.until) : 0
    if (Number.isFinite(until) && until > backoffUntilMs) backoffUntilMs = until
  } catch {
    /* a missed flag must not silence texts forever */
  }
  return backoffUntilMs
}

/** True while a 402 backoff flag is still in the future. */
export async function quoSmsPaused(now = new Date()): Promise<boolean> {
  const until = await readBackoffUntil()
  return until > now.getTime()
}

/** Skip every Quo send for 30 minutes after a 402. The clock is the caller's `now`. */
export async function noteQuoPaymentFailure(now = new Date()): Promise<void> {
  const until = now.getTime() + QUO_BACKOFF_MS
  if (until > backoffUntilMs) backoffUntilMs = until
  const blob = quoStore()
  if (!blob) return
  try {
    await blob.setJSON('sms-backoff', { until: new Date(backoffUntilMs).toISOString() })
  } catch {
    /* memory flag still skips sends in this process */
  }
}

/** True when an API key and a sending inbox number are both set. */
export function quoSmsConfigured(): boolean {
  return env('QUO_API_KEY').trim() !== '' && env('QUO_FROM_NUMBER').trim() !== ''
}

function prepareSms(input: SmsSendInput): { content: string; segments: number } {
  let content = toGsm7(input.content)
  if (input.truncate !== 'exempt') content = fitSms(content, smsLimits().maxSegments, input.truncateStyle ?? 'fub')
  return { content, segments: countSmsSegments(content).segments }
}

async function postQuo(to: string, content: string): Promise<{ id: string }> {
  const from = env('QUO_FROM_NUMBER')
  const apiKey = env('QUO_API_KEY')
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, from, to: [to] }),
  })
  if (!res.ok) {
    const detail = await res.text()
    if (res.status === 402) await noteQuoPaymentFailure()
    throw new QuoSmsError(res.status, detail)
  }
  const data = (await res.json()) as { data?: { id?: string }; id?: string }
  return { id: data.data?.id ?? data.id ?? `sms-${Date.now()}` }
}

async function sendLimitNotice(): Promise<void> {
  const text = dailyLimitNotice(smsLimits().daily)
  try {
    await postQuo(SMS_LIMIT_NOTICE_TO, text)
  } catch (err) {
    const reason = err instanceof Error && err.message ? err.message : 'notice failed'
    console.log(`[sms] daily limit notice failed: ${reason.slice(0, 200)}`)
  }
}

/**
 * Quo (OpenPhone) — business SMS that works on iPhone via the Quo app.
 * `QUO_FROM_NUMBER` is the Quo inbox that sends (E.164), not the recipient's cell.
 * Every outbound text is capped and counted here.
 */
export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const prepared = prepareSms(input)
  const now = input.now ?? new Date()
  const from = env('QUO_FROM_NUMBER')
  const apiKey = env('QUO_API_KEY')

  if (isDemoMode()) return { id: `sms-demo-${Date.now()}` }
  if (!apiKey || !from) throw new Error('Quo SMS is not configured')
  if (await quoSmsPaused(now)) throw new QuoSmsError(402, 'backoff')

  const reserved = await commitUsage({
    phone: input.to,
    segments: prepared.segments,
    priority: input.priority ?? 'normal',
    now,
  })
  if (!reserved.allowed) {
    console.log(`[sms] skipped budget ${reserved.reason ?? 'daily'} to=${input.to} segments=${prepared.segments} priority=${input.priority ?? 'normal'}`)
    if (reserved.sendNotice) await sendLimitNotice()
    return { skipped: 'budget' }
  }
  try {
    return await postQuo(input.to, prepared.content)
  } catch (err) {
    await rollbackUsage(input.to, prepared.segments, now)
    throw err
  }
}

export type QuoHistoryMessage = {
  id: string
  at: string
  direction: 'in' | 'out'
  text: string
}

let inboxIdMemory: string | null = null

async function quoInboxId(): Promise<string> {
  const explicit = env('QUO_PHONE_NUMBER_ID').trim()
  if (explicit) return explicit
  if (inboxIdMemory) return inboxIdMemory
  const from = env('QUO_FROM_NUMBER').trim()
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/phone-numbers`, { headers: { Authorization: env('QUO_API_KEY') } })
  if (!res.ok) throw new Error(`Quo phone numbers failed: ${res.status}`)
  const data = (await res.json()) as { data?: { id?: string; number?: string; phoneNumber?: string }[] }
  const match = (data.data ?? []).find((item) => item.number === from || item.phoneNumber === from) ?? data.data?.[0]
  if (!match?.id) throw new Error('Quo inbox id was not found')
  inboxIdMemory = match.id
  return match.id
}

/** Recent texts with one contact on a specific Quo number id. Demo mode returns nothing from Quo. */
export async function listQuoMessagesOnNumber(phoneNumberId: string, participant: string): Promise<QuoHistoryMessage[]> {
  if (isDemoMode() || !quoSmsConfigured()) return []
  const id = phoneNumberId.trim()
  if (!id) return []
  const base = env('QUO_API_BASE', 'https://api.openphone.com/v1').replace(/\/$/, '')
  const params = new URLSearchParams({ phoneNumberId: id, maxResults: '30' })
  params.append('participants', participant)
  const res = await fetch(`${base}/messages?${params}`, { headers: { Authorization: env('QUO_API_KEY') } })
  if (!res.ok) throw new Error(`Quo messages failed: ${res.status}`)
  const data = (await res.json()) as {
    data?: { id?: string; from?: string; to?: string[]; text?: string; body?: string; content?: string; direction?: string; createdAt?: string }[]
  }
  return (data.data ?? []).map((item) => {
    const direction = String(item.direction ?? '').toLowerCase()
    const inbound = direction === 'incoming' || direction === 'inbound' || item.from === participant
    return {
      id: item.id || `${item.createdAt ?? ''}-${item.text ?? ''}`,
      at: item.createdAt || new Date().toISOString(),
      direction: inbound ? 'in' as const : 'out' as const,
      text: item.text || item.body || item.content || '',
    }
  })
}

/** Recent texts with one contact on the Sales line. Demo mode returns nothing from Quo. */
export async function listQuoMessages(participant: string): Promise<QuoHistoryMessage[]> {
  if (isDemoMode() || !quoSmsConfigured()) return []
  return listQuoMessagesOnNumber(await quoInboxId(), participant)
}

/** Reminders use this so a missing Quo key skips the text instead of throwing. Demo mode never calls Quo. */
export async function sendSmsIfConfigured(input: SmsSendInput): Promise<SmsSendResult> {
  if (!quoSmsConfigured()) return { skipped: 'not_configured' }
  if (isDemoMode()) return { id: `sms-demo-${Date.now()}` }
  return sendSms(input)
}
