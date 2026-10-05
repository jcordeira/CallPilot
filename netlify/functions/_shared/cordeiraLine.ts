import { env, isDemoMode } from './env'
import { addNote, findPersonByPhone, type FubPerson } from './followupboss'
import { escapeHtml, normalizePhone, personLink } from './loaReminders'
import { listQuoMessagesOnNumber, sendSmsIfConfigured } from './quo'
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
const SMS_CAP = 700

const MISSED_STATUSES = new Set([
  'unanswered',
  'abandoned',
  'failed',
  'missed',
  'no-answer',
  'no_answer',
  'busy',
  'canceled',
  'cancelled',
])

const OUTBOUND_MESSAGE_TYPES = new Set(['message.delivered', 'message.sent', 'message.undelivered'])

export type CordeiraEvent =
  | { kind: 'text-in'; id: string; contact: string; at: string; conversationId?: string }
  | { kind: 'text-out'; id: string; contact: string; at: string; conversationId?: string }
  | { kind: 'missed-call'; id: string; contact: string; at: string; conversationId?: string }

export type CordeiraPerson = { id: number; name: string }

export type CordeiraHistoryMessage = { id: string; at: string; direction: 'in' | 'out' }

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
  listMessages?: (contact: string) => Promise<CordeiraHistoryMessage[] | null>
}

type DueItem = {
  key: string
  kind: 'call' | 'text'
  id: string
  contact: string
  at: string
  conversationId?: string
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
  return env('CORDEIRA_LINE_PHONE_NUMBER_ID').trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function phoneList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => phoneList(item))
  if (typeof value !== 'string') return []
  const phone = normalizePhone(value)
  return phone ? [phone] : []
}

function eventTime(resource: Record<string, unknown>, root: Record<string, unknown>, now: Date): string {
  const raw = resource.createdAt ?? resource.completedAt ?? root.createdAt
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString()
  return now.toISOString()
}

function directionOf(type: string, resource: Record<string, unknown>): 'in' | 'out' | 'unknown' {
  const raw = String(resource.direction ?? '').toLowerCase()
  if (raw === 'incoming' || raw === 'inbound') return 'in'
  if (raw === 'outgoing' || raw === 'outbound') return 'out'
  if (type === 'call.missed') return 'in'
  if (OUTBOUND_MESSAGE_TYPES.has(type)) return 'out'
  if (type === 'message.received' || type === 'message') return 'in'
  return 'unknown'
}

function isMissedCall(type: string, resource: Record<string, unknown>, direction: 'in' | 'out' | 'unknown'): boolean {
  if (direction === 'out') return false
  if (type === 'call.missed') return true
  if (type !== 'call.completed') return false
  if (direction === 'unknown') return false
  const status = String(resource.status ?? '').toLowerCase()
  if (status === 'answered' || status === 'forwarded' || status === 'ai-handled') return false
  if (status === 'completed') {
    const duration = resource.duration
    const answeredAt = resource.answeredAt
    return (duration === 0 || duration === '0') && (answeredAt == null || answeredAt === '')
  }
  if (MISSED_STATUSES.has(status)) return true
  return false
}

function otherParty(groups: string[][], line: string): string | undefined {
  for (const group of groups) {
    const found = group.find((phone) => phone !== line)
    if (found) return found
  }
  return undefined
}

/** Quo call/message on CORDEIRA_LINE_NUMBER, or null when the event is some other line. */
export function parseCordeiraEvent(payload: unknown, now = new Date()): CordeiraEvent | null {
  const line = cordeiraLineNumber()
  if (!line) return null
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const data = asRecord(root.data) ?? root
  const resource = asRecord(data.resource) ?? asRecord(data.object) ?? data
  const context = asRecord(data.context) ?? {}
  const type = String(root.type ?? data.type ?? resource.type ?? '')
  if (!type) return null

  const participants = asRecord(context.participants)
  const external = phoneList(participants?.external)
  const workspace = phoneList(participants?.workspace)
  const sender = phoneList(context.senderIdentifier)
  const recipients = phoneList(context.recipientIdentifiers)
  const from = phoneList(resource.from)
  const to = phoneList(resource.to)
  const parties = [...external, ...workspace, ...sender, ...recipients, ...from, ...to]
  const phoneId = String(context.phoneNumberId ?? resource.phoneNumberId ?? '')
  const idMatch = Boolean(linePhoneId() && phoneId && phoneId === linePhoneId())
  if (!parties.includes(line) && !idMatch) return null

  const direction = directionOf(type, resource)
  const contact = otherParty(
    direction === 'out' ? [external, recipients, to, sender, from, workspace] : [external, sender, from, recipients, to, workspace],
    line,
  )
  if (!contact) return null
  const id = String(resource.id ?? root.id ?? '')
  if (!id) return null
  const at = eventTime(resource, root, now)
  const atMs = Date.parse(at)
  if (!Number.isFinite(atMs) || now.getTime() - atMs > MAX_AGE_MS || atMs - now.getTime() > 5 * 60 * 1000) return null
  const conversationRaw = context.conversationId ?? resource.conversationId
  const conversationId = typeof conversationRaw === 'string' && conversationRaw ? conversationRaw : undefined

  if (type === 'call.missed' || type === 'call.completed') {
    if (!isMissedCall(type, resource, direction)) return null
    return { kind: 'missed-call', id, contact, at, conversationId }
  }

  const messageType = type === 'message' || type === 'message.received' || OUTBOUND_MESSAGE_TYPES.has(type)
  if (!messageType) return null
  if (direction === 'out') return { kind: 'text-out', id, contact, at, conversationId }
  if (direction === 'in') return { kind: 'text-in', id, contact, at, conversationId }
  return null
}

