import { claimContractAlert, contractAlertPhone, releaseContractAlert, rememberContractAlertPhone } from './contractAlertStore'
import { env, isDemoMode } from './env'
import { addNote, fubGetStrict, logExternalText } from './followupboss'
import { escapeHtml, normalizePhone, personLink, smsPersonLink } from './loaReminders'
import { sendSmsIfConfigured } from './quo'

/** Purchase pipeline on the teamcordeira account. */
export const PURCHASE_PIPELINE_ID = 1
/** Buyer Contract stage on that pipeline. */
export const BUYER_CONTRACT_STAGE_ID = 14
const STAGE_NAME = 'buyer contract'
const LOOKBACK_MS = 24 * 60 * 60 * 1000
const FUTURE_SKEW_MS = 5 * 60 * 1000
const DEFAULT_PHONE = '+12013946798'
const DEFAULT_USER_ID = 32
const DEFAULT_NAME = 'Debra Rose'

const ADDRESS_KEYS = ['address', 'propertyAddress', 'property', 'streetAddress', 'fullAddress', 'dealAddress']

export type ContractNote = {
  personId: number
  subject: string
  body: string
  isHtml?: boolean
  mentionUserIds?: number[]
}

export type ContractSms = {
  to: string
  content: string
  priority?: 'high' | 'normal'
  truncate?: 'auto' | 'exempt'
}

export type ContractTextLog = {
  personId: number
  message: string
  toNumber: string
  fromNumber: string
}

export type ContractAlertDeps = {
  now?: Date
  loadDeal?: (id: number) => Promise<unknown>
  listDeals?: () => Promise<unknown[]>
  loadPerson?: (id: number) => Promise<unknown>
  sendSms?: (input: ContractSms) => Promise<{ id: string } | { skipped: 'not_configured' | 'budget' }>
  postNote?: (note: ContractNote) => Promise<void>
  logText?: (input: ContractTextLog) => Promise<void>
}

export type ContractAlertResult = {
  skipped?: ContractSkip
  sent: number
  noted: number
  clientSent: number
  clientNoted: number
  dealId?: number
}

export type ContractSkip = 'disabled' | 'demo' | 'ignored' | 'not_buyer_contract' | 'stale' | 'duplicate'

type ParsedDeal = {
  id: number
  pipelineId: number | null
  stageId: number | null
  stageName: string
  name: string
  status: string
  priceLabel: string
  address: string
  enteredStageAt: string | null
  personId: number | null
  personName: string
  agentName: string
}

/** On unless CONTRACT_ALERTS_ENABLED is explicitly false. Unset stays on so production needs no env change. */
export function contractAlertsEnabled(): boolean {
  const raw = env('CONTRACT_ALERTS_ENABLED').trim().toLowerCase()
  if (!raw) return true
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no'
}

/** On unless CONTRACT_CLIENT_TEXT_ENABLED is explicitly false. Unset stays on. */
export function contractClientTextEnabled(): boolean {
  const raw = env('CONTRACT_CLIENT_TEXT_ENABLED').trim().toLowerCase()
  if (!raw) return true
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no'
}

const CLIENT_BLOCK_TAGS = ['dnc', 'do not text', 'bad phone', 'wrong number', 'opted out', 'opt out']
const CLIENT_BLOCK_STAGES = ['trash', 'wrong number']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function positiveId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function optionalId(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function unwrapDeal(source: unknown): Record<string, unknown> | null {
  const root = asRecord(source)
  if (!root) return null
  return asRecord(root.deal) ?? root
}

function addressText(value: unknown): string {
  const direct = text(value)
  if (direct && !/^https?:/i.test(direct)) return direct
  const record = asRecord(value)
  if (!record) return ''
  const street = text(record.street) || text(record.address) || text(record.line1) || text(record.streetAddress)
  const city = text(record.city)
  const state = text(record.state)
  const zip = text(record.zip) || text(record.postalCode)
  const cityLine = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, cityLine].filter(Boolean).join(', ')
}

