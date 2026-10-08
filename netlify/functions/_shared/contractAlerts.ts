import { claimContractAlert, releaseContractAlert } from './contractAlertStore'
import { env, isDemoMode } from './env'
import { addNote, fubGetStrict } from './followupboss'
import { escapeHtml, normalizePhone, personLink } from './loaReminders'
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

export type ContractAlertDeps = {
  now?: Date
  loadDeal?: (id: number) => Promise<unknown>
  listDeals?: () => Promise<unknown[]>
  sendSms?: (input: { to: string; content: string }) => Promise<{ id: string } | { skipped: 'not_configured' }>
  postNote?: (note: ContractNote) => Promise<void>
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
  const person = peopleOf(record.people)
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
    `LoanPilot: Contract is in! ${lead} moved to Buyer Contract (Purchase).`,
    `Deal: ${deal}.`,
  ]
  if (input.priceLabel?.trim()) parts.push(`Price: ${input.priceLabel.trim()}.`)
  if (input.address?.trim()) parts.push(`Address: ${input.address.trim()}.`)
  if (input.agentName?.trim()) parts.push(`Agent: ${input.agentName.trim()}.`)
  if (input.personId) parts.push(`FUB: ${personLink(input.personId)}`)
  return parts.join(' ')
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

export async function notifyBuyerContract(
  source: unknown,
  deps: ContractAlertDeps = {},
): Promise<{ skipped?: ContractSkip; sent: number; noted: number; dealId?: number }> {
  const deal = parseDeal(source)
  if (!deal) return { skipped: 'ignored', sent: 0, noted: 0 }
  if (!isBuyerContract(deal)) return { skipped: 'not_buyer_contract', sent: 0, noted: 0, dealId: deal.id }
  const now = deps.now ?? new Date()
  if (!deal.enteredStageAt || !entryIsRecent(deal.enteredStageAt, now)) {
    return { skipped: 'stale', sent: 0, noted: 0, dealId: deal.id }
  }

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
  const send = deps.sendSms ?? sendSmsIfConfigured
  const postNote = deps.postNote ?? (async (note: ContractNote) => {
    await addNote(note)
  })

  let sent = 0
  const smsKey = `sms/${deal.id}/${token}`
  if (await claimContractAlert(smsKey, at)) {
    let failed = false
    for (const phone of contractAlertPhones()) {
      try {
        const result = await send({ to: phone, content: message })
        if (!('skipped' in result)) sent += 1
      } catch (err) {
        failed = true
        const reason = err instanceof Error && err.message ? err.message : 'sms failed'
        console.log(`[contract-alert] deal ${deal.id} sms failed: ${reason.slice(0, 200)}`)
      }
    }
    if (sent === 0) await releaseContractAlert(smsKey)
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

  if (sent > 0 || noted > 0) console.log(`[contract-alert] deal ${deal.id} person ${deal.personId ?? 0} sent=${sent} noted=${noted}`)
  if (sent === 0 && noted === 0) return { skipped: 'duplicate', sent: 0, noted: 0, dealId: deal.id }
  return { sent, noted, dealId: deal.id }
}

/** Follow Up Boss dealsCreated and dealsUpdated. Resource ids are loaded with GET /v1/deals/:id. */
export async function handleFubContractWebhook(
  payload: unknown,
  deps: ContractAlertDeps = {},
): Promise<{ skipped?: ContractSkip; sent: number; noted: number; checked: number }> {
  if (!contractAlertsEnabled()) return { skipped: 'disabled', sent: 0, noted: 0, checked: 0 }
  if (!deps.loadDeal && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', sent: 0, noted: 0, checked: 0 }
  }
  const body = asRecord(payload)
  if (!body) return { skipped: 'ignored', sent: 0, noted: 0, checked: 0 }
  const eventName = typeof body.event === 'string' ? body.event : ''
  if (eventName && !/^deals(Created|Updated)$/i.test(eventName)) return { skipped: 'ignored', sent: 0, noted: 0, checked: 0 }
  const ids = resourceIds(body)
  const load = deps.loadDeal ?? defaultLoadDeal
  let sent = 0
  let noted = 0
  for (const id of ids) {
    try {
      const result = await notifyBuyerContract(await load(id), deps)
      sent += result.sent
      noted += result.noted
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'deal load failed'
      console.log(`[contract-alert] deal ${id} load failed: ${reason.slice(0, 200)}`)
    }
  }
  return { sent, noted, checked: ids.length }
}

/** Fallback for a Buyer Contract entry the webhook missed. Last 24 hours, Purchase pipeline only. */
export async function runContractAlertSweep(
  deps: ContractAlertDeps = {},
): Promise<{ skipped?: ContractSkip; sent: number; noted: number; checked: number }> {
  if (!contractAlertsEnabled()) return { skipped: 'disabled', sent: 0, noted: 0, checked: 0 }
  if (!deps.listDeals && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', sent: 0, noted: 0, checked: 0 }
  }
  const now = deps.now ?? new Date()
  const deals = await (deps.listDeals ?? defaultListDeals)()
  let sent = 0
  let noted = 0
  let checked = 0
  for (const deal of deals) {
    const parsed = parseDeal(deal)
    if (!parsed || !isBuyerContract(parsed) || !entryIsRecent(parsed.enteredStageAt, now)) continue
    checked += 1
    try {
      const result = await notifyBuyerContract(deal, { ...deps, now })
      sent += result.sent
      noted += result.noted
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'sweep failed'
      console.log(`[contract-alert] sweep item failed: ${reason.slice(0, 200)}`)
    }
  }
  return { sent, noted, checked }
}