/** True when this payload is a call or text on the Cordeira line, even if it is too old to alert. */
export function payloadTouchesCordeiraLine(payload: unknown, now = new Date()): boolean {
  if (parseCordeiraEvent(payload, now)) return true
  const line = cordeiraLineNumber()
  if (!line || !payload || typeof payload !== 'object') return false
  const root = payload as Record<string, unknown>
  const data = asRecord(root.data) ?? root
  const resource = asRecord(data.resource) ?? asRecord(data.object) ?? data
  const context = asRecord(data.context) ?? {}
  const type = String(root.type ?? data.type ?? '')
  if (!type.startsWith('message') && !type.startsWith('call')) return false
  const participants = asRecord(context.participants)
  const parties = [
    ...phoneList(participants?.external),
    ...phoneList(participants?.workspace),
    ...phoneList(context.senderIdentifier),
    ...phoneList(context.recipientIdentifiers),
    ...phoneList(resource.from),
    ...phoneList(resource.to),
  ]
  if (parties.includes(line)) return true
  const phoneId = String(context.phoneNumberId ?? resource.phoneNumberId ?? '')
  return Boolean(linePhoneId() && phoneId && phoneId === linePhoneId())
}

function answeredAfter(item: { contact: string; conversationId?: string; inboundAt: string }): boolean {
  const state = getCordeiraState()
  const inbound = Date.parse(item.inboundAt)
  const stamps = [state.answeredAt[item.contact]]
  if (item.conversationId) stamps.push(state.answeredAt[`conv:${item.conversationId}`])
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
  if (event.kind === 'text-out') {
    rememberAnswer(event.contact, event.at)
    if (event.conversationId) rememberAnswer(`conv:${event.conversationId}`, event.at)
    for (const [id, text] of Object.entries(state.pendingTexts)) {
      const sameContact = text.contact === event.contact
      const sameConversation = Boolean(event.conversationId && text.conversationId === event.conversationId)
      if ((sameContact || sameConversation) && Date.parse(text.inboundAt) <= Date.parse(event.at)) {
        delete state.pendingTexts[id]
      }
    }
    return
  }
  if (event.kind === 'text-in') {
    const key = `alert/text/${event.id}`
    if (claimHeld(key) || state.pendingTexts[event.id]) return
    const text: PendingText = {
      id: event.id,
      contact: event.contact,
      conversationId: event.conversationId,
      inboundAt: event.at,
    }
    if (answeredAfter(text)) return
    state.pendingTexts[event.id] = text
    return
  }
  const key = `alert/call/${event.id}`
  if (claimHeld(key)) return
  const call: QueuedCall = {
    id: event.id,
    contact: event.contact,
    at: event.at,
    conversationId: event.conversationId,
  }
  state.queuedCalls[event.id] = call
}

function pullDue(now: Date): DueItem[] {
  const state = getCordeiraState()
  const waitMs = waitMinutes() * 60 * 1000
  const items: DueItem[] = []
  for (const text of Object.values(state.pendingTexts)) {
    const inbound = Date.parse(text.inboundAt)
    if (!Number.isFinite(inbound) || now.getTime() - inbound > MAX_AGE_MS || answeredAfter(text)) {
      delete state.pendingTexts[text.id]
      continue
    }
    if (inbound + waitMs > now.getTime()) continue
    const key = `alert/text/${text.id}`
    if (!reserveClaim(key, now.toISOString())) {
      delete state.pendingTexts[text.id]
      continue
    }
    delete state.pendingTexts[text.id]
    items.push({ key, kind: 'text', id: text.id, contact: text.contact, at: text.inboundAt, conversationId: text.conversationId })
  }
  for (const call of Object.values(state.queuedCalls)) {
    const key = `alert/call/${call.id}`
    if (!reserveClaim(key, now.toISOString())) {
      delete state.queuedCalls[call.id]
      continue
    }
    delete state.queuedCalls[call.id]
    items.push({ key, kind: 'call', id: call.id, contact: call.contact, at: call.at, conversationId: call.conversationId })
  }
  return items
}

