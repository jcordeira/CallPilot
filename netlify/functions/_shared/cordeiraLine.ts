import { env, isDemoMode } from './env'
import { addNote, findPersonByPhone, fubGetStrict, type FubPerson } from './followupboss'
import { escapeHtml, normalizePhone, personLink } from './loaReminders'
import { sendSmsIfConfigured } from './quo'
import { loanOfficer, loanOfficerAssistant } from './team'
import {
  claimHeld,
  confirmClaim,
  getCordeiraState,
  hydrateCordeiraState,
  persistCordeiraState,
  releaseClaim,
  reserveClaim,
  type PendingText,
  type QueuedCall,
} from './cordeiraLineStore'

const DEFAULT_LINE = '+15163094960'
const DEFAULT_WAIT_MINUTES = 10
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const FOUR_H_MS = 4 * 60 * 60 * 1000
const SMS_CAP = 700

const MISSED_OUTCOMES = new Set([
  'no answer',
  'no-answer',
  'no_answer',
  'left message',
  'left-message',
  'busy',
  'missed',
  'voicemail',
  'voice mail',
])

const ANSWERED_OUTCOMES = new Set(['interested', 'not interested', 'not-interested'])

const LINE_ID_FIELDS = ['phoneId', 'phoneNumberId', 'fromPhoneId', 'lineId', 'sharedInboxId'] as const

export type CordeiraEvent = {
  kind: 'text-in' | 'text-out' | 'missed-call' | 'answered-call'
  id: string
  contact: string
  at: string
  personId?: number
  personName?: string
}

export type CordeiraPerson = { id: number; name: string }

export type CordeiraDeps = {
  now?: Date
  sendSms?: (input: { to: string; content: string }) => Promise<{ id: string } | { skipped: 'not_configured' }>
  findPerson?: (phone: string) => Promise<CordeiraPerson | null>
  addNote?: (input: {
    personId: number
    subject: string
    body: string
    isHtml?: boolean
    mentionUserIds?: number[]
  }) => Promise<unknown>
  /** Reply seen in FUB after the inbound text. `unknown` retries on the next minute. */
  laterActivity?: (item: { contact: string; personId?: number; since: string }) => Promise<'reply' | 'clear' | 'unknown'>
  loadCall?: (id: number) => Promise<unknown>
  loadText?: (id: number) => Promise<unknown>
}

type DueItem = {
  key: string
  leadClaim?: string
  kind: 'call' | 'text'
  id: string
  contact: string
  at: string
  personId?: number
  personName?: string
  lead: string
  previousAlertedAt?: string
}

function leadKey(item: { personId?: number; contact: string }): string {
  if (item.personId && item.personId > 0) return `person:${item.personId}`
  return item.contact
}

type Recipient = { phone: string; userId?: number; name: string }

export function cordeiraAlertsEnabled(): boolean {
  return env('CORDEIRA_LINE_ALERTS_ENABLED', 'false').trim().toLowerCase() === 'true'
}

export function cordeiraLineNumber(): string | undefined {
  return normalizePhone(env('CORDEIRA_LINE_NUMBER', DEFAULT_LINE))
}

