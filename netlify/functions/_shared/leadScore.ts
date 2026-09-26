/**
 * Pure lead-heat score (0–100). No I/O.
 *
 * Weights:
 * - Recent inbound email/SMS: +28 (24h), +16 (72h), +6 (7d)
 * - Engagement keywords, capped at +24
 * - Appointment requested: +22
 * - Stage baseline: hot 55, lead 40, nurture 28, closed 18
 * - Silence (only when there is no inbound in 72h): up to -28
 * Ops/vendor contacts are excluded.
 */

export type HeatBand = 'hot' | 'warm' | 'cool' | 'cold'
export type ScoreBand = HeatBand | 'excluded'

export type LeadSignals = {
  stage?: string | null
  tags?: string[] | null
  recentText?: string | null
  lastInboundAt?: string | Date | null
  lastContactAt?: string | Date | null
  appointmentRequested?: boolean
  opsContact?: boolean
  now?: string | Date
}

export type LeadScoreResult = {
  score: number
  band: ScoreBand
  reasons: string[]
  excluded: boolean
}

const KEYWORD_CAP = 24
const APPOINTMENT_POINTS = 22

const KEYWORDS: { label: string; pattern: RegExp; points: number; group: string }[] = [
  { label: 'pre-approval', pattern: /pre[-\s]?approv/i, points: 12, group: 'pre' },
  { label: 'rate', pattern: /\brates?\b/i, points: 8, group: 'rate' },
  { label: 'docs ready', pattern: /(?:docs?|documents?)\s+(?:are\s+)?ready/i, points: 12, group: 'docs' },
  { label: 'ready to buy', pattern: /ready to (?:buy|move|close|lock)/i, points: 14, group: 'ready' },
  { label: 'refinance now', pattern: /refinanc\w*(?:\s+\w+){0,2}\s+now|\brefi now\b/i, points: 14, group: 'refi' },
  { label: 'refinance', pattern: /\brefi(?:nance\w*)?\b/i, points: 8, group: 'refi' },
]

const APPOINTMENT_PATTERN =
  /\b(appointment|schedule(?:\s+a)?\s+(?:call|time)|call me|let's talk|lets talk|book a (?:call|time))\b/i

const EXCLUDE_PATTERN = /(trash|sphere|vendor|agent|partner|\bops\b|title|escrow)/i

export function bandForScore(score: number): HeatBand {
  if (score >= 90) return 'hot'
  if (score >= 70) return 'warm'
  if (score >= 40) return 'cool'
  return 'cold'
}

export function bandLabel(band: ScoreBand): string {
  if (band === 'hot') return 'Hot now'
  if (band === 'warm') return 'Warm'
  if (band === 'cool') return 'Cool'
  if (band === 'cold') return 'Cold'
  return 'Excluded'
}

export function isExcludedContact(signals: LeadSignals): boolean {
  if (signals.opsContact) return true
  if (EXCLUDE_PATTERN.test(signals.stage ?? '')) return true
  return (signals.tags ?? []).some((tag) => EXCLUDE_PATTERN.test(tag))
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function ageHours(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / 3_600_000)
}

function ageDays(from: Date, now: Date): number {
  return Math.floor(ageHours(from, now) / 24)
}

function stageBaseline(stage: string | null | undefined): { points: number; reason: string } {
  const raw = stage?.trim() ?? ''
  const normalized = raw.toLowerCase()
  if (/hot/.test(normalized)) return { points: 55, reason: 'Stage is hot' }
  if (/nurture|past client|long[-\s]?term|watch/.test(normalized)) {
    return { points: 28, reason: `Stage: ${raw || 'Nurture'}` }
  }
  if (/closed|pending|under contract|funded|archived/.test(normalized)) {
    return { points: 18, reason: `Stage: ${raw}` }
  }
  if (!normalized) return { points: 36, reason: 'No stage on file' }
  if (/lead|new|active|attempt/.test(normalized)) return { points: 40, reason: `Stage: ${raw}` }
  return { points: 32, reason: `Stage: ${raw}` }
}

export function scoreLead(signals: LeadSignals): LeadScoreResult {
  if (isExcludedContact(signals)) {
    return {
      score: 0,
      band: 'excluded',
      excluded: true,
      reasons: ['Ops or vendor contact — left out of lead scoring'],
    }
  }

  const now = asDate(signals.now) ?? new Date()
  const reasons: string[] = []
  let points = 0

  const stage = stageBaseline(signals.stage)
  points += stage.points
  reasons.push(stage.reason)

  const inboundAt = asDate(signals.lastInboundAt)
  let inboundWithin72h = false
  if (inboundAt) {
    const hours = ageHours(inboundAt, now)
    if (hours <= 24) {
      points += 28
      inboundWithin72h = true
      reasons.push('Inbound email or text in the last 24 hours')
    } else if (hours <= 72) {
      points += 16
      inboundWithin72h = true
      reasons.push('Inbound email or text in the last 72 hours')
    } else if (hours <= 24 * 7) {
      points += 6
      reasons.push('Inbound in the last week')
    }
  }

  const text = signals.recentText ?? ''
  const matched = new Map<string, { label: string; points: number }>()
  for (const keyword of KEYWORDS) {
    if (!keyword.pattern.test(text)) continue
    const previous = matched.get(keyword.group)
    if (!previous || keyword.points > previous.points) {
      matched.set(keyword.group, { label: keyword.label, points: keyword.points })
    }
  }
  if (matched.size > 0) {
    const labels = [...matched.values()].map((item) => item.label)
    const keywordPoints = Math.min(
      KEYWORD_CAP,
      [...matched.values()].reduce((sum, item) => sum + item.points, 0),
    )
    points += keywordPoints
    reasons.push(`Engagement: ${labels.join(', ')}`)
  }

  if (signals.appointmentRequested || APPOINTMENT_PATTERN.test(text)) {
    points += APPOINTMENT_POINTS
    reasons.push('Appointment requested')
  }

  if (!inboundWithin72h) {
    const contactAt = asDate(signals.lastContactAt) ?? inboundAt
    if (!contactAt) {
      points -= 8
      reasons.push('No contact date on file')
    } else {
      const days = ageDays(contactAt, now)
      if (days <= 2) {
        points += 4
        reasons.push('Spoke in the last 2 days')
      } else if (days <= 7) {
        reasons.push('Contacted this week')
      } else if (days <= 21) {
        points -= 12
        reasons.push(`Quiet for ${days} days`)
      } else if (days <= 45) {
        points -= 20
        reasons.push(`Quiet for ${days} days`)
      } else {
        points -= 28
        reasons.push(`Gone quiet for ${days} days`)
      }
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(points)))
  return {
    score,
    band: bandForScore(score),
    reasons,
    excluded: false,
  }
}
