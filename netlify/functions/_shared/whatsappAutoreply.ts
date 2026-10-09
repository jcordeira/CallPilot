import { env, isDemoMode } from './env'
import { kapsoConfigured, listKapsoMessages, sendKapsoText, type KapsoListedMessage } from './kapso'
import { normalizePhone } from './loaReminders'
import { sendSmsIfConfigured, toGsm7 } from './quo'
import { commandBusyUntil } from './commandStore'
import {
  claimAutoreplySend,
  loadWhatsappState,
  releaseAutoreplyClaim,
  saveWhatsappState,
  type WhatsappLog,
  type WhatsappPending,
  type WhatsappState,
} from './whatsappStore'

const DEFAULT_REPLY =
  "Thanks for your message! I'm on another call or in a meeting right now and will get back to you as soon as possible. - Joseph"

const IGNORED_TYPES = new Set(['system', 'unsupported', 'status', 'ephemeral', 'revoke'])
const STATUS_EVENTS = new Set(['whatsapp.message.delivered', 'whatsapp.message.read', 'whatsapp.message.failed'])
const MAX_ATTEMPTS = 3

export type WhatsappDelivery = {
  contactLabel: string
  status: WhatsappLog['status']
  summary: string
  whatsappBody?: string
  alertBody?: string
  error?: string
}

export type WhatsappRun = {
  ok: true
  enabled: boolean
  dryRun: boolean
  trigger: string
  skipped?: 'disabled' | 'demo'
  deliveries: WhatsappDelivery[]
}

export type WhatsappPanel = {
  enabled: boolean
  dryRun: boolean
  waitMinutes: number
  cooldownHours: number
  kapsoConfigured: boolean
  quoConfigured: boolean
  loPhoneSet: boolean
  pending: number
  recent: WhatsappLog[]
}

type SendWhatsapp = (input: { to?: string; recipient?: string; body: string }) => Promise<{ id: string }>
type SendAlert = (input: { to: string; content: string }) => Promise<{ id: string } | { skipped: 'not_configured' | 'budget' }>

type Rec = Record<string, unknown>

function intEnv(key: string, fallback: number): number {
  const parsed = Number(env(key).trim())
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function whatsappAutoreplyEnabled(): boolean {
  return env('WHATSAPP_AUTOREPLY_ENABLED', 'false').trim().toLowerCase() === 'true'
}

export function whatsappSettings() {
  return {
    waitMinutes: intEnv('WHATSAPP_AUTOREPLY_WAIT_MINUTES', 5),
    cooldownHours: intEnv('WHATSAPP_AUTOREPLY_COOLDOWN_HOURS', 4),
    maxAgeHours: intEnv('WHATSAPP_AUTOREPLY_MAX_AGE_HOURS', 24),
    dryRun: env('WHATSAPP_AUTOREPLY_DRY_RUN', 'false').trim().toLowerCase() === 'true',
    replyText: env('WHATSAPP_AUTOREPLY_TEXT').trim() || DEFAULT_REPLY,
  }
}

function asRec(value: unknown): Rec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Rec
}

function messageText(message: Rec): string {
  const text = asRec(message.text)
  if (text && typeof text.body === 'string' && text.body.trim()) return text.body.trim()
  const kapso = asRec(message.kapso)
  if (kapso && typeof kapso.content === 'string' && kapso.content.trim()) return kapso.content.trim()
  const type = typeof message.type === 'string' ? message.type : 'message'
  return `[${type}]`
}

function messageTime(message: Rec, fallback: Date): Date {
  const raw = message.timestamp
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const n = Number(raw)
    const ms = n < 1e12 ? n * 1000 : n
    const at = new Date(ms)
    if (!Number.isNaN(at.getTime())) return at
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw
    const at = new Date(ms)
    if (!Number.isNaN(at.getTime())) return at
  }
  return fallback
}