function waitMinutes(): number {
  const parsed = Number(env('CORDEIRA_LINE_TEXT_WAIT_MINUTES', String(DEFAULT_WAIT_MINUTES)).trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WAIT_MINUTES
  return parsed
}

function dryRun(): boolean {
  return env('CORDEIRA_LINE_ALERTS_DRY_RUN', 'false').trim().toLowerCase() === 'true'
}

function linePhoneId(): string {
  const raw = env('CORDEIRA_LINE_PHONE_ID').trim()
  if (!raw || raw === '0') return ''
  return raw
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function incomingFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return null
}

function positiveId(value: unknown): number | undefined {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : undefined
}

function onCordeiraLine(record: Record<string, unknown>): boolean {
  const line = cordeiraLineNumber()
  const from = normalizePhone(textOf(record.fromNumber))
  const to = normalizePhone(textOf(record.toNumber))
  if (line && (from === line || to === line)) return true
  const configured = linePhoneId()
  if (!configured) return false
  return LINE_ID_FIELDS.some((field) => textOf(record[field]) === configured)
}

function contactOn(record: Record<string, unknown>, incoming: boolean): string | undefined {
  const line = cordeiraLineNumber()
  const from = normalizePhone(textOf(record.fromNumber))
  const to = normalizePhone(textOf(record.toNumber))
  const phone = normalizePhone(textOf(record.phone))
  const ordered = incoming ? [from, phone, to] : [to, phone, from]
  return ordered.find((number) => number && number !== line)
}

function eventTime(record: Record<string, unknown>, now: Date): string | null {
  const raw = record.created ?? record.sent ?? record.updated
  const at = typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : now.toISOString()
  const atMs = Date.parse(at)
  if (!Number.isFinite(atMs) || now.getTime() - atMs > MAX_AGE_MS || atMs - now.getTime() > 5 * 60 * 1000) return null
  return at
}

function personFields(record: Record<string, unknown>, useName: boolean): { personId?: number; personName?: string } {
  const personId = positiveId(record.personId)
  const personName = useName && typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined
  return { personId, personName }
}

/**
 * FUB text: `toNumber` is the company line on an inbound text, `fromNumber` is that line on a reply
 * sent from it. `name` is the person. `sharedInboxId` 0 means the text is not in a shared inbox.
 * `phone` on a call is the lead, not the dialer line. Calls also carry `fromNumber` / `toNumber`
 * when Follow Up Boss exposes them.
 */
export function parseFubText(record: unknown, now = new Date()): CordeiraEvent | null {
  const raw = asRecord(record)
  if (!raw) return null
  const id = positiveId(raw.id)
  if (!id) return null
  const at = eventTime(raw, now)
  if (!at) return null
  const onLine = onCordeiraLine(raw)
  const line = cordeiraLineNumber()
  const from = normalizePhone(textOf(raw.fromNumber))
  const to = normalizePhone(textOf(raw.toNumber))
  let incoming = incomingFlag(raw.isIncoming)
  if (incoming == null && line) {
    if (to === line && from !== line) incoming = true
    else if (from === line && to !== line) incoming = false
  }
  if (incoming == null) return null
  const contact = contactOn(raw, incoming)
  if (!contact) return null
  // A team reply from any FUB line cancels the timer. Only this line starts one.
  if (!onLine) {
    if (incoming) return null
    return { kind: 'text-out', id: String(id), contact, at, ...personFields(raw, true) }
  }
  return { kind: incoming ? 'text-in' : 'text-out', id: String(id), contact, at, ...personFields(raw, true) }
}

export function parseFubCall(record: unknown, now = new Date()): CordeiraEvent | null {
  const raw = asRecord(record)
  if (!raw) return null
  const id = positiveId(raw.id)
  if (!id) return null
  const at = eventTime(raw, now)
  if (!at) return null
  const onLine = onCordeiraLine(raw)
  const incoming = incomingFlag(raw.isIncoming)
  const outcome = textOf(raw.outcome).trim().toLowerCase()
  const duration = typeof raw.duration === 'number' ? raw.duration : null
  const missed = MISSED_OUTCOMES.has(outcome) || (incoming === true && duration === 0 && !outcome)
  const answered = !MISSED_OUTCOMES.has(outcome) && (ANSWERED_OUTCOMES.has(outcome) || (duration != null && duration > 0))
  const person = personFields(raw, false)
  if (!onLine) {
    if (!answered) return null
    const contact = contactOn(raw, incoming !== false)
    if (!contact) return null
    return { kind: 'answered-call', id: String(id), contact, at, ...person }
  }
  if (incoming == null) return null
  const contact = contactOn(raw, incoming)
  if (!contact) return null
  const base = { id: String(id), contact, at, ...person }
  if (!incoming) return answered ? { kind: 'answered-call', ...base } : null
  if (missed) return { kind: 'missed-call', ...base }
  if (answered) return { kind: 'answered-call', ...base }
  return null
}

function answeredAfter(item: { contact: string; personId?: number; inboundAt: string }): boolean {
  const state = getCordeiraState()
  const inbound = Date.parse(item.inboundAt)
  const stamps = [state.answeredAt[item.contact]]
  if (item.personId) stamps.push(state.answeredAt[`person:${item.personId}`])
  return stamps.some((stamp) => stamp != null && Number.isFinite(Date.parse(stamp)) && Date.parse(stamp) >= inbound)
}

function rememberAnswer(key: string, at: string) {
  const state = getCordeiraState()
  const prev = state.answeredAt[key]
  if (prev && Date.parse(prev) >= Date.parse(at)) return
  state.answeredAt[key] = at
  const keys = Object.keys(state.answeredAt)
  if (keys.length > 200) {
    for (const old of keys.slice(0, keys.length - 200)) delete state.answeredAt[old]
  }
}

function applyEvent(event: CordeiraEvent) {
  const state = getCordeiraState()
  if (event.kind === 'text-out' || event.kind === 'answered-call') {
    rememberAnswer(event.contact, event.at)
    if (event.personId) rememberAnswer(`person:${event.personId}`, event.at)
    for (const [id, text] of Object.entries(state.pendingTexts)) {
      const sameContact = text.contact === event.contact
      const samePerson = event.personId != null && text.personId === event.personId
      if ((sameContact || samePerson) && Date.parse(text.inboundAt) <= Date.parse(event.at)) delete state.pendingTexts[id]
    }
    return
  }
  if (event.kind === 'text-in') {
    const lead = leadKey(event)
    const existing = state.pendingTexts[lead]
    if (claimHeld(`alert/text/${event.id}`)) return
    if (existing && !answeredAfter(existing)) return
    const text: PendingText = {
      id: event.id,
      contact: event.contact,
      inboundAt: event.at,
      personId: event.personId,
      personName: event.personName,
    }
    if (answeredAfter(text)) return
    reserveClaim(`alert/text/${event.id}`, event.at)
    state.pendingTexts[lead] = text
    return
  }
  const lead = leadKey(event)
  const lastCall = state.lastCallAlert[lead]
  if (lastCall && Date.parse(event.at) < Date.parse(lastCall) + FOUR_H_MS) return
  if (claimHeld(`alert/call/${event.id}`)) return
  if (Object.values(state.queuedCalls).some((call) => leadKey(call) === lead)) return
  const call: QueuedCall = {
    id: event.id,
    contact: event.contact,
    at: event.at,
    personId: event.personId,
    personName: event.personName,
  }
  state.queuedCalls[event.id] = call
}

function pullDue(now: Date): DueItem[] {
  const state = getCordeiraState()
  const waitMs = waitMinutes() * 60 * 1000
  const items: DueItem[] = []
  const seenTextLeads = new Set<string>()
  for (const [key, text] of Object.entries(state.pendingTexts)) {
    const inbound = Date.parse(text.inboundAt)
    const lead = leadKey(text)
    if (!Number.isFinite(inbound) || now.getTime() - inbound > MAX_AGE_MS || answeredAfter(text)) {
      delete state.pendingTexts[key]
      continue
    }
    if (seenTextLeads.has(lead)) {
      delete state.pendingTexts[key]
      continue
    }
    const alerted = text.alertedAt ? Date.parse(text.alertedAt) : NaN
    let claimKey: string
    if (text.alertedAt) {
      if (!Number.isFinite(alerted) || now.getTime() - alerted < FOUR_H_MS) continue
      claimKey = `alert/text-lead/${lead}/re/${Math.floor(now.getTime() / FOUR_H_MS)}`
    } else {
      if (inbound + waitMs > now.getTime()) continue
      claimKey = `alert/text-lead/${lead}/${text.inboundAt}`
    }
    if (!reserveClaim(claimKey, now.toISOString())) {
      delete state.pendingTexts[key]
      continue
    }
    seenTextLeads.add(lead)
    delete state.pendingTexts[key]
    items.push({
      key: claimKey,
      kind: 'text',
      id: text.id,
      contact: text.contact,
      at: text.inboundAt,
      personId: text.personId,
      personName: text.personName,
      lead,
      previousAlertedAt: text.alertedAt,
    })
  }
  const seenCallLeads = new Set<string>()
  for (const call of Object.values(state.queuedCalls)) {
    const lead = leadKey(call)
    const idKey = `alert/call/${call.id}`
    const lastCall = state.lastCallAlert[lead]
    if (seenCallLeads.has(lead) || (lastCall && now.getTime() < Date.parse(lastCall) + FOUR_H_MS)) {
      delete state.queuedCalls[call.id]
      continue
    }
    const leadClaim = `alert/call-lead/${lead}/${Math.floor(now.getTime() / FOUR_H_MS)}`
    if (!reserveClaim(idKey, now.toISOString())) {
      delete state.queuedCalls[call.id]
      continue
    }
    if (!reserveClaim(leadClaim, now.toISOString())) {
      releaseClaim(idKey)
      delete state.queuedCalls[call.id]
      continue
    }
    seenCallLeads.add(lead)
    delete state.queuedCalls[call.id]
    items.push({
      key: idKey,
      leadClaim,
      kind: 'call',
      id: call.id,
      contact: call.contact,
      at: call.at,
      personId: call.personId,
      personName: call.personName,
      lead,
    })
  }
  return items
}

function rememberAlert(item: DueItem, at: string) {
  const state = getCordeiraState()
  if (item.kind === 'call') {
    state.lastCallAlert[item.lead] = at
    return
  }
  state.pendingTexts[item.lead] = {
    id: item.id,
    contact: item.contact,
    inboundAt: item.at,
    personId: item.personId,
    personName: item.personName,
    alertedAt: at,
  }
}

function restoreItem(item: DueItem) {
  releaseClaim(item.key)
  if (item.leadClaim) releaseClaim(item.leadClaim)
  const state = getCordeiraState()
  if (item.kind === 'text') {
    state.pendingTexts[item.lead] = {
      id: item.id,
      contact: item.contact,
      inboundAt: item.at,
      personId: item.personId,
      personName: item.personName,
      alertedAt: item.previousAlertedAt,
    }
    return
  }
  state.queuedCalls[item.id] = {
    id: item.id,
    contact: item.contact,
    at: item.at,
    personId: item.personId,
    personName: item.personName,
  }
}

export function alertRecipients(): Recipient[] {
  const lo = loanOfficer()
  const loa = loanOfficerAssistant()
  const loaPhone = loa.userId
    ? normalizePhone(env(`FUB_LOA_PHONE_${loa.userId}`)) ?? normalizePhone(env('FUB_LOA_PHONE'))
    : normalizePhone(env('FUB_LOA_PHONE'))
  const loaName = (loa.userId ? env(`FUB_LOA_NAME_${loa.userId}`).trim() : '') || loa.name
  const people: Recipient[] = []
  const loPhone = normalizePhone(env('FUB_LO_PHONE'))
  if (loPhone) people.push({ phone: loPhone, userId: lo.userId, name: lo.name })
  if (loaPhone && !people.some((person) => person.phone === loaPhone)) {
    people.push({ phone: loaPhone, userId: loa.userId, name: loaName })
  }
  return people
}

function sentence(kind: 'call' | 'text', who: string): string {
  if (kind === 'call') return `Missed call from ${who} on Cordeira line`
  return `Unanswered text from ${who} for ${waitMinutes()} min on Cordeira line`
}

function smsLine(text: string, personId?: number): string {
  if (!personId) return text
  return `${text} ${personLink(personId)}`
}

function clip(text: string): string {
  const ellipsis = '...'
  return text.length > SMS_CAP ? `${text.slice(0, SMS_CAP - ellipsis.length).trimEnd()}${ellipsis}` : text
}

function rowsOf(raw: unknown, keys: string[]): Record<string, unknown>[] {
  const record = asRecord(raw)
  if (!record) return []
  for (const key of keys) {
    const list = record[key]
    if (!Array.isArray(list)) continue
    return list.map(asRecord).filter((item): item is Record<string, unknown> => item != null)
  }
  return []
}

/** Follow Up Boss examples store US numbers as 10 digits, without a leading +1. */
function fubPhoneQuery(e164: string): string {
  const digits = e164.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits || e164
}

async function defaultLaterActivity(item: { contact: string; personId?: number; since: string }): Promise<'reply' | 'clear' | 'unknown'> {
  if (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim()) return 'clear'
  try {
    const since = Date.parse(item.since)
    const number = encodeURIComponent(fubPhoneQuery(item.contact))
    const textQuery = item.personId ? `personId=${item.personId}&limit=20` : `toNumber=${number}&limit=20`
    const callQuery = item.personId ? `personId=${item.personId}&limit=10` : `phone=${number}&limit=10`
    const [texts, calls] = await Promise.all([fubGetStrict(`/textMessages?${textQuery}`), fubGetStrict(`/calls?${callQuery}`)])
    const repliedText = rowsOf(texts, ['textmessages', 'textMessages']).some((row) => {
      const parsed = parseFubText(row)
      return parsed?.kind === 'text-out' && Date.parse(parsed.at) >= since
    })
    const answered = rowsOf(calls, ['calls']).some((row) => {
      const parsed = parseFubCall(row)
      return parsed?.kind === 'answered-call' && Date.parse(parsed.at) >= since
    })
    return repliedText || answered ? 'reply' : 'clear'
  } catch {
    return 'unknown'
  }
}

async function replySeen(item: DueItem, deps: CordeiraDeps): Promise<'reply' | 'clear' | 'unknown'> {
  if (item.kind !== 'text') return 'clear'
  if (answeredAfter({ contact: item.contact, personId: item.personId, inboundAt: item.at })) return 'reply'
  const check = deps.laterActivity ?? defaultLaterActivity
  return check({ contact: item.contact, personId: item.personId, since: item.at })
}

function personFrom(person: FubPerson | null): CordeiraPerson | null {
  if (!person || !Number.isInteger(person.id) || person.id <= 0) return null
  return { id: person.id, name: person.name }
}

async function lookupPerson(contact: string, deps: CordeiraDeps): Promise<CordeiraPerson | null> {
  try {
    if (deps.findPerson) return await deps.findPerson(contact)
    return personFrom(await findPersonByPhone(contact))
  } catch {
    return null
  }
}

async function personFor(item: DueItem, deps: CordeiraDeps): Promise<CordeiraPerson | null> {
  const looked = item.personName?.trim() ? null : await lookupPerson(item.contact, deps)
  if (item.personId) return { id: item.personId, name: item.personName?.trim() || looked?.name || '' }
  return looked
}

function mentionNote(recipients: Recipient[], lines: string[]): { body: string; mentionUserIds: number[] } {
  const mentionUserIds = [...new Set(recipients.map((person) => person.userId).filter((id): id is number => id != null))]
  const chips = recipients
    .filter((person) => person.userId != null)
    .map((person) => `<span data-user-id="${person.userId}">${escapeHtml(person.name)}</span>`)
    .join(' ')
  const items = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
  const lead = chips ? `${chips} ` : ''
  return {
    body: `<p>${lead}LoanPilot — Cordeira line:</p><ul>${items}</ul>`,
    mentionUserIds,
  }
}

export async function runCordeiraLineAlerts(deps: CordeiraDeps & { hydrate?: boolean } = {}): Promise<{
  sent: number
  notes: number
  skipped?: string
}> {
  if (!cordeiraAlertsEnabled()) return { sent: 0, notes: 0, skipped: 'disabled' }
  const now = deps.now ?? new Date()
  if (deps.hydrate !== false) await hydrateCordeiraState()
  const due = pullDue(now)
  if (!due.length) {
    await persistCordeiraState()
    return { sent: 0, notes: 0 }
  }

  if (dryRun()) {
    for (const item of due) restoreItem(item)
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'dry_run' }
  }

  const ready: DueItem[] = []
  for (const item of due) {
    const reply = await replySeen(item, deps)
    if (reply === 'reply') {
      await confirmClaim(item.key, now.toISOString())
      if (item.leadClaim) await confirmClaim(item.leadClaim, now.toISOString())
      continue
    }
    if (reply === 'unknown') {
      if (item.kind === 'text') restoreItem(item)
      continue
    }
    ready.push(item)
  }
  if (!ready.length) {
    await persistCordeiraState()
    return { sent: 0, notes: 0 }
  }

  const recipients = alertRecipients()
  if (!recipients.length) {
    for (const item of ready) restoreItem(item)
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'no_recipients' }
  }

  const claimed: DueItem[] = []
  for (const item of ready) {
    if (!(await confirmClaim(item.key, now.toISOString()))) continue
    if (item.leadClaim && !(await confirmClaim(item.leadClaim, now.toISOString()))) continue
    rememberAlert(item, now.toISOString())
    claimed.push(item)
  }
  if (!claimed.length) {
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'claimed' }
  }

  const people = new Map<string, CordeiraPerson | null>()
  for (const item of claimed) {
    if (people.has(item.contact)) continue
    people.set(item.contact, await personFor(item, deps))
  }
  const rendered = claimed.map((item) => {
    const person = people.get(item.contact)
    const who = person?.name.trim() || item.personName?.trim() || item.contact
    return smsLine(sentence(item.kind, who), person?.id ?? item.personId)
  })
  const lines: string[] = []
  for (const line of rendered) {
    if (!lines.includes(line)) lines.push(line)
  }
  const body = clip(lines.join('\n'))
  const send = deps.sendSms ?? sendSmsIfConfigured
  let sent = 0
  for (const recipient of recipients) {
    try {
      const result = await send({ to: recipient.phone, content: body })
      if (!('skipped' in result)) sent += 1
    } catch {
      /* item is already claimed; do not retry */
    }
  }

  const byPerson = new Map<number, string[]>()
  for (let index = 0; index < claimed.length; index += 1) {
    const item = claimed[index]
    const person = people.get(item.contact)
    const personId = person?.id ?? item.personId
    if (!personId || personId <= 0) continue
    const line = rendered[index] ?? sentence(item.kind, person?.name || item.contact)
    const list = byPerson.get(personId) ?? []
    if (!list.includes(line)) list.push(line)
    byPerson.set(personId, list)
  }
  const postNote = deps.addNote ?? addNote
  let notes = 0
  for (const [personId, personLines] of byPerson) {
    const note = mentionNote(alertRecipients(), personLines)
    try {
      await postNote({
        personId,
        subject: 'LoanPilot — Cordeira line',
        body: note.body,
        isHtml: true,
        mentionUserIds: note.mentionUserIds,
      })
      notes += 1
    } catch {
      /* the SMS already went out; do not retry the note forever */
    }
  }
  await persistCordeiraState()
  return { sent, notes }
}

