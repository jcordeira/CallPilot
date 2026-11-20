import { env } from './env'
import { FRANKIE_ATTENDEE_EMAIL } from './calendarAttendeeAutoadd'
import type { FrankieBoard, FrankieRow, SectionId } from './frankieToday'

const TZ = 'America/New_York'

/** Connected Google account that already sends Frankie's calendar mail. */
export const FRANKIE_EMAIL_FROM = 'Joseph Cordeira <joseph@teamcordeira.com>'
export const FRANKIE_EMAIL_TO = FRANKIE_ATTENDEE_EMAIL

export function frankieDailyEmailEnabled(): boolean {
  const raw = env('FRANKIE_DAILY_EMAIL_ENABLED', 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

export function etWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now)
}

export function etHour(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  return Number(parts.find((part) => part.type === 'hour')?.value ?? '')
}

export function isWeekdayEt(now: Date): boolean {
  const day = etWeekday(now)
  return day !== 'Sat' && day !== 'Sun'
}

/** 8:00 AM Eastern. The cron fires at 12:00 and 13:00 UTC so this stays 8 AM through daylight saving. */
export function isFrankieEmailHour(now: Date): boolean {
  return isWeekdayEt(now) && etHour(now) === 8
}

export function frankieEmailSubject(now: Date): string {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now)
  return `Your follow-ups for ${label}`
}

function daysLabel(days: number | null): string {
  if (days == null) return 'Never touched'
  if (days === 0) return 'Touched today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function personUrl(id: number): string {
  return `https://teamcordeira.followupboss.com/2/people/view/${id}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    return '&quot;'
  })
}

export type FrankieEmail = {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

export function buildFrankieDailyEmail(board: FrankieBoard, now: Date): FrankieEmail {
  const shown = board.people.slice(0, board.cap)
  const bySection = new Map<SectionId, FrankieRow[]>()
  for (const person of shown) {
    const rows = bySection.get(person.sectionId) ?? []
    rows.push(person)
    bySection.set(person.sectionId, rows)
  }
  const more = board.sections
    .map((section) => ({
      label: section.label,
      count: section.total - (bySection.get(section.id)?.length ?? 0),
    }))
    .filter((section) => section.count > 0)
  const subject = frankieEmailSubject(now)
  const counts = board.sections.map((section) => `${section.label}: ${section.total}`)
  const textLines = [subject, '', counts.join('\n') || 'Nobody is due.', '']
  const htmlSections: string[] = []
  for (const [sectionId, people] of bySection) {
    const label = board.sections.find((section) => section.id === sectionId)?.label ?? people[0]?.reason ?? sectionId
    textLines.push(label)
    const items = people.map((person) => {
      const url = personUrl(person.id)
      const detail = `${person.reason} · ${daysLabel(person.daysSinceTouch)} · ${person.source}`
      textLines.push(`- ${person.name} (${url}) — ${detail}`)
      return `<li style="margin:0 0 12px;"><a href="${escapeHtml(url)}">${escapeHtml(person.name)}</a><br>${escapeHtml(detail)}</li>`
    })
    textLines.push('')
    htmlSections.push(
      `<h2 style="font-size:16px;margin:20px 0 8px;">${escapeHtml(label)}</h2><ul style="list-style:none;padding:0;margin:0;">${items.join('')}</ul>`,
    )
  }
  if (more.length) {
    textLines.push('More due')
    for (const section of more) textLines.push(`${section.label}: ${section.count}`)
  }
  const countHtml = counts.length
    ? `<p style="margin:0 0 8px;">${counts.map((line) => escapeHtml(line)).join('<br>')}</p>`
    : '<p style="margin:0 0 8px;">Nobody is due.</p>'
  const moreHtml = more.length
    ? `<h2 style="font-size:16px;margin:20px 0 8px;">More due</h2><p style="margin:0;">${more.map((section) => escapeHtml(`${section.label}: ${section.count}`)).join('<br>')}</p>`
    : ''
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.45;color:#1a1a1a;">
<p style="margin:0 0 12px;font-size:18px;">${escapeHtml(subject)}</p>
${countHtml}
${htmlSections.join('')}
${moreHtml}
</body>
</html>`
  return { from: FRANKIE_EMAIL_FROM, to: FRANKIE_EMAIL_TO, subject, html, text: textLines.join('\n').trim() }
}
