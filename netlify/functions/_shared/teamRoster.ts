import { env } from './env'

export type RosterMember = {
  name: string
  phone: string
  email?: string
  /** Follow Up Boss user id. Absent for people who are not FUB users. */
  userId?: number
  title?: string
}

function e164(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+') && digits.length >= 8) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return undefined
}

function emailOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const email = value.trim()
  return email.includes('@') ? email : undefined
}

function userIdOf(value: unknown): number | undefined {
  const id = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isInteger(id) && id > 0 ? id : undefined
}

function memberFrom(raw: {
  name?: unknown
  phone?: unknown
  email?: unknown
  userId?: unknown
  title?: unknown
}): RosterMember | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const phone = e164(typeof raw.phone === 'string' ? raw.phone : undefined)
  if (!name || !phone) return null
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  return {
    name,
    phone,
    email: emailOf(raw.email),
    userId: userIdOf(raw.userId),
    title: title || undefined,
  }
}

function fromJson(): RosterMember[] | null {
  const raw = env('TEAM_MEMBERS').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const bag = item as Record<string, unknown>
      const member = memberFrom({
        name: bag.name,
        phone: bag.phone,
        email: bag.email,
        userId: bag.userId ?? bag.fubUserId,
        title: bag.title,
      })
      return member ? [member] : []
    })
  } catch {
    return null
  }
}

function fromIndexedEnv(): RosterMember[] {
  const members: RosterMember[] = []
  for (let index = 1; index <= 20; index += 1) {
    const member = memberFrom({
      name: env(`TEAM_MEMBER_${index}_NAME`),
      phone: env(`TEAM_MEMBER_${index}_PHONE`),
      email: env(`TEAM_MEMBER_${index}_EMAIL`),
      userId: env(`TEAM_MEMBER_${index}_USER_ID`),
      title: env(`TEAM_MEMBER_${index}_TITLE`),
    })
    if (member) members.push(member)
  }
  return members
}

function fromLoaEnv(): RosterMember[] {
  return env('FUB_LOA_USER_IDS', '16,27')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .flatMap((userId) => {
      const member = memberFrom({
        name: env(`FUB_LOA_NAME_${userId}`).trim() || `LOA ${userId}`,
        phone: env(`FUB_LOA_PHONE_${userId}`),
        email: env(`FUB_LOA_EMAIL_${userId}`),
        userId,
        title: 'LOA',
      })
      return member ? [member] : []
    })
}

function dedupe(members: RosterMember[]): RosterMember[] {
  const seen = new Set<string>()
  return members.filter((member) => {
    if (seen.has(member.phone)) return false
    seen.add(member.phone)
    return true
  })
}

/** Command-mode team. TEAM_MEMBERS JSON wins, then TEAM_MEMBER_n_*, then the FUB LOA phones. */
export function teamRoster(): RosterMember[] {
  const json = fromJson()
  if (json && json.length) return dedupe(json)
  const indexed = fromIndexedEnv()
  if (indexed.length) return dedupe(indexed)
  return dedupe(fromLoaEnv())
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function personMatches(name: string, query: string): boolean {
  const full = norm(name)
  const first = full.split(' ')[0] ?? ''
  if (full === query || first === query) return true
  if ((query === 'frank' || query === 'frankie') && first.startsWith('frank')) return true
  return false
}

export function membersForLabel(label: string | undefined): { members: RosterMember[]; unknown: boolean } {
  const members = teamRoster()
  const text = norm(label ?? '').replace(/^the\s+/, '')
  if (!text) return { members: [], unknown: true }
  if (text === 'team' || text === 'both' || text === 'all' || text === 'everyone') return { members, unknown: false }
  const hits = members.filter((member) => personMatches(member.name, text))
  return { members: hits, unknown: hits.length === 0 }
}
