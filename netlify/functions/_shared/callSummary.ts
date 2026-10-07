import { commandClient, commandModel } from './commandParse'
import { env, isDemoMode } from './env'
import { addNote, fubGet, fubGetStrict, getPerson, listPersonNotes } from './followupboss'
import { claimCallSummary, releaseCallSummary } from './callSummaryStore'

/** Calls shorter than this are not summarized. Follow Up Boss itself skips transcripts under 15 seconds. */
export const MIN_CALL_SECONDS = 30
/** Empty and fragmentary transcripts are not sent to the model. */
export const MIN_TRANSCRIPT_CHARS = 80
const LOOKBACK_MS = 24 * 60 * 60 * 1000
const MAX_TRANSCRIPT_CHARS = 20_000

const TRANSCRIPT_KEYS = [
  'transcript',
  'transcription',
  'callTranscript',
  'aiTranscript',
  'transcriptText',
  'transcriptionText',
  'fullTranscript',
  'speechToText',
  'dialogue',
]

export type SummarySections = {
  purpose?: string
  recap?: string[]
  borrower?: string[]
  concerns?: string[]
  commitments?: string[]
  documents?: string[]
  nextSteps?: string[]
  followUps?: string[]
  quotes?: string[]
}

export type SummaryRequest = {
  transcript: string
  agentName?: string
  personName?: string
  whenLabel: string
  durationLabel?: string
  direction?: string
  outcome?: string
}

export type SummarizeCall = (input: SummaryRequest) => Promise<SummarySections | null>

type NoteLike = { subject?: string; body?: string }

export type CallSummaryDeps = {
  now?: Date
  loadCall?: (id: number) => Promise<unknown>
  loadTranscript?: (id: number) => Promise<unknown>
  loadPerson?: (id: number) => Promise<{ name?: string } | null>
  listNotes?: (personId: number) => Promise<NoteLike[]>
  postNote?: (note: { personId: number; subject: string; body: string }) => Promise<void>
  summarize?: SummarizeCall
  listCalls?: () => Promise<unknown[]>
}

export type CallSummarySkip =
  | 'disabled'
  | 'demo'
  | 'ignored'
  | 'no_id'
  | 'no_person'
  | 'short_call'
  | 'no_transcript'
  | 'no_llm'
  | 'duplicate'
  | 'notes_unavailable'
  | 'llm_failed'
  | 'post_failed'

export type LoadedCallResult = {
  skipped?: CallSummarySkip
  posted?: boolean
  callId?: number
  personId?: number
}

export function callSummariesEnabled(): boolean {
  return env('CALL_SUMMARIES_ENABLED', 'false').trim().toLowerCase() === 'true'
}

export function callIdMarker(callId: number): string {
  return `LoanPilot-call-id:${callId}`
}

