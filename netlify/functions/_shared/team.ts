import { env } from './env'
import type { LeadScoreResult, ScoreBand } from './leadScore'
import { shiftDateKey } from './hubTypes'

export type TeamRole = 'lo' | 'loa'

export type Teammate = {
  role: TeamRole
  name: string
  title: string
  userId?: number
}

export type FollowUpPlan = {
  assigneeName: string
  assigneeRole: TeamRole
  assigneeTitle: string
  assignedUserId?: number
  taskType: 'Call' | 'Text' | 'Follow Up'
  dueDate: string
  taskName: string
}

const DEFAULT_LO_NAME = 'Joseph Cordeira'
const DEFAULT_LOA_NAME = 'Frank Cordeira'

function userIdFrom(key: string): number | undefined {
  const raw = env(key).trim()
  if (!raw) return undefined
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return undefined
  return id
}

export function loanOfficer(): Teammate {
  const name = env('FUB_LO_NAME', DEFAULT_LO_NAME).trim() || DEFAULT_LO_NAME
  return {
    role: 'lo',
    name,
    title: 'Loan Officer',
    userId: userIdFrom('FUB_LO_USER_ID'),
  }
}

export function loanOfficerAssistant(): Teammate {
  const name = env('FUB_LOA_NAME', DEFAULT_LOA_NAME).trim() || DEFAULT_LOA_NAME
  return {
    role: 'loa',
    name,
    title: 'Loan Officer Assistant',
    userId: userIdFrom('FUB_LOA_USER_ID'),
  }
}

export function teammateForBand(band: ScoreBand): Teammate | null {
  if (band === 'hot') return loanOfficer()
  if (band === 'warm' || band === 'cool') return loanOfficerAssistant()
  return null
}

function planFor(teammate: Teammate, taskType: FollowUpPlan['taskType'], dueOffset: number, taskName: string, now: Date): FollowUpPlan {
  return {
    assigneeName: teammate.name,
    assigneeRole: teammate.role,
    assigneeTitle: teammate.title,
    assignedUserId: teammate.userId,
    taskType,
    dueDate: shiftDateKey(now, dueOffset),
    taskName,
  }
}

/** Hot → Joseph today. Warm/Cool → Frank. Cold and excluded → no task. */
export function followUpPlan(result: LeadScoreResult, personName: string, now = new Date()): FollowUpPlan | null {
  if (result.excluded || result.band === 'cold' || result.band === 'excluded') return null
  const name = personName.trim() || 'Lead'
  if (result.band === 'hot') {
    return planFor(loanOfficer(), 'Call', 0, `Call ${name} — hot again (${result.score})`, now)
  }
  if (result.band === 'warm') {
    return planFor(loanOfficerAssistant(), 'Text', 1, `Text ${name} — warm lead (${result.score})`, now)
  }
  return planFor(loanOfficerAssistant(), 'Follow Up', 5, `Follow up with ${name} — nurture (${result.score})`, now)
}

/** Sensitive replies always go to the loan officer the same day. */
export function escalationPlan(personName: string, now = new Date()): FollowUpPlan {
  const name = personName.trim() || 'Lead'
  return planFor(loanOfficer(), 'Call', 0, `Call ${name} — needs a loan officer`, now)
}
