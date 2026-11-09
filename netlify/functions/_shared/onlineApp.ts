import { env, isDemoMode } from './env'
import { addPersonTag, fubGet, ONLINE_APP_TAG, registerPerson } from './followupboss'
import { gmailCanRead, loadGoogleTokens, resolveGoogleAccessToken } from './googleAuth'
import {
  claimOnlineApp,
  loadOnlineAppState,
  releaseOnlineApp,
  saveOnlineAppState,
} from './onlineAppStore'

export const ONLINE_APP_QUERY = 'from:noreply@cliffcomortgage.com subject:"New application submitted successfully for"'
const TWO_DAYS_MS = 2 * 86_400_000
const IGNORED_EMAILS = new Set([
  'noreply@cliffcomortgage.com',
  'jcordeira@cliffcomortgage.com',
  'joseph@teamcordeira.com',
])
const IGNORED_PHONES = new Set(['5169969070', '5164087300'])

export type ParsedApplication = {
  name: string
  firstName: string
  lastName?: string
  email?: string
  phone?: string
}

export type ParseResult = { ok: true; application: ParsedApplication } | { ok: false; reason: string; skeleton: string }

export function onlineAppTagEnabled(): boolean {
  const raw = env('ONLINE_APP_TAG_ENABLED', 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

export function applicationNameFromSubject(subject: string): string | null {
  const match = subject.match(/new application submitted successfully for:\s*(.+)$/i)
  const name = match?.[1]?.replace(/\s+/g, ' ').trim()
  return name || null
}

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function digits(value: string): string {
  const raw = value.replace(/\D/g, '')
  if (raw.length === 11 && raw.startsWith('1')) return raw.slice(1)
  return raw
}

function splitName(name: string): { firstName: string; lastName?: string } {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length < 2) return { firstName: name }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

function skeleton(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/g, '<phone>')
    .replace(/\s+/g, ' ')
    .slice(0, 280)
}

/** Pull the applicant from the subject and body. Fails closed when the body does not yield one email and one phone. */
export function parseOnlineApplication(subject: string, body: string): ParseResult {
  const name = applicationNameFromSubject(subject)
  if (!name) return { ok: false, reason: 'subject has no applicant name', skeleton: skeleton(subject) }
  const text = decodeHtml(body)
  if (!/dear joseph cordeira\b/i.test(text.slice(0, 800))) {
    return { ok: false, reason: 'body does not address Dear Joseph Cordeira', skeleton: skeleton(text) }
  }
  const labeledEmail = text.match(/(?:e-?mail(?: address)?)\s*[:\-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]
  const labeledPhone = text.match(/(?:mobile|cell|phone|telephone)\s*(?:number)?\s*[:\-]\s*(\+?\d[\d\s().-]{7,}\d)/i)?.[1]
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0].toLowerCase())
    .filter((email) => !IGNORED_EMAILS.has(email))
  const phones = [...text.matchAll(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}|\+1\d{10}/g)]
    .map((match) => digits(match[0]))
    .filter((phone) => phone.length === 10 && !IGNORED_PHONES.has(phone))
  const email = (labeledEmail?.toLowerCase() && !IGNORED_EMAILS.has(labeledEmail.toLowerCase()) ? labeledEmail.toLowerCase() : undefined)
    ?? (emails.length === 1 ? emails[0] : undefined)
  const labeledPhoneDigits = labeledPhone ? digits(labeledPhone) : ''
  const phone = (labeledPhoneDigits.length === 10 && !IGNORED_PHONES.has(labeledPhoneDigits) ? labeledPhoneDigits : undefined)
    ?? (phones.length === 1 ? phones[0] : undefined)
  if (!labeledEmail && emails.length > 1) {
    return { ok: false, reason: `ambiguous emails (${emails.length})`, skeleton: skeleton(text) }
  }
  if (!labeledPhone && phones.length > 1) {
    return { ok: false, reason: `ambiguous phones (${phones.length})`, skeleton: skeleton(text) }
  }
  if (!email && !phone) {
    return { ok: false, reason: `no single applicant email or phone (emails=${emails.length} phones=${phones.length})`, skeleton: skeleton(text) }
  }
  return { ok: true, application: { name, ...splitName(name), email, phone: phone ? `+1${phone}` : undefined } }
}

type Person = { id: number; name?: string; emails?: { value: string }[]; phones?: { value: string }[]; tags?: string[] }

export type ApplicantMatch = {
  person: Person | null
  ambiguous: boolean
  note: string
}