export function noteMentionsCall(note: NoteLike, callId: number): boolean {
  const marker = callIdMarker(callId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${marker}(?:\\s|$)`).test(`${note.subject ?? ''}\n${note.body ?? ''}`)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function labeledLines(items: unknown[], depth: number): string {
  const lines: string[] = []
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      lines.push(item.trim())
      continue
    }
    const record = asRecord(item)
    if (!record) continue
    const text = stringField(record, ['text', 'content', 'utterance'])
    if (text) {
      const speaker = stringField(record, ['speaker', 'speakerName', 'name'])
      lines.push(speaker ? `${speaker}: ${text}` : text)
      continue
    }
    const nested = transcriptFromValue(item, depth)
    if (nested) lines.push(nested)
  }
  return lines.join('\n')
}

function transcriptFromValue(value: unknown, depth: number): string {
  if (depth > 5 || value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return labeledLines(value, depth + 1)
  const record = asRecord(value)
  if (!record) return ''
  for (const key of TRANSCRIPT_KEYS) {
    if (record[key] != null) {
      const text = transcriptFromValue(record[key], depth + 1)
      if (text) return text
    }
  }
  for (const key of ['segments', 'utterances', 'lines', 'messages']) {
    if (Array.isArray(record[key])) {
      const text = labeledLines(record[key] as unknown[], depth + 1)
      if (text) return text
    }
  }
  return ''
}

/**
 * Pull transcript text off a call or a transcript payload.
 * The call `note` is an agent log, and `summary` is Follow Up Boss's own short writeup.
 * Neither is the transcript.
 */
export function extractTranscript(source: unknown): string {
  if (typeof source === 'string') return source.trim()
  const root = asRecord(source)
  if (!root) return ''
  const record = asRecord(root.call) ?? root
  for (const key of TRANSCRIPT_KEYS) {
    if (record[key] != null) {
      const text = transcriptFromValue(record[key], 0)
      if (text) return text
    }
  }
  for (const key of ['recording', 'callRecording', 'media']) {
    const text = transcriptFromValue(record[key], 0)
    if (text) return text
  }
  const looksLikeCall =
    record.id != null && (record.personId != null || record.duration != null || record.note != null || record.outcome != null)
  if (looksLikeCall) return ''
  const loose = stringField(record, ['text', 'content'])
  if (loose) return loose
  if (Array.isArray(record.segments) || Array.isArray(record.utterances)) {
    return labeledLines((record.segments ?? record.utterances) as unknown[], 0)
  }
  return ''
}

export function transcriptIsUsable(transcript: string): boolean {
  return transcript.trim().length >= MIN_TRANSCRIPT_CHARS
}

function positiveId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function durationSeconds(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function unwrapCall(source: unknown): Record<string, unknown> | null {
  const root = asRecord(source)
  if (!root) return null
  return asRecord(root.call) ?? root
}

export function formatCallStamp(iso: string | undefined, now = new Date()): string {
  const date = iso && Number.isFinite(Date.parse(iso)) ? new Date(iso) : now
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')} ${get('day')}, ${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${rest} sec`
  if (rest === 0) return minutes === 1 ? '1 min' : `${minutes} min`
  return `${minutes} min ${rest} sec`
}

const BORROWER_LABELS: Record<string, string> = {
  income: 'Income',
  employment: 'Employment',
  credit: 'Credit',
  assets: 'Assets',
  downPayment: 'Down payment',
  down_payment: 'Down payment',
  property: 'Property',
  priceRange: 'Price range',
  price: 'Price range',
  location: 'Location',
  timeline: 'Timeline',
  loanType: 'Loan type',
  loan_type: 'Loan type',
  loanProgram: 'Loan program',
  program: 'Loan program',
  rates: 'Rates or payments',
  rate: 'Rates or payments',
  payments: 'Rates or payments',
  lender: 'Current lender',
  currentLender: 'Current lender',
  competitor: 'Competitor',
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap((item) => asStringList(item))
  const record = asRecord(value)
  if (!record) return []
  const lines: string[] = []
  for (const [key, item] of Object.entries(record)) {
    const text = typeof item === 'string' ? item.trim() : Array.isArray(item) ? asStringList(item).join('; ') : ''
    if (!text) continue
    const label = BORROWER_LABELS[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    lines.push(text.toLowerCase().startsWith(label.toLowerCase()) ? text : `${label}: ${text}`)
  }
  return lines
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const body = fenced?.[1]?.trim() || trimmed
  if (!body) return null
  try {
    return asRecord(JSON.parse(body) as unknown)
  } catch {
    return null
  }
}

export function parseSummarySections(raw: unknown): SummarySections | null {
  const record = typeof raw === 'string' ? parseJsonObject(raw) : asRecord(raw)
  if (!record) return null
  const sections: SummarySections = {}
  if (typeof record.purpose === 'string' && record.purpose.trim()) sections.purpose = record.purpose.trim()
  else if (Array.isArray(record.purpose)) {
    const purpose = asStringList(record.purpose).join(' ')
    if (purpose) sections.purpose = purpose
  }
  const keys = ['recap', 'borrower', 'concerns', 'commitments', 'documents', 'nextSteps', 'followUps', 'quotes'] as const
  for (const key of keys) {
    const list = asStringList(record[key])
    if (list.length) sections[key] = list
  }
  return sections
}

export function formatSummaryNote(input: {
  callId: number
  whenLabel: string
  agentName?: string
  personName?: string
  direction?: 'Inbound' | 'Outbound'
  durationLabel?: string
  outcome?: string
  sections: SummarySections
}): { subject: string; body: string } {
  const subject = `LoanPilot Call Summary - ${input.whenLabel}`
  const lines: string[] = []
  if (input.agentName?.trim()) lines.push(`Agent: ${input.agentName.trim()}`)
  if (input.personName?.trim()) lines.push(`Borrower: ${input.personName.trim()}`)
  lines.push(`When: ${input.whenLabel}`)
  if (input.durationLabel) lines.push(`Duration: ${input.durationLabel}`)
  if (input.direction) lines.push(`Direction: ${input.direction}`)
  if (input.outcome?.trim()) lines.push(`Outcome: ${input.outcome.trim()}`)
  const purpose = input.sections.purpose?.trim()
  if (purpose) lines.push('', 'Purpose', purpose)
  const blocks: [string, string[] | undefined][] = [
    ['Recap', input.sections.recap],
    ['Borrower situation', input.sections.borrower],
    ['Concerns and objections', input.sections.concerns],
    ['Commitments and promises', input.sections.commitments],
    ['Documents requested', input.sections.documents],
    ['Next steps', input.sections.nextSteps],
    ['Follow-up recommendations', input.sections.followUps],
    ['Notable quotes', input.sections.quotes],
  ]
  for (const [title, items] of blocks) {
    const rows = (items ?? []).map((item) => item.trim()).filter(Boolean)
    if (!rows.length) continue
    lines.push('', title, ...rows.map((row) => `• ${row}`))
  }
  if (!purpose && blocks.every(([, items]) => !(items ?? []).some((item) => item.trim()))) {
    lines.push('', 'The transcript did not state further mortgage details.')
  }
  lines.push('', callIdMarker(input.callId))
  return { subject, body: lines.join('\n') }
}

const SUMMARY_SYSTEM = `You write an internal mortgage call note from a phone transcript for a loan officer.
Use only facts stated in the transcript. Do not invent income, employment, credit, assets, down payment, property, price, location, timeline, loan program, rates, payments, lenders, names, dates, quotes, or commitments.
Return a JSON object with these keys:
purpose (string),
recap (array of strings, point by point, in the order discussed),
borrower (array of strings; each is one stated fact about income, employment, credit, assets, down payment, property, price range, location, timeline, loan type or program, rates or payments, or the current lender or competitor),
concerns (array of strings; objections and worries actually voiced),
commitments (array of strings; who promised what),
documents (array of strings; documents requested or offered),
nextSteps (array of strings; include the owner and any date that was stated),
followUps (array of strings; recommendations that follow from what was said),
quotes (array of short quotes that were actually spoken).
Use an empty string or an empty array when the transcript does not say it. Do not include a title or a call id.`

function clipTranscript(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript
  return `${transcript.slice(0, 16_000)}\n\n[transcript truncated]\n\n${transcript.slice(-4_000)}`
}

function promptFor(input: SummaryRequest): string {
  const facts = [
    input.agentName ? `Agent: ${input.agentName}` : '',
    input.personName ? `Borrower: ${input.personName}` : '',
    `When: ${input.whenLabel}`,
    input.durationLabel ? `Duration: ${input.durationLabel}` : '',
    input.direction ? `Direction: ${input.direction}` : '',
    input.outcome ? `Outcome: ${input.outcome}` : '',
  ].filter(Boolean)
  return `${facts.join('\n')}\n\nTranscript:\n${clipTranscript(input.transcript)}`
}

async function summarizeWithModel(input: SummaryRequest): Promise<SummarySections | null> {
  const client = commandClient()
  if (!client) return null
  const completion = await client.chat.completions.create({
    model: commandModel(),
    temperature: 0,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: promptFor(input) },
    ],
  })
  const content = completion.choices[0]?.message?.content ?? ''
  const sections = parseSummarySections(content)
  if (!sections) throw new Error('The model returned an empty summary')
  return sections
}

