import { env, isDemoMode } from './env'
import {
  addNote,
  fubGet,
  listPersonCollaborators,
  listPersonDeals,
  listPipelineStages,
  moveDealStage,
  rememberLoanNumber,
  type FubDeal,
  type FubStage,
} from './followupboss'
import { gmailCanRead, loadGoogleTokens, resolveGoogleAccessToken } from './googleAuth'
import {
  addIceReview,
  claimIce,
  listIceReviews,
  loanPersonId,
  releaseIce,
  saveIceRun,
  saveLoanPerson,
  type IceReview,
} from './iceStatusStore'

/** 7:30 PM America/New_York on 2026-11-09. Mail older than this is ignored. */
export const ICE_CUTOFF_MS = Date.parse('2026-11-09T19:30:00-05:00')
export const ICE_QUERY = 'from:jcordeira@cliffcomortgage.com "noreply-MortgageTech@ice.com" after:2026/11/09'
const PURCHASE_PIPELINE = 1
const STAGE_CONDITIONAL = 24
const STAGE_CLEAR = 25
const STAGE_CLOSED = 129
const LOAN_RE = /1102609CMB\d+/i
const IGNORED_EMAILS = new Set([
  'noreply-mortgagetech@ice.com',
  'jcordeira@cliffcomortgage.com',
  'joseph@teamcordeira.com',
])

export function iceStatusEnabled(): boolean {
  const raw = env('ICE_STATUS_ENABLED', 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

export type IceEventKind = {
  action: 'note' | 'skip' | 'unknown'
  type: string
  label: string
  stageId?: number
}

const SKIP_RULES: { type: string; pattern: RegExp }[] = [
  { type: 'econsent', pattern: /\be-?consent\b/i },
  { type: 'doc-retrieved', pattern: /efolder doc retrieved|doc(?:ument)? retrieved/i },
  { type: 'doc-request-viewed', pattern: /doc(?:ument)? request viewed|package not viewed/i },
  { type: 'doc-received', pattern: /\bdoc(?:ument)? received\b/i },
  { type: 'password-reset', pattern: /password reset/i },
]

const NOTE_RULES: { type: string; label: string; pattern: RegExp; stageId?: number }[] = [
  { type: 'appraisal-scheduled', label: 'Appraisal scheduled', pattern: /appraisal scheduled/i },
  { type: 'anl-sent', label: 'ANL sent', pattern: /\banl sent\b/i },
  { type: 'commitment-letter', label: 'Commitment letter', pattern: /commitment letter/i, stageId: STAGE_CONDITIONAL },
  { type: 'uw-approved', label: 'UW approved', pattern: /\buw approved\b|underwriting approved/i, stageId: STAGE_CONDITIONAL },
  { type: 'clear-to-close', label: 'Clear to close', pattern: /clear to close/i, stageId: STAGE_CLEAR },
  { type: 'funded', label: 'Funded', pattern: /\bfunded\b/i, stageId: STAGE_CLOSED },
  { type: 'closed', label: 'Closed', pattern: /\bclosed\b/i, stageId: STAGE_CLOSED },
]

export function classifyIceEvent(text: string): IceEventKind {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value) return { action: 'unknown', type: 'unknown', label: '' }
  for (const rule of SKIP_RULES) {
    if (rule.pattern.test(value)) return { action: 'skip', type: rule.type, label: value }
  }
  for (const rule of NOTE_RULES) {
    if (rule.pattern.test(value)) return { action: 'note', type: rule.type, label: rule.label, stageId: rule.stageId }
  }
  return { action: 'note', type: `status:${slug(value)}`, label: value.slice(0, 80) }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'status'
}

export function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[|].*$/, '').trim()
}

function displayName(value: string): string {
  const cleaned = cleanLine(value)
  const comma = cleaned.match(/^([^,]+),\s*([A-Za-z].+)$/)
  if (!comma?.[1] || !comma[2] || comma[2].includes(',')) return cleaned
  return `${comma[2]} ${comma[1]}`.replace(/\s+/g, ' ').trim()
}