export async function ingestCordeiraEvent(event: CordeiraEvent, deps: CordeiraDeps = {}) {
  if (!cordeiraAlertsEnabled()) return { sent: 0, notes: 0, skipped: 'disabled' as const }
  await hydrateCordeiraState()
  applyEvent(event)
  if (event.kind === 'missed-call') return runCordeiraLineAlerts({ ...deps, hydrate: false, now: deps.now })
  await persistCordeiraState()
  return { sent: 0, notes: 0 }
}

export async function ingestFubText(record: unknown, deps: CordeiraDeps = {}) {
  const event = parseFubText(record, deps.now ?? new Date())
  if (!event) return { sent: 0, notes: 0, ignored: true as const }
  return ingestCordeiraEvent(event, deps)
}

export async function ingestFubCall(record: unknown, deps: CordeiraDeps = {}) {
  const event = parseFubCall(record, deps.now ?? new Date())
  if (!event) return { sent: 0, notes: 0, ignored: true as const }
  return ingestCordeiraEvent(event, deps)
}

function resourceIds(payload: Record<string, unknown>): number[] {
  if (!Array.isArray(payload.resourceIds)) return []
  return payload.resourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
}

async function defaultLoadCall(id: number): Promise<unknown> {
  return fubGetStrict(`/calls/${id}`)
}