function resourceIds(payload: Record<string, unknown>): number[] {
  if (!Array.isArray(payload.resourceIds)) return []
  return payload.resourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
}

async function defaultLoadCall(id: number): Promise<unknown> {
  return fubGetStrict(`/calls/${id}`)
}

async function defaultLoadTranscript(id: number): Promise<unknown> {
  for (const path of [`/calls/${id}/transcript`, `/calls/${id}/transcription`]) {
    const payload = await fubGet(path)
    if (transcriptIsUsable(extractTranscript(payload))) return payload
  }
  return null
}

async function defaultListNotes(personId: number): Promise<NoteLike[]> {
  return listPersonNotes(personId, 100)
}

async function defaultPostNote(note: { personId: number; subject: string; body: string }): Promise<void> {
  await addNote({ personId: note.personId, subject: note.subject, body: note.body })
}

function callsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  const list = record.calls ?? record.call
  return Array.isArray(list) ? list : []
}

function createdMs(source: unknown): number | null {
  const record = unwrapCall(source)
  const raw = record?.created
  const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

async function defaultListCalls(now: Date): Promise<unknown[]> {
  const cutoff = now.getTime() - LOOKBACK_MS
  const found: unknown[] = []
  for (let page = 0; page < 3; page += 1) {
    const payload = await fubGetStrict(`/calls?limit=100&offset=${page * 100}`)
    const calls = callsOf(payload)
    if (!calls.length) break
    for (const call of calls) found.push(call)
    const stamps = calls.map(createdMs).filter((stamp): stamp is number => stamp != null)
    if (calls.length < 100) break
    if (stamps.length === calls.length && stamps.every((stamp) => stamp < cutoff)) break
  }
  return found
}

function callsInWindow(calls: unknown[], now: Date): unknown[] {
  const cutoff = now.getTime() - LOOKBACK_MS
  const seen = new Set<number>()
  const recent: unknown[] = []
  for (const call of calls) {
    const record = unwrapCall(call)
    const id = positiveId(record?.id)
    const created = createdMs(call)
    if (!id || seen.has(id) || created == null || created < cutoff) continue
    seen.add(id)
    recent.push(call)
  }
  return recent
}

export async function summarizeLoadedCall(source: unknown, deps: CallSummaryDeps = {}): Promise<LoadedCallResult> {
  const record = unwrapCall(source)
  const callId = positiveId(record?.id)
  if (!record || !callId) return { skipped: 'no_id' }
  const personId = positiveId(record.personId)
  if (!personId) return { skipped: 'no_person', callId }
  const duration = durationSeconds(record.duration)
  if (duration != null && duration < MIN_CALL_SECONDS) return { skipped: 'short_call', callId, personId }

  let transcript = extractTranscript(record)
  if (!transcriptIsUsable(transcript)) {
    const extra = await (deps.loadTranscript ?? defaultLoadTranscript)(callId)
    const nested = extractTranscript(extra)
    if (transcriptIsUsable(nested)) transcript = nested
  }
  if (!transcriptIsUsable(transcript)) return { skipped: 'no_transcript', callId, personId }

  const summarize = deps.summarize ?? summarizeWithModel
  if (!deps.summarize && !commandClient()) return { skipped: 'no_llm', callId, personId }

  const now = deps.now ?? new Date()
  const claimed = await claimCallSummary(callId, now.toISOString())
  if (!claimed) return { skipped: 'duplicate', callId, personId }

  const listNotes = deps.listNotes ?? defaultListNotes
  let notes: NoteLike[]
  try {
    notes = await listNotes(personId)
  } catch {
    return { skipped: 'notes_unavailable', callId, personId }
  }
  if (notes.some((note) => noteMentionsCall(note, callId))) return { skipped: 'duplicate', callId, personId }

  let personName = typeof record.personName === 'string' ? record.personName.trim() : ''
  if (!personName) {
    try {
      const person = await (deps.loadPerson ?? ((id: number) => getPerson(id)))(personId)
      personName = person?.name?.trim() ?? ''
    } catch {
      personName = ''
    }
  }

  const whenLabel = formatCallStamp(typeof record.created === 'string' ? record.created : undefined, now)
  const direction = record.isIncoming === true ? 'Inbound' : record.isIncoming === false ? 'Outbound' : undefined
  const outcome = typeof record.outcome === 'string' ? record.outcome.trim() : ''
  const agentName = typeof record.userName === 'string' ? record.userName.trim() : ''
  const durationLabel = duration != null ? formatDuration(duration) : undefined
  const request: SummaryRequest = {
    transcript,
    agentName: agentName || undefined,
    personName: personName || undefined,
    whenLabel,
    durationLabel,
    direction,
    outcome: outcome || undefined,
  }

  let sections: SummarySections | null
  try {
    sections = await summarize(request)
  } catch (err) {
    await releaseCallSummary(callId)
    const message = err instanceof Error && err.message ? err.message : 'summary failed'
    console.log(`[call-summary] call ${callId} llm failed: ${message.slice(0, 200)}`)
    return { skipped: 'llm_failed', callId, personId }
  }
  if (!sections) {
    await releaseCallSummary(callId)
    return { skipped: 'no_llm', callId, personId }
  }

  const note = formatSummaryNote({
    callId,
    whenLabel,
    agentName: agentName || undefined,
    personName: personName || undefined,
    direction,
    durationLabel,
    outcome: outcome || undefined,
    sections,
  })
  try {
    await (deps.postNote ?? defaultPostNote)({ personId, subject: note.subject, body: note.body })
  } catch (err) {
    await releaseCallSummary(callId)
    const message = err instanceof Error && err.message ? err.message : 'note failed'
    console.log(`[call-summary] call ${callId} note failed: ${message.slice(0, 200)}`)
    return { skipped: 'post_failed', callId, personId }
  }
  console.log(`[call-summary] posted note for call ${callId} person ${personId}`)
  return { posted: true, callId, personId }
}

/** Follow Up Boss callsCreated and callsUpdated. Resource ids are loaded from the API. */
export async function handleFubCallSummaryWebhook(payload: unknown, deps: CallSummaryDeps = {}): Promise<{
  skipped?: CallSummarySkip
  posted: number
  checked: number
}> {
  if (!callSummariesEnabled()) return { skipped: 'disabled', posted: 0, checked: 0 }
  if (!deps.loadCall && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', posted: 0, checked: 0 }
  }
  const body = asRecord(payload)
  if (!body) return { skipped: 'ignored', posted: 0, checked: 0 }
  const eventName = typeof body.event === 'string' ? body.event : ''
  if (eventName && !/^calls(Created|Updated)$/i.test(eventName)) return { skipped: 'ignored', posted: 0, checked: 0 }
  const ids = resourceIds(body)
  const load = deps.loadCall ?? defaultLoadCall
  let posted = 0
  for (const id of ids) {
    try {
      const record = unwrapCall(await load(id)) ?? { id }
      const result = await summarizeLoadedCall(record.id == null ? { ...record, id } : record, deps)
      if (result.posted) posted += 1
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'call load failed'
      console.log(`[call-summary] call ${id} load failed: ${message.slice(0, 200)}`)
    }
  }
  return { posted, checked: ids.length }
}

/** Fallback for a transcript that lands after the webhook. Last 24 hours of calls. */
export async function runCallSummarySweep(deps: CallSummaryDeps = {}): Promise<{
  skipped?: CallSummarySkip
  posted: number
  skippedCalls: number
  checked: number
}> {
  if (!callSummariesEnabled()) return { skipped: 'disabled', posted: 0, skippedCalls: 0, checked: 0 }
  if (!deps.listCalls && (isDemoMode() || !env('FOLLOW_UP_BOSS_API_KEY').trim())) {
    return { skipped: 'demo', posted: 0, skippedCalls: 0, checked: 0 }
  }
  const now = deps.now ?? new Date()
  const calls = callsInWindow(await (deps.listCalls ?? (() => defaultListCalls(now)))(), now)
  let posted = 0
  let skippedCalls = 0
  for (const call of calls) {
    try {
      const result = await summarizeLoadedCall(call, { ...deps, now })
      if (result.posted) posted += 1
      else skippedCalls += 1
    } catch (err) {
      skippedCalls += 1
      const message = err instanceof Error && err.message ? err.message : 'sweep failed'
      console.log(`[call-summary] sweep item failed: ${message.slice(0, 200)}`)
    }
  }
  return { posted, skippedCalls, checked: calls.length }
}