function decodeBody(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n\r/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function lineValue(text: string, label: RegExp): string | undefined {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${label.source})\\s*[:\\-]\\s*([^\\n]+)`, 'i'))
  const value = match?.[1] ? cleanLine(match[1]) : ''
  return value || undefined
}

export type ParsedIce = {
  borrower: string
  loan: string
  eventText: string
  email?: string
  detail?: string
}

export type ParseIceResult = { ok: true; ice: ParsedIce } | { ok: false; reason: string }

/** Pull a Cliffco CMB loan from a forwarded ICE message. Non-CMB mail is ignored. */
export function parseIceStatus(subject: string, body: string): ParseIceResult {
  const text = decodeBody(`${subject}\n${body}`)
  if (!/noreply-mortgagetech@ice\.com/i.test(text)) return { ok: false, reason: 'not an ICE forward' }
  const loan = text.match(LOAN_RE)?.[0]?.toUpperCase()
  if (!loan) return { ok: false, reason: 'no CMB loan number' }
  const labeledName = lineValue(text, /(?:primary\s+)?borrower(?:'s)?(?:\s+name)?|applicant(?:\s+name)?/)
  const inlineName = text.match(new RegExp(`${loan}\\s+for\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+)+)`, 'i'))?.[1]
  const borrower = displayName(labeledName || inlineName || '')
  if (!borrower || borrower.length < 3) return { ok: false, reason: 'no borrower name' }
  const labeledEvent = lineValue(text, /milestone|loan status|status|event/)
  const known = NOTE_RULES.find((rule) => rule.pattern.test(text)) ?? SKIP_RULES.find((rule) => rule.pattern.test(text))
  const eventText = labeledEvent || known?.type.replace(/-/g, ' ') || ''
  if (!eventText) return { ok: false, reason: 'no milestone' }
  const email = lineValue(text, /borrower(?:'s)?\s+e-?mail|e-?mail address|e-?mail/)?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
  const detail = lineValue(text, /scheduled(?:\s+date|\s+for)?|closing date|fund(?:ing)? date|date/)
  return {
    ok: true,
    ice: {
      borrower,
      loan,
      eventText,
      email: email && !IGNORED_EMAILS.has(email) ? email : undefined,
      detail,
    },
  }
}

type Person = { id: number; name?: string }

export type IceMatch = {
  person: Person | null
  reason: string
  candidates: { id: number; name: string }[]
}

export async function matchIceBorrower(
  ice: ParsedIce,
  deps: {
    loanOf: (loan: string) => Promise<number | null>
    search: (query: string) => Promise<Person[]>
    personName: (id: number) => Promise<string | null>
  },
): Promise<IceMatch> {
  const stored = await deps.loanOf(ice.loan)
  if (stored) {
    const name = (await deps.personName(stored)) ?? ''
    return { person: { id: stored, name }, reason: 'loan number', candidates: [] }
  }
  if (ice.email) {
    const people = await deps.search(`email=${encodeURIComponent(ice.email)}`)
    const candidates = people.map((person) => ({ id: person.id, name: person.name ?? '' }))
    if (people.length === 1) {
      const person = people[0]
      if (person && normName(person.name ?? '') === normName(ice.borrower)) {
        return { person, reason: 'email', candidates: [] }
      }
      return { person: null, reason: 'name and email conflict', candidates }
    }
    if (people.length > 1) return { person: null, reason: `several email matches (${people.length})`, candidates }
  }
  const named = (await deps.search(`name=${encodeURIComponent(ice.borrower)}`)).filter((person) => normName(person.name ?? '') === normName(ice.borrower))
  if (named.length === 1 && named[0]) return { person: named[0], reason: 'exact name', candidates: [] }
  if (named.length > 1) {
    return {
      person: null,
      reason: `several name matches (${named.length})`,
      candidates: named.map((person) => ({ id: person.id, name: person.name ?? '' })),
    }
  }
  return { person: null, reason: 'no match', candidates: [] }
}

export function stageOrder(stages: FubStage[]): FubStage[] {
  const weighted = stages.length > 0 && stages.every((stage) => typeof stage.orderWeight === 'number')
  return weighted ? [...stages].sort((a, b) => (a.orderWeight ?? 0) - (b.orderWeight ?? 0)) : stages
}

export function forwardStage(currentId: number, targetId: number, stages: FubStage[]): 'move' | 'hold' | 'unknown' {
  const ordered = stageOrder(stages)
  const current = ordered.findIndex((stage) => stage.id === currentId)
  const target = ordered.findIndex((stage) => stage.id === targetId)
  if (current < 0 || target < 0) return 'unknown'
  if (target > current) return 'move'
  return 'hold'
}

export type IceRunSummary = {
  ok: true
  enabled: boolean
  skippedRun?: 'disabled' | 'demo' | 'scope'
  considered: number
  posted: number
  stageMoved: number
  needsReview: number
  duplicates: number
  skipped: number
  ignored: number
  failures: string[]
  notes: { personId: number; name: string; event: string; loan: string }[]
  stages: { personId: number; dealId: number; fromStageId: number; toStageId: number; event: string }[]
  reviews: { borrower: string; loan: string; event: string; reason: string }[]
}

type GmailMessage = { id: string; payload?: GmailPart }

function joeUserId(): number {
  const id = Number(env('FUB_LO_USER_ID', '1'))
  return Number.isInteger(id) && id > 0 ? id : 1
}

function mentionNote(text: string, collaborators: { id: number; name: string }[]): { body: string; mentionUserIds: number[] } {
  const mention = collaborators.filter((person) => person.id !== joeUserId())
  if (!mention.length) return { body: text, mentionUserIds: [] }
  const spans = mention.map((person) => `<span data-user-id="${person.id}">${person.name.replace(/[&<>]/g, '')}</span>`).join(' ')
  return { body: `${spans} ${text}`, mentionUserIds: mention.map((person) => person.id) }
}

export async function runIceStatus(options?: {
  now?: Date
  list?: (query: string) => Promise<{ id: string; internalDate: number }[]>
  read?: (id: string) => Promise<{ subject: string; body: string }>
  search?: (query: string) => Promise<Person[]>
  personName?: (id: number) => Promise<string | null>
  collaborators?: (personId: number) => Promise<{ id: number; name: string }[]>
  note?: (input: { personId: number; subject: string; body: string; mentionUserIds: number[] }) => Promise<void>
  deals?: (personId: number) => Promise<FubDeal[]>
  stages?: () => Promise<FubStage[]>
  move?: (dealId: number, stageId: number) => Promise<void>
  remember?: (personId: number, loan: string) => Promise<void>
}): Promise<IceRunSummary> {
  const summary: IceRunSummary = {
    ok: true,
    enabled: iceStatusEnabled(),
    considered: 0,
    posted: 0,
    stageMoved: 0,
    needsReview: 0,
    duplicates: 0,
    skipped: 0,
    ignored: 0,
    failures: [],
    notes: [],
    stages: [],
    reviews: [],
  }
  if (!summary.enabled) {
    summary.skippedRun = 'disabled'
    await saveIceRun(summary)
    return summary
  }
  if (!options?.list && isDemoMode()) {
    summary.skippedRun = 'demo'
    await saveIceRun(summary)
    return summary
  }
  const list = options?.list ?? listGmail
  const read = options?.read ?? readGmailText
  const search = options?.search ?? defaultSearch
  const personName = options?.personName ?? defaultPersonName
  const collaborators = options?.collaborators ?? listPersonCollaborators
  const note = options?.note ?? (async (input) => {
    await addNote({ ...input, isHtml: input.mentionUserIds.length > 0 })
  })
  const deals = options?.deals ?? listPersonDeals
  const stages = options?.stages ?? (() => listPipelineStages(PURCHASE_PIPELINE))
  const move = options?.move ?? moveDealStage
  const remember = options?.remember ?? (async (personId: number, loan: string) => {
    await saveLoanPerson(loan, personId)
    await rememberLoanNumber(personId, loan)
  })

  let messages: { id: string; internalDate: number }[]
  try {
    messages = await list(ICE_QUERY)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'gmail list failed'
    if (/scope missing|not connected/i.test(reason)) summary.skippedRun = 'scope'
    summary.failures.push(reason)
    await saveIceRun(summary)
    return summary
  }

  let stageList: FubStage[] | null = null
  for (const item of messages) {
    if (item.internalDate < ICE_CUTOFF_MS) continue
    const messageKey = `msg/${item.id}`
    if (!(await claimIce(messageKey))) {
      summary.duplicates += 1
      continue
    }
    summary.considered += 1
    let subject = ''
    let body = ''
    try {
      const message = await read(item.id)
      subject = message.subject
      body = message.body
    } catch (err) {
      await releaseIce(messageKey)
      summary.failures.push(err instanceof Error ? err.message : 'gmail read failed')
      continue
    }
    const parsed = parseIceStatus(subject, body)
    if (!parsed.ok) {
      summary.ignored += 1
      continue
    }
    const kind = classifyIceEvent(parsed.ice.eventText)
    if (kind.action === 'skip') {
      summary.skipped += 1
      continue
    }
    if (kind.action !== 'note' || !kind.type) {
      summary.skipped += 1
      continue
    }
    const eventKey = `event/${parsed.ice.loan}/${kind.type}`
    if (!(await claimIce(eventKey))) {
      summary.duplicates += 1
      continue
    }
    const match = await matchIceBorrower(parsed.ice, { loanOf: loanPersonId, search, personName })
    if (!match.person) {
      await rememberReview(summary, parsed.ice, kind.label, match.reason, match.candidates)
      continue
    }
    const person = match.person
    try {
      await remember(person.id, parsed.ice.loan)
      const sentence = `${kind.label} for ${parsed.ice.borrower}, loan ${parsed.ice.loan}${parsed.ice.detail ? `. ${parsed.ice.detail}` : ''}.`
      const mentioned = mentionNote(sentence, await collaborators(person.id))
      await note({ personId: person.id, subject: `ICE ${kind.label}`, body: mentioned.body, mentionUserIds: mentioned.mentionUserIds })
      summary.posted += 1
      summary.notes.push({ personId: person.id, name: parsed.ice.borrower, event: kind.label, loan: parsed.ice.loan })
    } catch (err) {
      await releaseIce(messageKey)
      await releaseIce(eventKey)
      summary.failures.push(err instanceof Error ? err.message : 'note failed')
      continue
    }
    if (!kind.stageId) continue
    try {
      if (!stageList) stageList = await stages()
      const result = await advanceDeal(person.id, kind.stageId, stageList, deals, move)
      if (result.moved) {
        summary.stageMoved += 1
        summary.stages.push({ personId: person.id, dealId: result.dealId, fromStageId: result.fromStageId, toStageId: kind.stageId, event: kind.label })
      } else if (result.review) {
        await rememberReview(summary, parsed.ice, kind.label, result.review, [])
      }
    } catch (err) {
      await rememberReview(summary, parsed.ice, kind.label, err instanceof Error ? err.message : 'stage move failed', [])
    }
  }
  await saveIceRun(summary)
  console.log(`[ice-status] ${JSON.stringify({ ...summary, failures: summary.failures.slice(0, 5), notes: summary.notes.slice(0, 10) })}`)
  return summary
}

async function rememberReview(
  summary: IceRunSummary,
  ice: ParsedIce,
  event: string,
  reason: string,
  candidates: { id: number; name: string }[],
): Promise<void> {
  const review: IceReview = {
    id: `${ice.loan}:${event}:${reason}`,
    at: new Date().toISOString(),
    borrower: ice.borrower,
    loan: ice.loan,
    event,
    reason,
    candidates,
  }
  await addIceReview(review)
  summary.needsReview += 1
  summary.reviews.push({ borrower: ice.borrower, loan: ice.loan, event, reason })
}

async function advanceDeal(
  personId: number,
  targetId: number,
  stages: FubStage[],
  deals: (personId: number) => Promise<FubDeal[]>,
  move: (dealId: number, stageId: number) => Promise<void>,
): Promise<{ moved: true; dealId: number; fromStageId: number } | { moved: false; review?: string }> {
  const all = (await deals(personId)).filter((deal) => deal.pipelineId === PURCHASE_PIPELINE && deal.status !== 'Archived' && deal.status !== 'Deleted')
  const open = all.filter((deal) => deal.stageId !== STAGE_CLOSED)
  const chosen = open.length === 1 ? open[0] : open.length === 0 && all.length === 1 ? all[0] : null
  if (!chosen) {
    if (open.length === 0 && all.length === 0) return { moved: false, review: 'no Purchase deal' }
    if (open.length > 1) return { moved: false, review: `multiple open Purchase deals (${open.length})` }
    return { moved: false }
  }
  const decision = forwardStage(chosen.stageId, targetId, stages)
  if (decision === 'hold') return { moved: false }
  if (decision === 'unknown') return { moved: false, review: `stage ${chosen.stageId} is not on the Purchase pipeline` }
  await move(chosen.id, targetId)
  return { moved: true, dealId: chosen.id, fromStageId: chosen.stageId }
}

async function defaultSearch(query: string): Promise<Person[]> {
  const data = (await fubGet(`/people?${query}&limit=10&fields=id,name,emails`)) as { people?: Person[] } | null
  return data?.people ?? []
}

async function defaultPersonName(id: number): Promise<string | null> {
  const data = (await fubGet(`/people/${id}?fields=id,name`)) as { name?: string; person?: { name?: string } } | null
  return data?.person?.name ?? data?.name ?? null
}

export async function loadHubIceReviews(): Promise<IceReview[]> {
  try {
    return await listIceReviews()
  } catch {
    return []
  }
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }

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
  for (let page = 0; page < 4 && found.length < 100; page += 1) {
    const params = new URLSearchParams({ q: query, maxResults: '25' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = (await gmailFetch(`messages?${params}`)) as { messages?: { id: string }[]; nextPageToken?: string }
    let older = false
    for (const message of data.messages ?? []) {
      const meta = (await gmailFetch(`messages/${message.id}?format=minimal`)) as { id: string; internalDate?: string }
      const internalDate = Number(meta.internalDate ?? 0)
      if (internalDate < ICE_CUTOFF_MS) {
        older = true
        break
      }
      found.push({ id: meta.id, internalDate })
    }
    if (older || !data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return found
}

function partText(part: GmailPart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeRaw(part.body.data)
  for (const child of part.parts ?? []) {
    const text = partText(child)
    if (text) return text
  }
  if (part.mimeType === 'text/html' && part.body?.data) return decodeRaw(part.body.data)
  return part.body?.data ? decodeRaw(part.body.data) : ''
}

function decodeRaw(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf8')
}

async function readGmailText(id: string): Promise<{ subject: string; body: string }> {
  const message = (await gmailFetch(`messages/${id}?format=full`)) as GmailMessage
  const headers = message.payload?.headers ?? []
  const subject = headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? ''
  return { subject, body: partText(message.payload) }
}