async function defaultLoadText(id: number): Promise<unknown> {
  return fubGetStrict(`/textMessages/${id}`)
}

function unwrap(raw: unknown, keys: string[]): unknown {
  const record = asRecord(raw)
  if (!record) return raw
  for (const key of keys) {
    if (record[key] && typeof record[key] === 'object') return record[key]
  }
  return raw
}

/** Follow Up Boss `calls*` and `textMessages*` webhooks. Resource ids are loaded from the API. */
export async function handleFubCordeiraWebhook(payload: unknown, deps: CordeiraDeps = {}) {
  if (!cordeiraAlertsEnabled()) return { sent: 0, notes: 0, skipped: 'disabled' as const }
  const body = asRecord(payload)
  if (!body) return { sent: 0, notes: 0, ignored: true as const }
  const eventName = textOf(body.event)
  const ids = resourceIds(body)
  const now = deps.now ?? new Date()
  let sent = 0
  let notes = 0
  if (/^calls/i.test(eventName)) {
    const load = deps.loadCall ?? defaultLoadCall
    for (const id of ids) {
      const record = unwrap(await load(id), ['call'])
      const result = await ingestFubCall(record, { ...deps, now })
      sent += result.sent
      notes += result.notes
    }
  } else if (/^textMessages/i.test(eventName)) {
    const load = deps.loadText ?? defaultLoadText
    for (const id of ids) {
      const record = unwrap(await load(id), ['textMessage', 'textmessage'])
      const result = await ingestFubText(record, { ...deps, now })
      sent += result.sent
      notes += result.notes
    }
  }
  return { sent, notes }
}
