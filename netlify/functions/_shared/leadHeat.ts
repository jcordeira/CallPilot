import { isDemoMode } from './env'
import {
  addNote,
  createTask,
  fubGet,
  getNote,
  getPerson,
  listPeople,
  listRecentEvents,
  personLooksLikeLead,
  setLoanPilotScore,
  type FubEvent,
  type FubPerson,
} from './followupboss'
import { loadScoredLeads, rememberScoredLead } from './hubExtras'
import type { ScoredLead } from './hubTypes'
import { bandLabel, scoreLead, type LeadScoreResult, type LeadSignals } from './leadScore'
import { escalationPlan, followUpPlan, type FollowUpPlan } from './team'

const QUIET_MS = 20 * 60 * 60 * 1000

type Fixture = {
  personId: number
  name: string
  stage: string
  text: string
  inboundHoursAgo?: number
  contactDaysAgo?: number
  appointmentRequested?: boolean
}

const DEMO_FIXTURES: Fixture[] = [
  {
    personId: 1001,
    name: 'Alex Buyer',
    stage: 'Lead',
    text: 'Docs are ready and we are ready to buy. Can you send the pre-approval?',
    inboundHoursAgo: 2,
  },
  {
    personId: 1002,
    name: 'Jordan Hale',
    stage: 'Lead',
    text: 'Thinking about refinance rates this week.',
    inboundHoursAgo: 36,
  },
  {
    personId: 1003,
    name: 'Sam Rivera',
    stage: 'Nurture',
    text: 'Still thinking about a refinance later this year.',
    inboundHoursAgo: 24 * 5,
    contactDaysAgo: 5,
  },
  {
    personId: 1004,
    name: 'Pat Nguyen',
    stage: 'Lead',
    text: 'Thanks for the info a while back.',
    contactDaysAgo: 40,
  },
]

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString()
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

export function signalsForFixture(fixture: Fixture, now: Date): LeadSignals {
  return {
    stage: fixture.stage,
    recentText: fixture.text,
    lastInboundAt: fixture.inboundHoursAgo != null ? hoursAgo(now, fixture.inboundHoursAgo) : null,
    lastContactAt: fixture.contactDaysAgo != null ? daysAgo(now, fixture.contactDaysAgo) : null,
    appointmentRequested: fixture.appointmentRequested,
    now,
  }
}

function toScoredLead(
  personId: number,
  name: string,
  result: LeadScoreResult,
  plan: FollowUpPlan | null,
  now: Date,
  stage?: string,
  taskId?: number,
): ScoredLead {
  return {
    personId,
    name,
    score: result.score,
    band: result.band === 'excluded' ? 'cold' : result.band,
    reasons: result.reasons,
    assignee: plan?.assigneeName,
    assigneeRole: plan?.assigneeRole,
    taskType: plan?.taskType,
    due: plan?.dueDate,
    taskId,
    stage,
    scoredAt: now.toISOString(),
  }
}