function addressOf(record: Record<string, unknown>): string {
  for (const key of ADDRESS_KEYS) {
    const found = addressText(record[key])
    if (found) return found
  }
  for (const [key, value] of Object.entries(record)) {
    if (!/address|property/i.test(key)) continue
    if (/pipeline|stage|people|user/i.test(key)) continue
    const found = addressText(value)
    if (found) return found.slice(0, 180)
  }
  return ''
}

function priceLabel(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }
  const raw = text(value)
  if (!raw || raw === '0') return ''
  return raw
}

function peopleOf(value: unknown): { id: number | null; name: string } {
  if (!Array.isArray(value)) return { id: null, name: '' }
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const id = positiveId(record.id)
    const name = text(record.name)
    if (id || name) return { id, name }
  }
  return { id: null, name: '' }
}

/** people[0] when that record has an id or a name. Otherwise the person linked on the deal. */
function primaryPerson(record: Record<string, unknown>): { id: number | null; name: string } {
  const listed = peopleOf(record.people)
  if (listed.id || listed.name) return listed
  const linked = asRecord(record.person)
  return {
    id: positiveId(record.personId) ?? (linked ? positiveId(linked.id) : null),
    name: linked ? text(linked.name) : '',
  }
}

function agentName(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const names: string[] = []
  for (const item of value) {
    const record = asRecord(item)
    const name = record ? text(record.name) : ''
    if (name && !names.includes(name)) names.push(name)
  }
  return names.join(', ')
}

export function parseDeal(source: unknown): ParsedDeal | null {
  const record = unwrapDeal(source)
  const id = positiveId(record?.id)
  if (!record || !id) return null
  const person = primaryPerson(record)
  return {
    id,
    pipelineId: optionalId(record.pipelineId),
    stageId: optionalId(record.stageId),
    stageName: text(record.stageName) || text(record.stage),
    name: text(record.name),
    status: text(record.status),
    priceLabel: priceLabel(record.price),
    address: addressOf(record),
    enteredStageAt: text(record.enteredStageAt) || null,
    personId: person.id,
    personName: person.name,
    agentName: agentName(record.users),
  }
}

/** Purchase pipeline and Buyer Contract. Stage id 14 wins. The stage name is only used when the id is absent. */
export function isBuyerContract(deal: ParsedDeal): boolean {
  if (deal.pipelineId !== PURCHASE_PIPELINE_ID) return false
  if (/^(archived|deleted)$/i.test(deal.status)) return false
  if (deal.stageId === BUYER_CONTRACT_STAGE_ID) return true
  return deal.stageId == null && deal.stageName.toLowerCase() === STAGE_NAME
}

/** True when this entry into the stage is new enough to alert. Older edits of a deal already in the stage are ignored. */
export function entryIsRecent(enteredStageAt: string | null, now: Date): boolean {
  if (!enteredStageAt) return false
  const at = Date.parse(enteredStageAt)
  if (!Number.isFinite(at)) return false
  const age = now.getTime() - at
  return age <= LOOKBACK_MS && age >= -FUTURE_SKEW_MS
}

function entryToken(enteredStageAt: string): string {
  return enteredStageAt.replace(/[^A-Za-z0-9._~-]/g, '.')
}

export function contractAlertPhones(): string[] {
  const raw = env('CONTRACT_ALERT_PHONES', DEFAULT_PHONE)
  const phones = raw
    .split(/[,;\s]+/)
    .map((phone) => normalizePhone(phone))
    .filter((phone): phone is string => Boolean(phone))
  return [...new Set(phones)]
}

export function contractAlertMention(): { userId: number; name: string } {
  const parsed = Number(env('CONTRACT_ALERT_USER_ID', String(DEFAULT_USER_ID)))
  const userId = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_USER_ID
  return { userId, name: env('CONTRACT_ALERT_NAME', DEFAULT_NAME).trim() || DEFAULT_NAME }
}