function originOf(message: Rec): string {
  const kapso = asRec(message.kapso)
  return typeof kapso?.origin === 'string' ? kapso.origin.toLowerCase() : ''
}

function directionOf(message: Rec, event = ''): 'inbound' | 'outbound' | null {
  const kapso = asRec(message.kapso)
  const fromKapso = typeof kapso?.direction === 'string' ? kapso.direction.toLowerCase() : ''
  if (fromKapso === 'inbound' || fromKapso === 'outbound') return fromKapso
  const direct = typeof message.direction === 'string' ? message.direction.toLowerCase() : ''
  if (direct === 'inbound' || direct === 'outbound') return direct
  const source = typeof kapso?.source === 'string' ? kapso.source.toLowerCase() : ''
  if (event === 'smb_message_echoes' || event.includes('echo') || source.includes('echo')) return 'outbound'
  if (event === 'whatsapp.message.sent') return 'outbound'
  if (event === 'whatsapp.message.received') return 'inbound'
  if (originOf(message) === 'business_app') return 'outbound'
  if (message.from && !message.to) return 'inbound'
  if (message.to && !message.from) return 'outbound'
  return null
}

function looksLikeGroup(record: Rec | null): boolean {
  if (!record) return false
  if (record.group_id || record.groupId || record.is_group === true || record.isGroup === true) return true
  for (const value of [record.phone_number, record.from, record.to, record.wa_id]) {
    if (typeof value === 'string' && value.includes('@g.us')) return true
  }
  return false
}

function isGroup(message: Rec, conversation: Rec | null): boolean {
  return looksLikeGroup(message) || looksLikeGroup(conversation) || looksLikeGroup(asRec(message.context)) || looksLikeGroup(asRec(conversation?.kapso))
}

function ignoredType(message: Rec): boolean {
  const type = typeof message.type === 'string' ? message.type.toLowerCase() : ''
  return IGNORED_TYPES.has(type)
}

/**
 * Kapso wraps a reaction as `message.reaction` (`message_id` + `emoji`) on
 * `whatsapp.message.sent`. Meta's Cloud API and Business-app echoes use the
 * same object on the message itself. A removed reaction omits `emoji` or sends it empty.
 */
function reactionSource(message: Rec): Rec | null {
  const nested = asRec(message.message)
  const candidates = [asRec(message.reaction), asRec(nested?.reaction), asRec(asRec(message.kapso)?.message_type_data)]
  for (const candidate of candidates) {
    if (!candidate) continue
    if ('emoji' in candidate || 'message_id' in candidate || 'messageId' in candidate) return candidate
  }
  return null
}

function isReaction(message: Rec): boolean {
  const type = typeof message.type === 'string' ? message.type.toLowerCase() : ''
  return type === 'reaction' || asRec(message.reaction) != null || asRec(asRec(message.message)?.reaction) != null
}

function reactionEmoji(message: Rec): string {
  const source = reactionSource(message)
  const raw = source?.emoji
  return typeof raw === 'string' ? raw.trim() : ''
}

function payloadMessage(payload: Rec): Rec | null {
  const wrapped = asRec(payload.message)
  if (wrapped) return wrapped
  const type = typeof payload.type === 'string' ? payload.type.toLowerCase() : ''
  if (type === 'reaction' || asRec(payload.reaction)) return payload
  return null
}

function passive(message: Rec): boolean {
  const kapso = asRec(message.kapso)
  return kapso?.passive === true
}

type Contact = { key: string; phone?: string; recipient?: string; label: string; alertLabel: string; conversationId?: string }

