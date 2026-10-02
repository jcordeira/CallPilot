export const CALENDAR_OWNER_EMAIL = 'joseph@teamcordeira.com'

export const TEAM_GUESTS = [
  { name: 'Frankie', email: 'fcordeirajr@cliffcomortgage.com' },
  { name: 'Daniel', email: 'debbecke@cliffcomortgage.com' },
  { name: 'Debra', email: 'drose@cliffcomortgage.com' },
] as const

export function externalGuestEmails(emails: string[], owner = CALENDAR_OWNER_EMAIL): string[] {
  const self = owner.trim().toLowerCase()
  return [...new Set(emails.map((email) => email.trim()).filter(Boolean))].filter((email) => email.toLowerCase() !== self)
}

export function clientCallTitle(name: string, topic: string): string {
  const topicText = topic.replace(/\bcall\b/gi, '').replace(/\s+/g, ' ').trim()
  return topicText ? `${name} call ${topicText}` : `${name} call`
}