export function contractAlertMessage(input: {
  leadName: string
  dealName: string
  personId?: number | null
  priceLabel?: string
  address?: string
  agentName?: string
}): string {
  const lead = input.leadName.trim() || 'A lead'
  const deal = input.dealName.trim() || 'Purchase deal'
  const parts = [
    `LoanPilot: Contract in. ${lead} moved to Buyer Contract.`,
    `Deal ${deal}.`,
  ]
  if (input.priceLabel?.trim()) parts.push(`${input.priceLabel.trim()}.`)
  if (input.address?.trim()) parts.push(`${input.address.trim()}.`)
  if (input.agentName?.trim()) parts.push(`Agent ${input.agentName.trim()}.`)
  if (input.personId) parts.push(smsPersonLink(input.personId))
  return parts.join(' ')
}

function normLabel(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function labelBlocked(value: string, phrases: string[]): boolean {
  const norm = normLabel(value)
  if (!norm) return false
  return phrases.some((phrase) => norm === phrase || norm.includes(phrase))
}

function unwrapPerson(source: unknown): Record<string, unknown> | null {
  const root = asRecord(source)
  if (!root) return null
  return asRecord(root.person) ?? root
}

function stageLabel(person: Record<string, unknown>): string {
  if (typeof person.stage === 'string') return person.stage
  const stage = asRecord(person.stage)
  return text(stage?.name) || text(stage?.stage)
}

function tagsOf(person: Record<string, unknown>): string[] {
  if (!Array.isArray(person.tags)) return []
  const tags: string[] = []
  for (const tag of person.tags) {
    if (typeof tag === 'string') tags.push(tag)
    else {
      const record = asRecord(tag)
      const name = record ? text(record.name) : ''
      if (name) tags.push(name)
    }
  }
  return tags
}

function personBlocked(person: Record<string, unknown>): boolean {
  if (labelBlocked(stageLabel(person), CLIENT_BLOCK_STAGES)) return true
  return tagsOf(person).some((tag) => labelBlocked(tag, CLIENT_BLOCK_TAGS))
}

function phoneRows(person: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(person.phones)) return []
  return person.phones.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row != null)
}

function isMobile(row: Record<string, unknown>): boolean {
  const type = normLabel(text(row.type) || text(row.phoneType))
  return type === 'mobile' || type === 'cell' || type === 'cellular'
}

function isPrimaryPhone(row: Record<string, unknown>): boolean {
  const flag = row.isPrimary ?? row.primary
  return flag === true || flag === 1 || flag === '1'
}

function usableUsPhone(row: Record<string, unknown>): string | null {
  const status = normLabel(text(row.status))
  if (status && /invalid|bad|wrong|disconnected|opt/.test(status)) return null
  const phone = normalizePhone(text(row.normalized) || text(row.value) || text(row.number))
  if (!phone || !/^\+1\d{10}$/.test(phone)) return null
  return phone
}

/** Primary mobile, otherwise the first mobile. Untyped numbers are treated as mobile. US E.164 only. */
export function leadMobilePhone(source: unknown): string | null {
  const person = unwrapPerson(source)
  if (!person) return null
  const rows = phoneRows(person)
  const typed = rows.some((row) => text(row.type) || text(row.phoneType))
  const candidates = typed ? rows.filter(isMobile) : rows
  const ordered = [...candidates.filter(isPrimaryPhone), ...candidates.filter((row) => !isPrimaryPhone(row))]
  for (const row of ordered) {
    const phone = usableUsPhone(row)
    if (phone) return phone
  }
  return null
}

export function contractClientFirstName(source: unknown, fallbackName = ''): string {
  const person = unwrapPerson(source)
  const name = text(person?.firstName) || text(person?.name) || fallbackName.trim()
  return name.split(/\s+/).find(Boolean) ?? ''
}

/** Approved client copy. Only the first name is filled in. ASCII apostrophes and the hyphen stay GSM-7. */
export function contractClientMessage(firstName: string): string {
  const token = firstName.trim().split(/\s+/).find(Boolean) ?? ''
  const greeting = token ? `Hi ${token},` : 'Hi there,'
  return `${greeting} this is Team Cordeira at Cliffco Mortgage Bankers. We've received your contract of sale - congratulations! Joe Cordeira, Frank Cordeira and Debra Rose will reach out shortly with next steps. This number sends alerts only and can't receive replies.`
}

export function contractClientNote(phone: string): string {
  return `LoanPilot texted contract-received alert to ${phone}`
}