function contactOf(message: Rec, conversation: Rec | null, direction: 'inbound' | 'outbound'): Contact | null {
  const phoneRaw =
    (typeof conversation?.phone_number === 'string' && conversation.phone_number) ||
    (direction === 'outbound' && typeof message.to === 'string' && message.to) ||
    (direction === 'inbound' && typeof message.from === 'string' && message.from) ||
    ''
  const phone = normalizePhone(phoneRaw.startsWith('+') ? phoneRaw : phoneRaw.replace(/[^\d]/g, ''))
  const bsuid =
    (typeof conversation?.business_scoped_user_id === 'string' && conversation.business_scoped_user_id) ||
    (typeof message.from_user_id === 'string' && message.from_user_id) ||
    ''
  const name = typeof conversation?.contact_name === 'string' ? conversation.contact_name.trim() : ''
  const key = phone ? `phone:${phone}` : bsuid ? `bsuid:${bsuid}` : typeof conversation?.id === 'string' ? `conv:${conversation.id}` : ''
  if (!key) return null
  const digits = (phone ?? '').replace(/\D/g, '')
  const privateLabel = name || (digits ? `···${digits.slice(-4)}` : 'a contact')
  const conversationId = typeof conversation?.id === 'string' ? conversation.id : undefined
  return {
    key,
    phone,
    recipient: phone ? undefined : bsuid || undefined,
    label: privateLabel,
    alertLabel: name || phone || 'a contact',
    conversationId,
  }
}

function phoneMatchesConfigured(payload: Rec): boolean {
  const expected = env('KAPSO_PHONE_NUMBER_ID').trim()
  if (!expected) return true
  const id = payload.phone_number_id
  if (typeof id !== 'string' || !id) return true
  return id === expected
}

function inCooldown(state: WhatsappState, key: string, now: Date): boolean {
  const until = state.cooldownUntil[key]
  if (!until) return false
  return new Date(until).getTime() > now.getTime()
}

function rememberId(state: WhatsappState, id: string) {
  if (!id || state.ownMessageIds.includes(id)) return
  state.ownMessageIds.push(id)
}

function isOwnApiMessage(message: Rec, state: WhatsappState, replyText: string): boolean {
  const id = typeof message.id === 'string' ? message.id : ''
  if (id && state.ownMessageIds.includes(id)) return true
  return originOf(message) === 'cloud_api' && messageText(message) === replyText
}

function metaEchoes(record: Rec): { event: string; payload: Rec }[] {
  const entries = Array.isArray(record.entry) ? record.entry : []
  const out: { event: string; payload: Rec }[] = []
  for (const entry of entries) {
    const changes = asRec(entry)?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const item = asRec(change)
      const value = asRec(item?.value)
      if (!item || !value) continue
      const field = typeof item.field === 'string' ? item.field : ''
      if (field !== 'smb_message_echoes' || !Array.isArray(value.message_echoes)) continue
      const phoneNumberId = asRec(value.metadata)?.phone_number_id
      for (const echo of value.message_echoes) {
        const message = asRec(echo)
        if (!message) continue
        const to = typeof message.to === 'string' ? message.to : ''
        out.push({
          event: 'smb_message_echoes',
          payload: {
            message,
            phone_number_id: typeof phoneNumberId === 'string' ? phoneNumberId : undefined,
            conversation: to ? { phone_number: to } : undefined,
          },
        })
      }
    }
  }
  return out
}

function collectEvents(body: unknown, event: string): { event: string; payload: Rec }[] {
  const record = asRec(body)
  if (!record) return []
  if (record.batch === true && Array.isArray(record.data)) {
    return record.data.flatMap((item) => collectEvents(item, event))
  }
  const echoes = metaEchoes(record)
  if (echoes.length) return echoes
  if (Array.isArray(record.message_echoes)) {
    return collectEvents({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'smb_message_echoes', value: record }] }] }, event)
  }
  return [{ event, payload: record }]
}

function clip(text: string): string {
  const flat = toGsm7(text).replace(/\s+/g, ' ').trim()
  const ellipsis = '...'
  return flat.length > 80 ? `${flat.slice(0, 80 - ellipsis.length)}${ellipsis}` : flat
}