/** Sample heat board when Follow Up Boss is not connected. Does not write tasks. */
export function demoLeadBoard(now = new Date()): ScoredLead[] {
  return DEMO_FIXTURES.map((fixture) => {
    const result = scoreLead(signalsForFixture(fixture, now))
    const plan = followUpPlan(result, fixture.name, now)
    return toScoredLead(fixture.personId, fixture.name, result, plan, now, fixture.stage)
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export function shouldRewriteScore(
  previous: { score: number; band: string; scoredAt: string } | undefined,
  next: { score: number; band: string },
  now: Date,
  escalate = false,
): boolean {
  if (escalate || !previous) return true
  if (previous.score !== next.score || previous.band !== next.band) return true
  const age = now.getTime() - new Date(previous.scoredAt).getTime()
  return !(age >= 0 && age < QUIET_MS)
}

export function scoreNote(personName: string, result: LeadScoreResult, plan: FollowUpPlan | null): { subject: string; body: string } {
  const label = bandLabel(result.band)
  const next = plan
    ? `Next: ${plan.taskType} for ${plan.assigneeName} (${plan.assigneeTitle}) due ${plan.dueDate}.`
    : 'No urgent task. Leave a note and wait for the next inbound.'
  return {
    subject: `LoanPilot — lead heat ${result.score} (${label})`,
    body: [
      `${personName}: ${result.score}/100 — ${label}.`,
      next,
      'Why:',
      ...result.reasons.map((reason) => `• ${reason}`),
    ].join('\n'),
  }
}

export function signalsFromFub(person: FubPerson, events: FubEvent[], now = new Date()): LeadSignals {
  const inbound = events.filter((event) => /inquir|incoming|email|text|sms|call/i.test(`${event.type ?? ''} ${event.message ?? ''}`))
  const latestInbound = inbound
    .map((event) => event.created)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  const text = [person.background, ...events.map((event) => event.message || event.description)].filter(Boolean).join('\n')
  const appointmentRequested = events.some((event) => /appoint|showing/i.test(event.type ?? ''))
  return {
    stage: person.stage,
    tags: person.tags,
    recentText: text,
    lastInboundAt: latestInbound ?? null,
    lastContactAt: person.lastActivity ?? person.updated ?? null,
    appointmentRequested,
    now,
  }
}

function isOpenLead(person: FubPerson): boolean {
  if (personLooksLikeLead(person) === false) return false
  return !/trash|archived/.test((person.stage ?? '').toLowerCase())
}

export async function publishLeadScore(input: {
  personId: number
  personName: string
  result: LeadScoreResult
  stage?: string
  createTask?: boolean
  taskName?: string
  taskType?: string
  escalate?: boolean
  now?: Date
}): Promise<ScoredLead | null> {
  if (!input.personId || input.result.excluded) return null
  const now = input.now ?? new Date()
  const personName = input.personName.trim() || 'Lead'
  const plan = input.escalate ? escalationPlan(personName, now) : followUpPlan(input.result, personName, now)
  const previous = (await loadScoredLeads()).find((lead) => lead.personId === input.personId)

  if (!shouldRewriteScore(previous, input.result, now, input.escalate)) {
    return previous ?? null
  }

  let taskId = previous?.taskId
  let due = plan?.dueDate
  let assignee = plan?.assigneeName
  let assigneeRole = plan?.assigneeRole
  let taskType = input.taskType ?? plan?.taskType
  const bandChanged = !previous || previous.band !== input.result.band
  const taskStale =
    !previous?.scoredAt || now.getTime() - new Date(previous.scoredAt).getTime() >= QUIET_MS || !previous.taskId
  const wantsTask = (input.createTask ?? true) && plan
  if (wantsTask && plan && (bandChanged || taskStale || input.escalate)) {
    const created = await createTask({
      personId: input.personId,
      personName,
      name: input.taskName ?? plan.taskName,
      type: input.taskType ?? plan.taskType,
      dueDate: plan.dueDate,
      assignedTo: plan.assigneeName,
      assignedUserId: plan.assignedUserId,
    })
    taskId = created.id
    due = plan.dueDate
    assignee = plan.assigneeName
    assigneeRole = plan.assigneeRole
    taskType = input.taskType ?? plan.taskType
  } else if (previous && !bandChanged) {
    due = previous.due ?? due
    assignee = previous.assignee ?? assignee
    assigneeRole = previous.assigneeRole ?? assigneeRole
    taskType = previous.taskType ?? taskType
  }

  const note = scoreNote(personName, input.result, plan)
  await addNote({ personId: input.personId, subject: note.subject, body: note.body })
  await setLoanPilotScore(input.personId, input.result.score)

  const lead = toScoredLead(input.personId, personName, input.result, plan, now, input.stage, taskId)
  if (!plan && previous && !bandChanged) {
    lead.due = due
    lead.assignee = assignee
    lead.assigneeRole = assigneeRole
    lead.taskType = taskType
  } else if (input.taskType && plan) {
    lead.taskType = taskType
  }
  lead.due = due
  lead.assignee = assignee
  lead.assigneeRole = assigneeRole
  lead.taskId = taskId
  await rememberScoredLead(lead)
  return lead
}

async function scoreFixture(fixture: Fixture, now: Date, createTask: boolean): Promise<ScoredLead | null> {
  const result = scoreLead(signalsForFixture(fixture, now))
  return publishLeadScore({
    personId: fixture.personId,
    personName: fixture.name,
    result,
    stage: fixture.stage,
    createTask,
    now,
  })
}

export async function rescoreOpenLeads(now = new Date()): Promise<ScoredLead[]> {
  if (isDemoMode()) {
    const leads: ScoredLead[] = []
    for (const fixture of DEMO_FIXTURES) {
      const saved = await scoreFixture(fixture, now, true)
      if (saved) leads.push(saved)
    }
    return leads.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  }

  const people = await listPeople(30)
  const leads: ScoredLead[] = []
  for (const person of people) {
    if (!isOpenLead(person)) continue
    try {
      const events = await listRecentEvents(person.id)
      const result = scoreLead(signalsFromFub(person, events, now))
      const saved = await publishLeadScore({
        personId: person.id,
        personName: person.name,
        result,
        stage: person.stage,
        now,
      })
      if (saved) leads.push(saved)
    } catch {
      /* keep scoring the rest of the list */
    }
  }
  return leads.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export async function listLeadHeat(): Promise<{ leads: ScoredLead[]; demo: boolean }> {
  const stored = await loadScoredLeads()
  if (!isDemoMode()) return { leads: stored, demo: false }
  const merged = new Map<number, ScoredLead>()
  for (const lead of demoLeadBoard()) merged.set(lead.personId, lead)
  for (const lead of stored) merged.set(lead.personId, lead)
  const leads = [...merged.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { leads, demo: true }
}

function collectPersonIds(value: unknown, acc: number[], depth: number) {
  if (!value || typeof value !== 'object' || depth > 4) return
  if (Array.isArray(value)) {
    for (const item of value) collectPersonIds(item, acc, depth + 1)
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.personId === 'number') acc.push(record.personId)
  for (const nested of Object.values(record)) collectPersonIds(nested, acc, depth + 1)
}

async function personIdsFromUri(uri: string): Promise<number[]> {
  if (!uri.includes('followupboss.com')) return []
  const path = uri.replace(/^https?:\/\/api\.followupboss\.com\/v1/i, '')
  if (!path.startsWith('/')) return []
  const data = await fubGet(path)
  const ids: number[] = []
  collectPersonIds(data, ids, 0)
  return [...new Set(ids)]
}

export async function handleFubWebhook(payload: Record<string, unknown>, now = new Date()): Promise<{ skipped?: string; leads: ScoredLead[] }> {
  const event = String(payload.event ?? '')
  if (/^tasks/i.test(event) || /deleted$/i.test(event)) {
    return { skipped: event || 'ignored', leads: [] }
  }

  const inline = payload.person
  if (inline && typeof inline === 'object' && !Array.isArray(inline)) {
    const person = inline as Record<string, unknown>
    const personId = Number(person.id ?? payload.personId ?? 0)
    const name = String(person.name ?? 'Lead')
    const result = scoreLead({
      stage: typeof person.stage === 'string' ? person.stage : undefined,
      tags: Array.isArray(person.tags) ? person.tags.map(String) : undefined,
      recentText: typeof person.text === 'string' ? person.text : undefined,
      lastInboundAt: typeof person.lastInboundAt === 'string' ? person.lastInboundAt : now.toISOString(),
      lastContactAt: typeof person.lastContactAt === 'string' ? person.lastContactAt : now.toISOString(),
      appointmentRequested: person.appointmentRequested === true,
      opsContact: person.opsContact === true,
      now,
    })
    if (!personId || result.excluded) return { leads: [] }
    const saved = await publishLeadScore({
      personId,
      personName: name,
      result,
      stage: typeof person.stage === 'string' ? person.stage : undefined,
      now,
    })
    return { leads: saved ? [saved] : [] }
  }

  const resourceIds = Array.isArray(payload.resourceIds)
    ? payload.resourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : []

  if (/^notes/i.test(event)) {
    const subject = typeof payload.subject === 'string' ? payload.subject : ''
    if (/^LoanPilot/i.test(subject)) return { skipped: 'loanpilot-note', leads: [] }
    if (isDemoMode()) return { skipped: 'demo-note', leads: [] }
    const leads: ScoredLead[] = []
    for (const id of resourceIds) {
      const note = await getNote(id)
      if (!note?.personId || /^LoanPilot/i.test(note.subject ?? '')) continue
      const person = await getPerson(note.personId)
      if (!person) continue
      const result = scoreLead({
        ...signalsFromFub(person, await listRecentEvents(person.id), now),
        recentText: `${note.subject ?? ''}\n${note.body ?? ''}`,
        now,
      })
      const saved = await publishLeadScore({
        personId: person.id,
        personName: person.name,
        result,
        stage: person.stage,
        now,
      })
      if (saved) leads.push(saved)
    }
    return { leads }
  }

  let ids = /^people/i.test(event) || event === '' ? resourceIds : []
  if (!ids.length && typeof payload.uri === 'string') ids = await personIdsFromUri(payload.uri)
  if (!ids.length && /^people/i.test(event)) ids = resourceIds

  if (isDemoMode()) {
    const fixtures = ids.length ? DEMO_FIXTURES.filter((fixture) => ids.includes(fixture.personId)) : DEMO_FIXTURES
    const leads: ScoredLead[] = []
    for (const fixture of fixtures.length ? fixtures : DEMO_FIXTURES) {
      const saved = await scoreFixture(fixture, now, true)
      if (saved) leads.push(saved)
    }
    return { leads }
  }

  const leads: ScoredLead[] = []
  for (const id of ids) {
    const person = await getPerson(id)
    if (!person || !isOpenLead(person)) continue
    const result = scoreLead(signalsFromFub(person, await listRecentEvents(person.id), now))
    const saved = await publishLeadScore({
      personId: person.id,
      personName: person.name,
      result,
      stage: person.stage,
      now,
    })
    if (saved) leads.push(saved)
  }
  return { leads }
}