function noteBody(mention: { userId: number; name: string }, lines: string[]): string {
  const items = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
  return `<p><span data-user-id="${mention.userId}">${escapeHtml(mention.name)}</span> LoanPilot: Contract is in.</p><ul>${items}</ul>`
}

function resourceIds(payload: Record<string, unknown>): number[] {
  if (!Array.isArray(payload.resourceIds)) return []
  return payload.resourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
}

async function defaultLoadDeal(id: number): Promise<unknown> {
  return fubGetStrict(`/deals/${id}`)
}

async function defaultLoadPerson(id: number): Promise<unknown> {
  return fubGetStrict(`/people/${id}`)
}

function idle(skipped: ContractSkip, dealId?: number): ContractAlertResult {
  return { skipped, sent: 0, noted: 0, clientSent: 0, clientNoted: 0, dealId }
}

function dealsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  if (Array.isArray(record.deals)) return record.deals
  return []
}

async function defaultListDeals(): Promise<unknown[]> {
  const found: unknown[] = []
  for (let page = 0; page < 5; page += 1) {
    const payload = await fubGetStrict(`/deals?pipelineId=${PURCHASE_PIPELINE_ID}&status=Active&limit=100&offset=${page * 100}`)
    const deals = dealsOf(payload)
    if (!deals.length) break
    found.push(...deals)
    if (deals.length < 100) break
  }
  return found
}

async function logClientDelivery(
  deal: ParsedDeal,
  token: string,
  at: string,
  phone: string,
  message: string | null,
  load: (id: number) => Promise<unknown>,
  postNote: (note: ContractNote) => Promise<void>,
  logText: (input: ContractTextLog) => Promise<void>,
): Promise<number> {
  const personId = deal.personId
  if (!personId) return 0
  const noteKey = `client-note/${deal.id}/${token}`
  if (!(await claimContractAlert(noteKey, at))) return 0
  try {
    await postNote({
      personId,
      subject: 'LoanPilot — Buyer Contract',
      body: contractClientNote(phone),
      isHtml: false,
    })
  } catch (err) {
    await releaseContractAlert(noteKey)
    const reason = err instanceof Error && err.message ? err.message : 'note failed'
    console.log(`[contract-alert] deal ${deal.id} client note failed: ${reason.slice(0, 200)}`)
    return 0
  }
  let body = message
  if (!body) {
    try {
      body = contractClientMessage(contractClientFirstName(await load(personId), deal.personName))
    } catch {
      body = null
    }
  }
  const fromNumber = normalizePhone(env('QUO_FROM_NUMBER')) ?? ''
  if (body && fromNumber) {
    try {
      await logText({ personId, message: body, toNumber: phone, fromNumber })
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'text log failed'
      console.log(`[contract-alert] deal ${deal.id} client text log failed: ${reason.slice(0, 200)}`)
    }
  }
  return 1
}