export function whatsappAlert(label: string, minutes: number, snippet: string): string {
  return toGsm7(`LoanPilot: WhatsApp from ${label}, no reply in ${minutes} min, auto-replied. '${clip(snippet)}'`)
}

function pushLog(state: WhatsappState, log: WhatsappLog) {
  state.recent = [log, ...state.recent].slice(0, 40)
}

/** Record an inbound 1:1, or cancel it when Joseph (or any non-API outbound) answers. */
export async function ingestKapsoWebhook(input: {
  event: string
  body: unknown
  idempotencyKey?: string | null
  now?: Date
}): Promise<{ ok: true; skipped?: 'disabled' | 'duplicate'; ignored?: string; recorded: number; cancelled: number }> {
  const now = input.now ?? new Date()
  const base = { ok: true as const, recorded: 0, cancelled: 0 }
  if (!whatsappAutoreplyEnabled()) return { ...base, skipped: 'disabled' }

  const state = await loadWhatsappState()
  const key = input.idempotencyKey?.trim()
  if (key && state.idempotencyKeys.includes(key)) return { ...base, skipped: 'duplicate' }
  if (key) state.idempotencyKeys.push(key)

  const settings = whatsappSettings()
  const eventName = input.event.trim()
  let changed = Boolean(key)
  let duplicates = 0

  for (const item of collectEvents(input.body, eventName)) {
    const event = item.event
    const payload = item.payload
    if (!phoneMatchesConfigured(payload)) {
      continue
    }
    if (event === 'whatsapp.conversation.inactive') {
      const since = asRec(payload.since_message)
      const conversation = asRec(payload.conversation)
      const direction = since?.direction === 'outbound' ? 'outbound' : since?.direction === 'inbound' ? 'inbound' : null
      if (!conversation || !direction) continue
      const stub: Rec = {
        id: typeof since?.whatsapp_message_id === 'string' ? since.whatsapp_message_id : 'inactive',
        timestamp: typeof since?.created_at === 'string' ? undefined : undefined,
        from: direction === 'inbound' ? conversation.phone_number : undefined,
        to: direction === 'outbound' ? conversation.phone_number : undefined,
        type: 'text',
        text: { body: '' },
        kapso: { direction, origin: direction === 'outbound' ? 'business_app' : 'cloud_api' },
      }
      const at = typeof since?.created_at === 'string' ? new Date(since.created_at) : now
      const when = Number.isNaN(at.getTime()) ? now : at
      if (direction === 'outbound') {
        if (cancelPending(state, stub, conversation, when)) base.cancelled += 1
        changed = true
      } else if (recordInbound(state, stub, conversation, when, settings.maxAgeHours, now)) {
        base.recorded += 1
        changed = true
      }
      continue
    }
    if (STATUS_EVENTS.has(event)) continue
    const message = payloadMessage(payload)
    const conversation = asRec(payload.conversation)
    if (!message) continue
    if (originOf(message) === 'history_sync' || passive(message) || ignoredType(message) || isGroup(message, conversation)) {
      continue
    }
    const direction = directionOf(message, event)
    if (!direction) continue
    // Inbound reactions are not new messages. An empty emoji is a removed reaction, not an answer.
    if (isReaction(message) && (direction !== 'outbound' || !reactionEmoji(message))) continue
    const messageId = typeof message.id === 'string' ? message.id : ''
    if (messageId && state.seenMessageIds.includes(messageId)) {
      duplicates += 1
      continue
    }
    if (messageId) {
      state.seenMessageIds.push(messageId)
      changed = true
    }
    if (direction === 'outbound') {
      if (isOwnApiMessage(message, state, settings.replyText)) continue
      if (cancelPending(state, message, conversation, messageTime(message, now))) base.cancelled += 1
      changed = true
      continue
    }
    if (recordInbound(state, message, conversation, messageTime(message, now), settings.maxAgeHours, now)) {
      base.recorded += 1
      changed = true
    }
  }

  if (changed) await saveWhatsappState(state)
  if (!base.recorded && !base.cancelled) {
    if (duplicates) return { ...base, skipped: 'duplicate' }
    return { ...base, ignored: 'no actionable message' }
  }
  return base
}