function exactName(person: Person, name: string): boolean {
  return (person.name ?? '').trim().toLowerCase() === name.trim().toLowerCase()
}

export async function matchApplicant(application: ParsedApplication, search: (query: string) => Promise<Person[]> = defaultSearch): Promise<ApplicantMatch> {
  if (application.email) {
    const people = await search(`email=${encodeURIComponent(application.email)}`)
    if (people.length === 1) return { person: people[0], ambiguous: false, note: 'email' }
    if (people.length > 1) return { person: people[0], ambiguous: true, note: `several email matches (${people.length}); tagged the first` }
  }
  if (application.phone) {
    const people = await search(`phone=${encodeURIComponent(application.phone)}`)
    if (people.length === 1) return { person: people[0], ambiguous: false, note: 'phone' }
    if (people.length > 1) return { person: people[0], ambiguous: true, note: `several phone matches (${people.length}); tagged the first` }
  }
  const named = (await search(`name=${encodeURIComponent(application.name)}`)).filter((person) => exactName(person, application.name))
  if (named.length === 1) return { person: named[0], ambiguous: false, note: 'exact name' }
  if (named.length > 1) return { person: null, ambiguous: true, note: `several exact name matches (${named.length}); not tagged` }
  return { person: null, ambiguous: false, note: 'no match' }
}

async function defaultSearch(query: string): Promise<Person[]> {
  const data = (await fubGet(`/people?${query}&limit=10&fields=id,name,emails,phones,tags`)) as { people?: Person[] } | null
  return data?.people ?? []
}

type GmailHeader = { name: string; value: string }
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: GmailHeader[] }
export type GmailMessage = {
  id: string
  internalDate?: string
  payload?: GmailPart
}