/** Text the primary person once per entry. Budget and 402 release the claim so the 24h sweep can retry. */
async function notifyContractClient(
  deal: ParsedDeal,
  token: string,
  at: string,
  deps: ContractAlertDeps,
  send: (input: ContractSms) => Promise<{ id: string } | { skipped: 'not_configured' | 'budget' }>,
  postNote: (note: ContractNote) => Promise<void>,
): Promise<{ clientSent: number; clientNoted: number }> {
  if (!contractClientTextEnabled() || !deal.personId) return { clientSent: 0, clientNoted: 0 }
  const load = deps.loadPerson ?? defaultLoadPerson
  const logText = deps.logText ?? logExternalText
  const smsKey = `client-sms/${deal.id}/${token}`
  const writeLog = (phone: string, message: string | null) => logClientDelivery(deal, token, at, phone, message, load, postNote, logText)

  if (await claimContractAlert(smsKey, at)) {
    let person: unknown
    try {
      person = await load(deal.personId)
    } catch (err) {
      await releaseContractAlert(smsKey)
      const reason = err instanceof Error && err.message ? err.message : 'person load failed'
      console.log(`[contract-alert] deal ${deal.id} client person load failed: ${reason.slice(0, 200)}`)
      return { clientSent: 0, clientNoted: 0 }
    }
    const record = unwrapPerson(person)
    if (!record || personBlocked(record)) {
      console.log(`[contract-alert] deal ${deal.id} client sms skipped, ${record ? 'blocked' : 'no_person'}`)
      return { clientSent: 0, clientNoted: 0 }
    }
    const phone = leadMobilePhone(person)
    if (!phone) {
      console.log(`[contract-alert] deal ${deal.id} client sms skipped, no_phone`)
      return { clientSent: 0, clientNoted: 0 }
    }
    const message = contractClientMessage(contractClientFirstName(person, deal.personName))
    try {
      const result = await send({ to: phone, content: message, priority: 'high', truncate: 'exempt' })
      if ('skipped' in result) {
        await releaseContractAlert(smsKey)
        console.log(`[contract-alert] deal ${deal.id} client sms skipped, ${result.skipped}`)
        return { clientSent: 0, clientNoted: 0 }
      }
    } catch (err) {
      await releaseContractAlert(smsKey)
      const reason = err instanceof Error && err.message ? err.message : 'sms failed'
      console.log(`[contract-alert] deal ${deal.id} client sms failed: ${reason.slice(0, 200)}`)
      return { clientSent: 0, clientNoted: 0 }
    }
    await rememberContractAlertPhone(smsKey, phone)
    return { clientSent: 1, clientNoted: await writeLog(phone, message) }
  }

  const phone = await contractAlertPhone(smsKey)
  if (!phone) return { clientSent: 0, clientNoted: 0 }
  return { clientSent: 0, clientNoted: await writeLog(phone, null) }
}

export async function notifyBuyerContract(source: unknown, deps: ContractAlertDeps = {}): Promise<ContractAlertResult> {
  const deal = parseDeal(source)
  if (!deal) return idle('ignored')
  if (!isBuyerContract(deal)) return idle('not_buyer_contract', deal.id)
  const now = deps.now ?? new Date()
  if (!deal.enteredStageAt || !entryIsRecent(deal.enteredStageAt, now)) return idle('stale', deal.id)

  const leadName = deal.personName || deal.name
  const message = contractAlertMessage({
    leadName,
    dealName: deal.name,
    personId: deal.personId,
    priceLabel: deal.priceLabel,
    address: deal.address,
    agentName: deal.agentName,
  })
  const token = entryToken(deal.enteredStageAt)
  const at = now.toISOString()
  const send = deps.sendSms ?? ((input: ContractSms) => sendSmsIfConfigured({
    to: input.to,
    content: input.content,
    priority: input.priority ?? 'high',
    truncate: input.truncate,
    truncateStyle: input.truncate === 'exempt' ? undefined : 'fub',
  }))
  const postNote = deps.postNote ?? (async (note: ContractNote) => {
    await addNote(note)
  })

  let sent = 0
  const smsKey = `sms/${deal.id}/${token}`
  if (await claimContractAlert(smsKey, at)) {
    let failed = false
    let budgetSkip = false
    for (const phone of contractAlertPhones()) {
      try {
        const result = await send({ to: phone, content: message })
        if ('skipped' in result) {
          if (result.skipped === 'budget') budgetSkip = true
        } else sent += 1
      } catch (err) {
        failed = true
        const reason = err instanceof Error && err.message ? err.message : 'sms failed'
        console.log(`[contract-alert] deal ${deal.id} sms failed: ${reason.slice(0, 200)}`)
      }
    }
    if (sent === 0 && budgetSkip) console.log(`[contract-alert] deal ${deal.id} sms skipped, budget`)
    if (sent === 0 && !budgetSkip) await releaseContractAlert(smsKey)
    else if (failed) console.log(`[contract-alert] deal ${deal.id} kept the sms claim after a partial send`)
  }

  let noted = 0
  if (deal.personId) {
    const mention = contractAlertMention()
    const lines = [
      `${leadName || 'A lead'} moved to Buyer Contract (Purchase).`,
      `Deal: ${deal.name || 'Purchase deal'}.`,
    ]
    if (deal.priceLabel) lines.push(`Price: ${deal.priceLabel}.`)
    if (deal.address) lines.push(`Address: ${deal.address}.`)
    if (deal.agentName) lines.push(`Agent: ${deal.agentName}.`)
    lines.push(personLink(deal.personId))
    const noteKey = `note/${deal.id}/${token}`
    if (await claimContractAlert(noteKey, at)) {
      try {
        await postNote({
          personId: deal.personId,
          subject: 'LoanPilot — Buyer Contract',
          body: noteBody(mention, lines),
          isHtml: true,
          mentionUserIds: [mention.userId],
        })
        noted = 1
      } catch (err) {
        await releaseContractAlert(noteKey)
        const reason = err instanceof Error && err.message ? err.message : 'note failed'
        console.log(`[contract-alert] deal ${deal.id} note failed: ${reason.slice(0, 200)}`)
      }
    }
  }

  const client = await notifyContractClient(deal, token, at, deps, send, postNote)
  if (sent > 0 || noted > 0 || client.clientSent > 0 || client.clientNoted > 0) {
    console.log(`[contract-alert] deal ${deal.id} person ${deal.personId ?? 0} sent=${sent} noted=${noted} clientSent=${client.clientSent} clientNoted=${client.clientNoted}`)
  }
  if (sent === 0 && noted === 0 && client.clientSent === 0 && client.clientNoted === 0) {
    return { skipped: 'duplicate', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, dealId: deal.id }
  }
  return { sent, noted, clientSent: client.clientSent, clientNoted: client.clientNoted, dealId: deal.id }
}