function answeredAfter(state: WhatsappState, key: string, inboundAt: string): boolean {
  const at = state.answeredAt[key]
  if (!at) return false
  return new Date(at).getTime() + 1000 >= new Date(inboundAt).getTime()
}

function noteAnswered(state: WhatsappState, key: string, at: Date) {
  const prev = state.answeredAt[key]
  if (!prev || new Date(prev).getTime() < at.getTime()) state.answeredAt[key] = at.toISOString()
}

function recordInbound(state: WhatsappState, message: Rec, conversation: Rec | null, at: Date, maxAgeHours: number, now: Date): boolean {
  if (Number.isNaN(at.getTime())) return false
  if (now.getTime() - at.getTime() > maxAgeHours * 3_600_000) return false
  const contact = contactOf(message, conversation, 'inbound')
  if (!contact) return false
  if (answeredAfter(state, contact.key, at.toISOString())) return false
  if (inCooldown(state, contact.key, now)) return false
  const existing = state.pending[contact.key]
  if (existing && new Date(existing.inboundAt).getTime() > at.getTime()) return false
  const snippet = messageText(message)
  state.pending[contact.key] = {
    contactKey: contact.key,
    phone: contact.phone,
    recipient: contact.recipient,
    label: contact.label,
    alertLabel: contact.alertLabel,
    snippet: snippet || '[message]',
    messageId: typeof message.id === 'string' ? message.id : contact.key,
    conversationId: contact.conversationId,
    inboundAt: at.toISOString(),
    attempts: existing && existing.messageId === message.id ? existing.attempts : 0,
  }
  return true
}

function cancelPending(state: WhatsappState, message: Rec, conversation: Rec | null, at: Date): boolean {
  const contact = contactOf(message, conversation, 'outbound')
  if (!contact) return false
  noteAnswered(state, contact.key, at)
  const pending = state.pending[contact.key]
  if (!pending) return false
  if (at.getTime() + 1000 < new Date(pending.inboundAt).getTime()) return false
  delete state.pending[contact.key]
  pushLog(state, {
    id: `${at.getTime()}-cancel-${contact.key}`,
    at: at.toISOString(),
    trigger: 'reply',
    dryRun: false,
    contactLabel: pending.label,
    summary: `Joseph replied. Auto-reply cancelled for ${pending.label}.`,
    status: 'cancelled',
  })
  return true
}

export async function getWhatsappPanel(): Promise<WhatsappPanel> {
  const settings = whatsappSettings()
  const state = await loadWhatsappState()
  return {
    enabled: whatsappAutoreplyEnabled(),
    dryRun: settings.dryRun,
    waitMinutes: settings.waitMinutes,
    cooldownHours: settings.cooldownHours,
    kapsoConfigured: kapsoConfigured(),
    quoConfigured: env('QUO_API_KEY').trim() !== '' && env('QUO_FROM_NUMBER').trim() !== '',
    loPhoneSet: Boolean(normalizePhone(env('FUB_LO_PHONE'))),
    pending: Object.keys(state.pending).length,
    recent: state.recent,
  }
}

function sameParty(message: Rec, pending: WhatsappPending): boolean {
  if (!pending.phone) return true
  const kapso = asRec(message.kapso)
  const raw = [message.from, message.to, kapso?.phone_number].filter((value): value is string => typeof value === 'string')
  if (!raw.length) return true
  return raw.some((value) => normalizePhone(value) === pending.phone)
}