function restoreText(item: DueItem) {
  releaseClaim(item.key)
  getCordeiraState().pendingTexts[item.id] = {
    id: item.id,
    contact: item.contact,
    conversationId: item.conversationId,
    inboundAt: item.at,
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
  return text.length > SMS_CAP ? `${text.slice(0, SMS_CAP - 1).trimEnd()}…` : text
}

async function defaultListMessages(contact: string): Promise<CordeiraHistoryMessage[] | null> {
  const id = linePhoneId()
  if (!id || isDemoMode() || !env('QUO_API_KEY').trim() || !env('QUO_FROM_NUMBER').trim()) return null
  const rows = await listQuoMessagesOnNumber(id, contact)
  return rows.map((row) => ({ id: row.id, at: row.at, direction: row.direction }))
}

async function replySeen(item: DueItem, deps: CordeiraDeps): Promise<'yes' | 'no' | 'unknown'> {
  if (item.kind !== 'text') return 'no'
  if (answeredAfter({ contact: item.contact, conversationId: item.conversationId, inboundAt: item.at })) return 'yes'
  const list = deps.listMessages ?? defaultListMessages
  try {
    const rows = await list(item.contact)
    if (!rows) return 'no'
    const inbound = Date.parse(item.at)
    const replied = rows.some((row) => row.direction === 'out' && Number.isFinite(Date.parse(row.at)) && Date.parse(row.at) >= inbound)
    return replied ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}

function personFrom(person: FubPerson | null): CordeiraPerson | null {
  if (!person || !Number.isInteger(person.id)) return null
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
    for (const item of due) {
      releaseClaim(item.key)
      if (item.kind === 'text') restoreText(item)
      else getCordeiraState().queuedCalls[item.id] = { id: item.id, contact: item.contact, at: item.at, conversationId: item.conversationId }
    }
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'dry_run' }
  }

  const ready: DueItem[] = []
  for (const item of due) {
    const reply = await replySeen(item, deps)
    if (reply === 'yes') {
      await confirmClaim(item.key, now.toISOString())
      continue
    }
    if (reply === 'unknown') {
      if (item.kind === 'text') restoreText(item)
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
    for (const item of ready) {
      releaseClaim(item.key)
      if (item.kind === 'text') {
        getCordeiraState().pendingTexts[item.id] = {
          id: item.id,
          contact: item.contact,
          conversationId: item.conversationId,
          inboundAt: item.at,
        }
      } else {
        getCordeiraState().queuedCalls[item.id] = { id: item.id, contact: item.contact, at: item.at, conversationId: item.conversationId }
      }
    }
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'no_recipients' }
  }

  const claimed: DueItem[] = []
  for (const item of ready) {
    if (await confirmClaim(item.key, now.toISOString())) claimed.push(item)
  }
  if (!claimed.length) {
    await persistCordeiraState()
    return { sent: 0, notes: 0, skipped: 'claimed' }
  }

  const people = new Map<string, CordeiraPerson | null>()
  for (const item of claimed) {
    if (people.has(item.contact)) continue
    people.set(item.contact, await lookupPerson(item.contact, deps))
  }
  const lines = claimed.map((item) => {
    const person = people.get(item.contact)
    const who = person?.name.trim() || item.contact
    return smsLine(sentence(item.kind, who), person?.id)
  })
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
    if (!person) continue
    const list = byPerson.get(person.id) ?? []
    list.push(lines[index] ?? sentence(item.kind, person.name))
    byPerson.set(person.id, list)
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
  if (event.kind === 'missed-call') {
    return runCordeiraLineAlerts({ ...deps, hydrate: false, now: deps.now })
  }
  await persistCordeiraState()
  return { sent: 0, notes: 0 }
}

export async function ingestCordeiraPayload(payload: unknown, deps: CordeiraDeps = {}) {
  const event = parseCordeiraEvent(payload, deps.now ?? new Date())
  if (!event) return { sent: 0, notes: 0, ignored: true as const }
  return ingestCordeiraEvent(event, deps)
}