function decodeBody(data?: string): string {
  if (!data) return ''
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function partText(part: GmailPart | undefined, prefer: 'plain' | 'html'): string {
  if (!part) return ''
  if (part.mimeType === `text/${prefer}` && part.body?.data) return decodeBody(part.body.data)
  for (const child of part.parts ?? []) {
    const text = partText(child, prefer)
    if (text) return text
  }
  return ''
}

export function messageBody(message: GmailMessage): string {
  return partText(message.payload, 'plain') || partText(message.payload, 'html') || decodeBody(message.payload?.body?.data)
}

export function messageHeader(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export type OnlineAppSummary = {
  ok: true
  enabled: boolean
  backfill: boolean
  skipped?: 'disabled' | 'demo' | 'scope'
  seededOld: number
  considered: number
  tagged: number
  created: number
  parseFailed: number
  already: number
  ambiguous: number
  failures: string[]
  zheng?: { action: string; personId?: number | null; note?: string }
}

export async function runOnlineApplications(options?: {
  now?: Date
  backfill?: boolean
  list?: (query: string) => Promise<{ id: string; internalDate: number }[]>
  read?: (id: string) => Promise<GmailMessage>
  search?: (query: string) => Promise<Person[]>
  tag?: (personId: number) => Promise<void>
  create?: (application: ParsedApplication) => Promise<number | null>
}): Promise<OnlineAppSummary> {
  const now = options?.now ?? new Date()
  const backfill = options?.backfill === true
  const summary: OnlineAppSummary = {
    ok: true,
    enabled: onlineAppTagEnabled(),
    backfill,
    seededOld: 0,
    considered: 0,
    tagged: 0,
    created: 0,
    parseFailed: 0,
    already: 0,
    ambiguous: 0,
    failures: [],
  }
  if (!summary.enabled) {
    summary.skipped = 'disabled'
    return summary
  }
  if (!options?.list && isDemoMode()) {
    summary.skipped = 'demo'
    return summary
  }
  const list = options?.list ?? listGmail
  const read = options?.read ?? readGmail
  const search = options?.search ?? defaultSearch
  const tag = options?.tag ?? ((personId: number) => addPersonTag(personId, ONLINE_APP_TAG))
  const create = options?.create ?? ((application: ParsedApplication) => registerPerson({ ...splitName(application.name), email: application.email, phone: application.phone, tag: ONLINE_APP_TAG }))

  const state = await loadOnlineAppState()
  try {
    if (!state.seeded && !backfill) {
      const older = await list(ONLINE_APP_QUERY)
      for (const message of older) {
        if (now.getTime() - message.internalDate < TWO_DAYS_MS) continue
        if (await claimOnlineApp(`before/${message.id}`)) summary.seededOld += 1
      }
      await saveOnlineAppState({ ...state, seeded: true, enabledAt: now.toISOString() })
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'gmail list failed'
    if (/scope missing|not connected/i.test(reason)) summary.skipped = 'scope'
    summary.failures.push(reason)
    console.log(`[online-app] ${reason}`)
    return summary
  }

  let recent: { id: string; internalDate: number }[]
  try {
    recent = backfill ? await list(ONLINE_APP_QUERY) : await list(`${ONLINE_APP_QUERY} newer_than:2d`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'gmail list failed'
    if (/scope missing|not connected/i.test(reason)) summary.skipped = 'scope'
    summary.failures.push(reason)
    console.log(`[online-app] ${reason}`)
    return summary
  }
  for (const item of recent) {
    if (!backfill && now.getTime() - item.internalDate >= TWO_DAYS_MS) continue
    const doneKey = `done/${item.id}`
    if (!(await claimOnlineApp(doneKey))) {
      summary.already += 1
      continue
    }
    summary.considered += 1
    let message: GmailMessage
    try {
      message = await read(item.id)
    } catch (err) {
      await releaseOnlineApp(doneKey)
      const reason = err instanceof Error ? err.message : 'gmail read failed'
      summary.failures.push(reason)
      console.log(`[online-app] read failed ${item.id}`)
      continue
    }
    const parsed = parseOnlineApplication(messageHeader(message, 'subject'), messageBody(message))
    const subjectName = applicationNameFromSubject(messageHeader(message, 'subject'))
    if (!parsed.ok) {
      summary.parseFailed += 1
      summary.failures.push(parsed.reason)
      console.log(`[online-app] parse failed ${item.id} ${parsed.reason} ${parsed.skeleton}`)
      if (/zheng zhuang/i.test(subjectName ?? '')) summary.zheng = { action: 'parse-failed', note: parsed.reason }
      continue
    }
    try {
      const match = await matchApplicant(parsed.application, search)
      if (match.ambiguous) {
        summary.ambiguous += 1
        console.log(`[online-app] ambiguous ${item.id} ${match.note}`)
      }
      let action = 'none'
      let personId = match.person?.id ?? null
      if (match.person) {
        await tag(match.person.id)
        summary.tagged += 1
        action = 'tagged'
      } else if (!match.ambiguous && parsed.application.email && parsed.application.phone) {
        personId = await create(parsed.application)
        summary.created += 1
        action = 'created'
      } else {
        summary.failures.push(match.note)
        action = 'unmatched'
        console.log(`[online-app] unmatched ${item.id} ${match.note}`)
      }
      if (/zheng zhuang/i.test(parsed.application.name)) summary.zheng = { action, personId, note: match.note }
    } catch (err) {
      await releaseOnlineApp(doneKey)
      const reason = err instanceof Error ? err.message : 'fub write failed'
      summary.failures.push(reason)
      console.log(`[online-app] write failed ${item.id}`)
    }
  }

  const prior = await loadOnlineAppState()
  await saveOnlineAppState({ ...prior, last: summary })
  console.log(`[online-app] ${JSON.stringify({ ...summary, failures: summary.failures.slice(0, 5) })}`)
  return summary
}

async function gmailFetch(path: string): Promise<unknown> {
  const { accessToken } = await resolveGoogleAccessToken()
  if (!accessToken) throw new Error('Google is not connected')
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 403) {
    const stored = await loadGoogleTokens()
    if (stored?.scope && !gmailCanRead(stored.scope)) throw new Error('Gmail read scope missing')
  }
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`)
  return res.json()
}

async function listGmail(query: string): Promise<{ id: string; internalDate: number }[]> {
  const found: { id: string; internalDate: number }[] = []
  let pageToken = ''
  for (let page = 0; page < 10 && found.length < 500; page += 1) {
    const params = new URLSearchParams({ q: query, maxResults: '50' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = (await gmailFetch(`messages?${params}`)) as { messages?: { id: string }[]; nextPageToken?: string }
    for (const message of data.messages ?? []) {
      const meta = (await gmailFetch(`messages/${message.id}?format=minimal`)) as { id: string; internalDate?: string }
      found.push({ id: meta.id, internalDate: Number(meta.internalDate ?? 0) })
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return found
}

async function readGmail(id: string): Promise<GmailMessage> {
  return (await gmailFetch(`messages/${id}?format=full`)) as GmailMessage
}