/** Follow Up Boss dealsCreated and dealsUpdated. Resource ids are loaded with GET /v1/deals/:id. */
export async function handleFubContractWebhook(
  payload: unknown,
  deps: ContractAlertDeps = {},
): Promise<{ skipped?: ContractSkip; sent: number; noted: number; clientSent: number; clientNoted: number; checked: number }> {
  if (!contractAlertsEnabled()) return { skipped: 'disabled', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  if (!deps.loadDeal && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  }
  const body = asRecord(payload)
  if (!body) return { skipped: 'ignored', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  const eventName = typeof body.event === 'string' ? body.event : ''
  if (eventName && !/^deals(Created|Updated)$/i.test(eventName)) return { skipped: 'ignored', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  const ids = resourceIds(body)
  const load = deps.loadDeal ?? defaultLoadDeal
  let sent = 0
  let noted = 0
  let clientSent = 0
  let clientNoted = 0
  for (const id of ids) {
    try {
      const result = await notifyBuyerContract(await load(id), deps)
      sent += result.sent
      noted += result.noted
      clientSent += result.clientSent
      clientNoted += result.clientNoted
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'deal load failed'
      console.log(`[contract-alert] deal ${id} load failed: ${reason.slice(0, 200)}`)
    }
  }
  return { sent, noted, clientSent, clientNoted, checked: ids.length }
}

/** Fallback for a Buyer Contract entry the webhook missed. Last 24 hours, Purchase pipeline only. */
export async function runContractAlertSweep(
  deps: ContractAlertDeps = {},
): Promise<{ skipped?: ContractSkip; sent: number; noted: number; clientSent: number; clientNoted: number; checked: number }> {
  if (!contractAlertsEnabled()) return { skipped: 'disabled', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  if (!deps.listDeals && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', sent: 0, noted: 0, clientSent: 0, clientNoted: 0, checked: 0 }
  }
  const now = deps.now ?? new Date()
  const deals = await (deps.listDeals ?? defaultListDeals)()
  let sent = 0
  let noted = 0
  let clientSent = 0
  let clientNoted = 0
  let checked = 0
  for (const deal of deals) {
    const parsed = parseDeal(deal)
    if (!parsed || !isBuyerContract(parsed) || !entryIsRecent(parsed.enteredStageAt, now)) continue
    checked += 1
    try {
      const result = await notifyBuyerContract(deal, { ...deps, now })
      sent += result.sent
      noted += result.noted
      clientSent += result.clientSent
      clientNoted += result.clientNoted
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'sweep failed'
      console.log(`[contract-alert] sweep item failed: ${reason.slice(0, 200)}`)
    }
  }
  return { sent, noted, clientSent, clientNoted, checked }
}