function historyBlocks(messages: Rec[], state: WhatsappState, pending: WhatsappPending, replyText: string): boolean {
  const inboundAt = new Date(pending.inboundAt).getTime()
  return messages.some((message) => {
    if (directionOf(message) !== 'outbound') return false
    if (!sameParty(message, pending)) return false
    if (messageTime(message, new Date(0)).getTime() + 1000 < inboundAt) return false
    if (isOwnApiMessage(message, state, replyText)) return false
    if (isReaction(message) && !reactionEmoji(message)) return false
    return true
  })
}

function asHistory(row: KapsoListedMessage): Rec {
  return row as Rec
}

export async function runWhatsappAutoreply(options?: {
  now?: Date
  trigger?: string
  dryRun?: boolean
  sendWhatsapp?: SendWhatsapp
  sendAlert?: SendAlert
  listMessages?: (input: { phone?: string; conversationId?: string; since: string }) => Promise<KapsoListedMessage[]>
}): Promise<WhatsappRun> {
  const now = options?.now ?? new Date()
  const trigger = options?.trigger ?? 'schedule'
  const settings = whatsappSettings()
  const enabled = whatsappAutoreplyEnabled()
  const dryRun = options?.dryRun === true || (enabled && settings.dryRun)
  const base: WhatsappRun = { ok: true, enabled, dryRun, trigger, deliveries: [] }
  if (!enabled && options?.dryRun !== true) return { ...base, skipped: 'disabled' }
  if (!options?.sendWhatsapp && !options?.sendAlert && isDemoMode() && options?.dryRun !== true) {
    return { ...base, skipped: 'demo' }
  }

  const state = await loadWhatsappState()
  const sendWhatsapp = options?.sendWhatsapp ?? sendKapsoText
  const sendAlert = options?.sendAlert ?? ((input: { to: string; content: string }) => sendSmsIfConfigured({ ...input, priority: 'normal', truncateStyle: 'fub' }))
  const listMessages = options?.listMessages ?? (async (input: { phone?: string; conversationId?: string; since: string }) => {
    const rows = await listKapsoMessages(input)
    return rows ?? []
  })
  const loPhone = normalizePhone(env('FUB_LO_PHONE'))
  const waitMs = settings.waitMinutes * 60_000
  const busyUntil = await commandBusyUntil(now)
  const busyLabel = busyUntil
    ? new Intl.DateTimeFormat('en-US', { timeZone: env('COMMAND_TIMEZONE', 'America/New_York'), hour: 'numeric', minute: '2-digit' }).format(new Date(busyUntil))
    : ''
  const replyBody = busyLabel ? `${settings.replyText} Holding calls until ${busyLabel} ET.` : settings.replyText
  const deliveries: WhatsappDelivery[] = []

  for (const [key, pending] of Object.entries(state.pending)) {
    const waited = new Date(pending.inboundAt).getTime() + waitMs <= now.getTime()
    if (!busyUntil && !waited) continue
    if (inCooldown(state, key, now) || answeredAfter(state, key, pending.inboundAt)) {
      delete state.pending[key]
      continue
    }
    const summary = whatsappAlert(pending.alertLabel, settings.waitMinutes, pending.snippet)
    if (dryRun) {
      if (pending.previewed) continue
      pending.previewed = true
      const delivery: WhatsappDelivery = {
        contactLabel: pending.label,
        status: 'preview',
        summary,
        whatsappBody: replyBody,
        alertBody: summary,
      }
      deliveries.push(delivery)
      pushLog(state, logFrom(now, trigger, true, pending, delivery))
      continue
    }
    if (!pending.phone && !pending.recipient) {
      deliveries.push(finishSkip(state, now, trigger, pending, 'No phone or WhatsApp id for this contact'))
      delete state.pending[key]
      continue
    }
    if (!options?.sendWhatsapp && !kapsoConfigured()) {
      if (pending.skipLogged) continue
      pending.skipLogged = true
      deliveries.push(finishSkip(state, now, trigger, pending, 'Kapso is not configured'))
      continue
    }
    const claimed = await claimAutoreplySend(key, pending.messageId, now.toISOString())
    if (!claimed) {
      delete state.pending[key]
      continue
    }
    try {
      let history: Rec[] = []
      try {
        history = (await listMessages({
          phone: pending.phone,
          conversationId: pending.conversationId,
          since: pending.inboundAt,
        })).map(asHistory)
      } catch {
        await releaseAutoreplyClaim(key, pending.messageId)
        continue
      }
      if (historyBlocks(history, state, pending, settings.replyText)) {
        noteAnswered(state, key, now)
        delete state.pending[key]
        pushLog(state, {
          id: `${now.getTime()}-cancel-${pending.messageId}`,
          at: now.toISOString(),
          trigger,
          dryRun: false,
          contactLabel: pending.label,
          summary: `Joseph replied. Auto-reply cancelled for ${pending.label}.`,
          status: 'cancelled',
        })
        continue
      }
      const sent = await sendWhatsapp({ to: pending.phone, recipient: pending.recipient, body: replyBody })
      rememberId(state, sent.id)
      state.cooldownUntil[key] = new Date(now.getTime() + settings.cooldownHours * 3_600_000).toISOString()
      delete state.pending[key]
      let alertBody: string | undefined
      let note: string | undefined
      if (loPhone) {
        alertBody = summary
        try {
          const alert = await sendAlert({ to: loPhone, content: summary })
          if ('skipped' in alert) note = alert.skipped === 'budget' ? 'SMS budget' : 'Quo alert skipped'
        } catch (err) {
          note = err instanceof Error && err.message ? err.message : 'Quo alert failed'
        }
      } else {
        note = 'FUB_LO_PHONE is not set'
      }
      const delivery: WhatsappDelivery = {
        contactLabel: pending.label,
        status: 'sent',
        summary: note ? `${summary} (${note})` : summary,
        whatsappBody: replyBody,
        alertBody,
        error: note,
      }
      deliveries.push(delivery)
      pushLog(state, logFrom(now, trigger, false, pending, delivery))
    } catch (err) {
      await releaseAutoreplyClaim(key, pending.messageId)
      pending.attempts += 1
      const error = err instanceof Error && err.message ? err.message : 'WhatsApp send failed'
      if (pending.attempts >= MAX_ATTEMPTS) {
        deliveries.push({
          contactLabel: pending.label,
          status: 'error',
          summary: `Auto-reply failed for ${pending.label}`,
          error,
        })
        pushLog(state, {
          id: `${now.getTime()}-err-${pending.messageId}`,
          at: now.toISOString(),
          trigger,
          dryRun: false,
          contactLabel: pending.label,
          summary: `Auto-reply failed for ${pending.label}`,
          status: 'error',
          error,
        })
        delete state.pending[key]
      }
    }
  }

  await saveWhatsappState(state)
  console.log(`[whatsapp-autoreply] ${dryRun ? 'dry-run' : 'run'} trigger=${trigger} deliveries=${deliveries.length}`)
  return { ...base, deliveries }
}

function finishSkip(state: WhatsappState, now: Date, trigger: string, pending: WhatsappPending, error: string): WhatsappDelivery {
  const delivery: WhatsappDelivery = {
    contactLabel: pending.label,
    status: 'skipped',
    summary: `${error} (${pending.label})`,
    error,
  }
  pushLog(state, logFrom(now, trigger, false, pending, delivery))
  return delivery
}

function logFrom(now: Date, trigger: string, dryRun: boolean, pending: WhatsappPending, delivery: WhatsappDelivery): WhatsappLog {
  return {
    id: `${now.getTime()}-${pending.messageId}-${delivery.status}`,
    at: now.toISOString(),
    trigger,
    dryRun,
    contactLabel: pending.label,
    summary: delivery.summary,
    status: delivery.status,
    error: delivery.error,
  }
}
