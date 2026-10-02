import { env, isDemoMode } from './env'
import { addNote, assignPerson, createTask, fubGet, listOpenFubTasks } from './followupboss'
import { createCalendarEvent, createGoogleTask } from './calendar'
import { calendarCanReadFreeBusy, calendarCanWriteEvents, loadGoogleTokens, resolveGoogleAccessToken } from './googleAuth'
import { sendSmsIfConfigured } from './quo'
import {
  type CommandCall,
  type CommandRole,
  type ToolCompletion,
  parseCommand,
} from './commandParse'
import {
  type CommandLog,
  type CommandPending,
  type CommandState,
  commandBusyUntil,
  loadCommandState,
  saveCommandState,
} from './commandStore'
import { addDays, formatSlot, formatWhen, openSlots, parseWhen, zonedDate, zonedParts } from './commandTime'
import { personLink } from './loaReminders'
import { membersForLabel, teamRoster } from './teamRoster'

export type { CommandCall, CommandRole }
export { commandBusyUntil }

export type Actor = { role: CommandRole; phone: string; name: string; userId?: number; email?: string; title?: string }

export type LeadHit = {
  id: number
  name: string
  phone?: string
  stage?: string
  assignedTo?: string
  lastActivity?: string
}

export type CalEvent = { id: string; summary: string; startIso: string; endIso: string }

export type CommandEffects = {
  searchLeads: (query: string) => Promise<LeadHit[]>
  leadDetail: (id: number) => Promise<{ lead: LeadHit; tasks: string[]; notes: string[] } | null>
  addNote: (input: { personId: number; body: string; mentionUserId?: number; mentionName?: string }) => Promise<void>
  createFubTask: (input: { personId: number; personName: string; title: string; due?: string }) => Promise<void>
  createPersonalTask: (input: { title: string; due?: string }) => Promise<void>
  assignLead: (personId: number, userId: number) => Promise<void>
  sendSms: (input: { to: string; content: string }) => Promise<void>
  listEvents: (start: Date, end: Date) => Promise<CalEvent[]>
  createEvent: (input: { summary: string; description?: string; start: Date; end: Date; guests: string[] }) => Promise<{ id: string }>
  moveEvent: (id: string, start: Date, end: Date) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
  freeBusy: (start: Date, end: Date) => Promise<{ startIso: string; endIso: string }[]>
  digestMisses: () => Promise<{ tasks: string[]; calls: string[]; texts: string[] }>
  googleAccess: () => Promise<{ write: boolean; freebusy: boolean }>
}

type RunResult = { reply: string; pending?: CommandPending; status: CommandLog['status'] }

function e164(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+') && digits.length >= 8) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return undefined
}

export function commandSettings() {
  const days = env('COMMAND_WORK_DAYS', '1,2,3,4,5')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => day >= 0 && day <= 6)
  const start = Number(env('COMMAND_HOURS_START', '9'))
  const end = Number(env('COMMAND_HOURS_END', '18'))
  const confirm = Number(env('COMMAND_CONFIRM_MINUTES', '15'))
  return {
    enabled: env('COMMAND_MODE_ENABLED', 'false').trim().toLowerCase() === 'true',
    dryRun: env('COMMAND_MODE_DRY_RUN', 'true').trim().toLowerCase() !== 'false',
    prefix: env('COMMAND_PREFIX').trim(),
    line: e164(env('QUO_FROM_NUMBER')),
    timeZone: env('COMMAND_TIMEZONE', 'America/New_York'),
    workDays: days.length ? days : [1, 2, 3, 4, 5],
    startHour: Number.isFinite(start) ? start : 9,
    endHour: Number.isFinite(end) ? end : 18,
    slotMinutes: 30,
    confirmMinutes: Number.isFinite(confirm) && confirm > 0 ? confirm : 15,
    callMinutes: 30,
  }
}

export function commandActors(): Actor[] {
  const ownerPhone = e164(env('FUB_LO_PHONE'))
  const owner: Actor[] = ownerPhone
    ? [{ role: 'owner', phone: ownerPhone, name: env('FUB_LO_NAME', 'Joseph').trim() || 'Joseph', userId: Number(env('FUB_LO_USER_ID') || '1') || 1 }]
    : []
  const team: Actor[] = teamRoster().map((member) => ({
    role: 'team',
    phone: member.phone,
    name: member.name,
    userId: member.userId,
    email: member.email,
    title: member.title,
  }))
  return [...owner, ...team]
}

export function actorForPhone(phone: string | undefined): Actor | null {
  const normalized = e164(phone)
  if (!normalized) return null
  return commandActors().find((actor) => actor.phone === normalized) ?? null
}

export function guestEmails(): string[] {
  if (env('CALENDAR_AUTO_GUEST_ENABLED', 'false').trim().toLowerCase() !== 'true') return []
  return env('CALENDAR_AUTO_GUEST_EMAILS', 'fcordeirajr@cliffcomortgage.com')
    .split(',')
    .map((part) => part.trim())
    .filter((email) => email.includes('@'))
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function matchLeads(query: string, people: LeadHit[]): { match?: LeadHit; choices: LeadHit[] } {
  const wanted = norm(query)
  if (!wanted) return { choices: [] }
  const tokens = wanted.split(' ')
  const scored = people
    .map((person) => {
      const name = norm(person.name)
      const parts = name.split(' ')
      let score = 0
      if (name === wanted) score = 100
      else if (tokens.length >= 2 && tokens.every((token) => parts.includes(token))) score = name.startsWith(wanted) ? 95 : 85
      else if (name.includes(wanted) && tokens.length >= 2) score = 80
      else if (tokens.length === 1 && (parts[0] === tokens[0] || parts[parts.length - 1] === tokens[0])) score = 72
      return { person, score }
    })
    .filter((row) => row.score >= 50)
    .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
  if (!scored.length) return { choices: [] }
  const close = scored.filter((row) => row.score >= scored[0].score - 10).slice(0, 4)
  if (close.length > 1 && close[1].score >= 70) return { choices: close.map((row) => row.person) }
  return { match: scored[0].person, choices: [] }
}

function actorsForLabel(label: string | undefined): { targets: Actor[]; unknown: boolean } {
  const found = membersForLabel(label)
  if (found.unknown) return { targets: [], unknown: true }
  const byPhone = new Map(commandActors().filter((actor) => actor.role === 'team').map((actor) => [actor.phone, actor]))
  return { targets: found.members.flatMap((member) => {
    const actor = byPhone.get(member.phone)
    return actor ? [actor] : []
  }), unknown: false }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function inviteEmails(extra: string[] | undefined): { emails: string[]; problem?: string } {
  const emails = new Set(guestEmails().map((email) => email.toLowerCase()))
  for (const label of extra ?? []) {
    const found = membersForLabel(label)
    if (found.unknown || !found.members.length) return { emails: [...emails], problem: `I don't have ${label} on the team list.` }
    for (const member of found.members) {
      if (!member.email) return { emails: [...emails], problem: `${member.name} has no email on file.` }
      emails.add(member.email.toLowerCase())
    }
  }
  return { emails: [...emails] }
}

function ownerActor(): Actor | undefined {
  return commandActors().find((actor) => actor.role === 'owner')
}

function clip(text: string, dryRun: boolean): string {
  const clean = text.replace(/[ \t]+\n/g, '\n').trim()
  const body = clean.length > 700 ? `${clean.slice(0, 697)}...` : clean
  return dryRun ? `[preview] ${body}` : body
}

/** Append the Follow Up Boss profile and keep it inside the SMS cap. */
function withProfileLink(text: string, personId: number): string {
  if (!Number.isInteger(personId) || personId <= 0) return text
  const href = personLink(personId)
  const suffix = ` ${href}`
  const clean = text.replace(/[ \t]+\n/g, '\n').trim()
  const budget = 700 - suffix.length
  const body = clean.length > budget ? `${clean.slice(0, Math.max(0, budget - 1)).trimEnd()}…` : clean
  return `${body}${suffix}`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Same Follow Up Boss mention contract as LOA reminders: HTML span, isHtml, and mentions.user. */
export function fubMentionNote(input: { body: string; mentionUserId: number; mentionName: string }): {
  subject: string
  body: string
  isHtml: true
  mentionUserIds: number[]
} {
  return {
    subject: 'LoanPilot assignment',
    body: `<p><span data-user-id="${input.mentionUserId}">${escapeHtml(input.mentionName)}</span> ${escapeHtml(input.body)}</p>`,
    isHtml: true,
    mentionUserIds: [input.mentionUserId],
  }
}

function eventTitle(name: string, topic?: string): string {
  const topicText = topic?.replace(/\bcall\b/gi, '').trim()
  return topicText ? `${name} call ${topicText}` : `${name} call`
}

function helpText(role: CommandRole): string {
  const names = teamRoster().map((member) => member.name.split(' ')[0]).filter(Boolean)
  const list = joinNames(names) || 'the team'
  if (role === 'team') {
    return 'You can ask: when is Joe free Thursday? book Joe with <name> <time>. brief <name>. note <name>: <text>. task <name>: <text>.'
  }
  const assignable = joinNames(teamRoster().filter((member) => member.userId).map((member) => member.name.split(' ')[0])) || 'a LOA'
  return `Commands: book <name> <time> <topic>. book <name> <time> and add ${names.at(-1) ?? 'someone'}. move my 3pm to 4pm. cancel <name> (YES to confirm). text ${list}: <msg>. text the team: <msg>. text <client>: <msg> (YES to send). what's on today. brief <name>. note <name>: <text>. task <name>: <text>. assign <name> to ${assignable} (YES). when am I free. hold calls till 2. help.`
}

async function resolveLead(
  call: CommandCall,
  effects: CommandEffects,
  forced?: LeadHit,
): Promise<{ lead?: LeadHit; choices?: LeadHit[]; missing?: boolean }> {
  if (forced) return { lead: forced }
  if (!call.clientName) return { missing: true }
  const people = await effects.searchLeads(call.clientName)
  const found = matchLeads(call.clientName, people)
  if (found.choices.length > 1) return { choices: found.choices }
  if (found.match) return { lead: found.match }
  return { lead: { id: 0, name: call.clientName } }
}

function choiceReply(choices: LeadHit[]): string {
  const lines = choices.map((choice, index) => `${index + 1}. ${choice.name}`)
  return `Which lead?\n${lines.join('\n')}`
}

async function findEvents(call: CommandCall, now: Date, effects: CommandEffects, timeZone: string): Promise<CalEvent[]> {
  const events = await effects.listEvents(new Date(now.getTime() - 3_600_000), new Date(now.getTime() + 21 * 86_400_000))
  const name = norm((call.clientName ?? '').replace(/'s\b/i, ''))
  const when = call.whenText ? parseWhen(call.whenText, now, timeZone) : null
  return events.filter((event) => {
    const title = norm(event.summary)
    const nameOk = !name || name.split(' ').filter((part) => part.length > 1).every((part) => title.includes(part))
    const whenOk = !when || Math.abs(new Date(event.startIso).getTime() - when.start.getTime()) <= 25 * 60_000
    return nameOk && whenOk && Boolean(name || when)
  })
}

async function runCall(
  actor: Actor,
  call: CommandCall,
  effects: CommandEffects,
  now: Date,
  dryRun: boolean,
  forced?: { lead?: LeadHit; event?: CalEvent },
): Promise<RunResult> {
  const settings = commandSettings()
  const tz = settings.timeZone
  const pendingBase = (kind: CommandPending['kind'], summary: string, payload: Record<string, unknown>): CommandPending => ({
    id: `${now.getTime()}-${actor.phone}`,
    phone: actor.phone,
    expiresAt: new Date(now.getTime() + settings.confirmMinutes * 60_000).toISOString(),
    summary,
    kind,
    payload,
  })

  if (call.intent === 'help') return { reply: clip(helpText(actor.role), dryRun), status: 'done' }
  if (call.intent === 'unknown') return { reply: clip('Text help for commands.', dryRun), status: 'done' }

  if (call.intent === 'book_call' || call.intent === 'request_booking') {
    const resolved = await resolveLead(call, effects, forced?.lead)
    if (resolved.choices) {
      return {
        reply: clip(choiceReply(resolved.choices), dryRun),
        status: 'preview',
        pending: pendingBase('choice', 'Pick a lead', { call, choices: resolved.choices }),
      }
    }
    const name = resolved.lead?.name || call.clientName
    if (!name) return { reply: clip('Who is the call with?', dryRun), status: 'error' }
    const when = parseWhen(call.whenText ?? '', now, tz)
    if (!when) return { reply: clip('What time? Try tomorrow 2pm or Thu 3pm.', dryRun), status: 'error' }
    const end = new Date(when.start.getTime() + settings.callMinutes * 60_000)
    const access = await effects.googleAccess()
    if (!dryRun && !access.write) return { reply: clip('Reconnect Google on the Hub before I can book. The saved grant cannot write events.', false), status: 'error' }
    const dayEvents = await effects.listEvents(when.start, end)
    const clashes = dayEvents.filter((event) => new Date(event.startIso) < end && new Date(event.endIso) > when.start)
    const title = eventTitle(name, call.topic)
    const whenLabel = formatWhen(when.start, tz)
    const clashNote = clashes.length
      ? ` Overlaps ${clashes.map((event) => event.summary).slice(0, 2).join('; ')}.`
      : ''
    const invited = inviteEmails(call.guests)
    if (invited.problem) return { reply: clip(invited.problem, dryRun), status: 'error' }
    const guestNote = invited.emails.length ? ` Guest: ${invited.emails.join(', ')}.` : ''
    if (call.intent === 'request_booking') {
      const owner = ownerActor()
      if (!owner) return { reply: clip('Joseph has no phone on file.', dryRun), status: 'error' }
      const summary = `${actor.name} wants to book ${title} ${whenLabel}`
      if (!dryRun) {
        await effects.sendSms({ to: owner.phone, content: `${summary}. Reply YES to book or NO to pass.` })
      }
      return {
        reply: clip(dryRun ? `Would ask Joseph to approve ${title} ${whenLabel}.${guestNote}` : `Asked Joseph to approve ${title} ${whenLabel}.${guestNote}`, dryRun),
        status: dryRun ? 'preview' : 'done',
        pending: dryRun
          ? undefined
          : {
              ...pendingBase('approval', summary, {
                call,
                leadId: resolved.lead?.id ?? 0,
                leadName: name,
                startIso: when.start.toISOString(),
                endIso: end.toISOString(),
                requesterPhone: actor.phone,
                requesterName: actor.name,
                title,
                guestEmails: invited.emails,
              }),
              phone: owner.phone,
            },
      }
    }
    if (dryRun) {
      const scopeNote = access.write ? '' : ' Reconnect Google before this can book.'
      return {
        reply: clip(`Would book ${title} ${whenLabel} (${settings.callMinutes} min).${clashNote}${guestNote}${scopeNote}`, true),
        status: 'preview',
      }
    }
    await effects.createEvent({
      summary: title,
      description: 'Booked from LoanPilot command mode.',
      start: when.start,
      end,
      guests: invited.emails,
    })
    return { reply: clip(`Booked ${title} ${whenLabel}.${clashNote}${guestNote}`, false), status: 'done' }
  }

  if (call.intent === 'cancel' || call.intent === 'reschedule') {
    const events = forced?.event ? [forced.event] : await findEvents(call, now, effects, tz)
    if (events.length > 1) {
      const lines = events.slice(0, 4).map((event, index) => `${index + 1}. ${event.summary} ${formatWhen(new Date(event.startIso), tz)}`)
      return {
        reply: clip(`Which event?\n${lines.join('\n')}`, dryRun),
        status: 'preview',
        pending: pendingBase('choice', 'Pick an event', { call, events: events.slice(0, 4) }),
      }
    }
    if (!events.length) return { reply: clip('I could not find that event.', dryRun), status: 'error' }
    const event = events[0]
    if (call.intent === 'cancel') {
      return {
        reply: clip(`Cancel ${event.summary} ${formatWhen(new Date(event.startIso), tz)}? Reply YES.`, dryRun),
        status: 'preview',
        pending: pendingBase('confirm', `Cancel ${event.summary}`, { call, eventId: event.id, summary: event.summary }),
      }
    }
    const next = parseWhen(call.toWhenText ?? '', now, tz)
    if (!next) return { reply: clip('What time should I move it to?', dryRun), status: 'error' }
    const end = new Date(next.start.getTime() + settings.callMinutes * 60_000)
    if (dryRun) return { reply: clip(`Would move ${event.summary} to ${formatWhen(next.start, tz)}.`, true), status: 'preview' }
    await effects.moveEvent(event.id, next.start, end)
    return { reply: clip(`Moved ${event.summary} to ${formatWhen(next.start, tz)}.`, false), status: 'done' }
  }

  if (call.intent === 'text_team') {
    const found = actorsForLabel(call.who)
    const targets = found.targets
    if (found.unknown || !targets.length || !call.body) {
      const example = teamRoster()[0]?.name.split(' ')[0] ?? 'Frankie'
      return { reply: clip(`Say who and what to text. Example: text ${example}: pull appraisal.`, dryRun), status: 'error' }
    }
    const names = joinNames(targets.map((seat) => seat.name.split(' ')[0]))
    if (dryRun) return { reply: clip(`Would text ${names}: ${call.body}`, true), status: 'preview' }
    for (const seat of targets) await effects.sendSms({ to: seat.phone, content: call.body })
    return { reply: clip(`Texted ${names}: ${call.body}`, false), status: 'done' }
  }

  if (call.intent === 'text_client') {
    const resolved = await resolveLead(call, effects, forced?.lead)
    if (resolved.choices) {
      return {
        reply: clip(choiceReply(resolved.choices), dryRun),
        status: 'preview',
        pending: pendingBase('choice', 'Pick a lead', { call, choices: resolved.choices }),
      }
    }
    const lead = resolved.lead
    if (!lead?.phone) return { reply: clip(`${lead?.name ?? 'That lead'} has no phone in Follow Up Boss.`, dryRun), status: 'error' }
    return {
      reply: clip(`Text ${lead.name}: "${call.body ?? ''}"? Reply YES.`, dryRun),
      status: 'preview',
      pending: pendingBase('confirm', `Text ${lead.name}`, { call, leadId: lead.id, leadName: lead.name, phone: lead.phone, body: call.body }),
    }
  }

  if (call.intent === 'today_digest') {
    const parts = zonedParts(now, tz)
    const start = zonedDate({ ...parts, hour: 0, minute: 0 }, tz)
    const end = zonedDate({ ...parts, hour: 23, minute: 59 }, tz)
    const events = await effects.listEvents(start, end)
    const misses = await effects.digestMisses()
    const lines = [
      events.length ? `Today: ${events.map((event) => `${formatSlot(new Date(event.startIso), tz)} ${event.summary}`).join('; ')}.` : 'Nothing on the calendar today.',
      misses.tasks.length ? `Overdue: ${misses.tasks.slice(0, 4).join('; ')}.` : 'No overdue tasks.',
      `Missed calls: ${misses.calls.length}. Unanswered texts: ${misses.texts.length}.`,
    ]
    return { reply: clip(lines.join('\n'), dryRun), status: 'done' }
  }

  if (call.intent === 'lead_brief' || call.intent === 'add_note' || call.intent === 'create_task' || call.intent === 'assign_lead') {
    if (call.intent === 'create_task' && call.personal) {
      const due = call.whenText ? parseWhen(call.whenText, now, tz) : null
      const dueKey = due ? zonedParts(due.start, tz) : undefined
      const dueText = dueKey ? `${dueKey.year}-${String(dueKey.month).padStart(2, '0')}-${String(dueKey.day).padStart(2, '0')}` : undefined
      if (dryRun) return { reply: clip(`Would add personal task "${call.body}".`, true), status: 'preview' }
      await effects.createPersonalTask({ title: call.body ?? 'Follow up', due: dueText })
      return { reply: clip(`Added personal task "${call.body}".`, false), status: 'done' }
    }
    const resolved = await resolveLead(call, effects, forced?.lead)
    if (resolved.choices) {
      return {
        reply: clip(choiceReply(resolved.choices), dryRun),
        status: 'preview',
        pending: pendingBase('choice', 'Pick a lead', { call, choices: resolved.choices }),
      }
    }
    const lead = resolved.lead
    if (!lead || !lead.id) return { reply: clip(`I could not find ${call.clientName ?? 'that lead'} in Follow Up Boss.`, dryRun), status: 'error' }
    if (call.intent === 'lead_brief') {
      const detail = await effects.leadDetail(lead.id)
      const info = detail?.lead ?? lead
      const tasks = detail?.tasks.slice(0, 3).join('; ') || 'none'
      const notes = detail?.notes.slice(0, 2).join(' | ') || 'none'
      const personId = info.id > 0 ? info.id : lead.id
      return {
        reply: clip(
          withProfileLink(
            `${info.name} — ${info.stage || 'no stage'}, assigned ${info.assignedTo || 'nobody'}. Last contact ${info.lastActivity || 'unknown'}. Open: ${tasks}. Notes: ${notes}.`,
            personId,
          ),
          dryRun,
        ),
        status: 'done',
      }
    }
    if (call.intent === 'add_note') {
      if (!call.body) return { reply: clip('What should the note say?', dryRun), status: 'error' }
      if (dryRun) return { reply: clip(`Would note ${lead.name}: ${call.body}`, true), status: 'preview' }
      await effects.addNote({ personId: lead.id, body: call.body })
      return { reply: clip(`Noted on ${lead.name}.`, false), status: 'done' }
    }
    if (call.intent === 'create_task') {
      if (!call.body) return { reply: clip('What is the task?', dryRun), status: 'error' }
      const due = call.whenText ? parseWhen(call.whenText, now, tz) : null
      const dueKey = due ? zonedParts(due.start, tz) : undefined
      const dueText = dueKey ? `${dueKey.year}-${String(dueKey.month).padStart(2, '0')}-${String(dueKey.day).padStart(2, '0')}` : undefined
      if (dryRun) return { reply: clip(`Would task ${lead.name}: ${call.body}`, true), status: 'preview' }
      await effects.createFubTask({ personId: lead.id, personName: lead.name, title: call.body, due: dueText })
      return { reply: clip(`Task on ${lead.name}: ${call.body}`, false), status: 'done' }
    }
    const found = actorsForLabel(call.assignee)
    const assignable = teamRoster().filter((member) => member.userId).map((member) => member.name.split(' ')[0])
    if (found.unknown || found.targets.length !== 1) {
      return { reply: clip(`Assign to ${joinNames(assignable) || 'a LOA'}.`, dryRun), status: 'error' }
    }
    const target = found.targets[0]
    if (!target.userId) return { reply: clip(`${target.name} is not in Follow Up Boss, so I can't assign a lead to them.`, dryRun), status: 'error' }
    return {
      reply: clip(`Assign ${lead.name} to ${target.name}? Reply YES.`, dryRun),
      status: 'preview',
      pending: pendingBase('confirm', `Assign ${lead.name}`, { call, leadId: lead.id, leadName: lead.name, userId: target.userId, assigneeName: target.name, assigneePhone: target.phone }),
    }
  }

  if (call.intent === 'availability') {
    const access = await effects.googleAccess()
    if (!access.freebusy) return { reply: clip('Reconnect Google on the Hub so I can read free/busy. Event titles stay private.', dryRun), status: 'error' }
    const current = zonedParts(now, tz)
    let day = current
    if (call.whenText) {
      const parsed = parseWhen(`${call.whenText} 9am`, now, tz)
      if (parsed) day = zonedParts(parsed.start, tz)
    } else if (!settings.workDays.includes(current.weekday) || current.hour >= settings.endHour) {
      for (let i = 1; i <= 7; i += 1) {
        const next = addDays(current, i, tz)
        if (settings.workDays.includes(next.weekday)) {
          day = next
          break
        }
      }
    }
    if (!settings.workDays.includes(day.weekday)) return { reply: clip('That day is outside working hours.', dryRun), status: 'done' }
    const start = zonedDate({ ...day, hour: settings.startHour, minute: 0 }, tz)
    const end = zonedDate({ ...day, hour: settings.endHour, minute: 0 }, tz)
    const busy = await effects.freeBusy(start, end)
    const slots = openSlots({
      now,
      timeZone: tz,
      day,
      startHour: settings.startHour,
      endHour: settings.endHour,
      durationMinutes: settings.slotMinutes,
      busy,
      limit: 5,
    })
    if (!slots.length) return { reply: clip(`No open ${settings.slotMinutes}-min slots ${formatSlot(start, tz).split(',')[0] ?? 'that day'}.`, dryRun), status: 'done' }
    return { reply: clip(`Open: ${slots.map((slot) => formatSlot(slot, tz)).join(', ')}.`, dryRun), status: 'done' }
  }

  if (call.intent === 'busy_until') {
    const when = parseWhen(call.whenText ?? '', now, tz)
    if (!when) return { reply: clip('Hold calls until when? Try 2pm.', dryRun), status: 'error' }
    const label = formatWhen(when.start, tz)
    if (dryRun) return { reply: clip(`Would hold calls until ${label}.`, true), status: 'preview' }
    return { reply: clip(`Holding calls until ${label}. WhatsApp auto-reply will use that.`, false), status: 'done', pending: undefined }
  }

  return { reply: clip('Text help for commands.', dryRun), status: 'done' }
}

async function finishPending(
  actor: Actor,
  pending: CommandPending,
  text: string,
  effects: CommandEffects,
  now: Date,
  dryRun: boolean,
): Promise<RunResult> {
  const answer = text.trim().toLowerCase()
  if (pending.kind === 'choice') {
    const index = Number(answer) - 1
    const choices = Array.isArray(pending.payload.choices) ? (pending.payload.choices as LeadHit[]) : []
    const events = Array.isArray(pending.payload.events) ? (pending.payload.events as CalEvent[]) : []
    const call = pending.payload.call as CommandCall
    if (choices.length && choices[index]) {
      return runCall(actor, call, effects, now, dryRun, { lead: choices[index] })
    }
    if (events.length && events[index]) {
      return runCall(actor, call, effects, now, dryRun, { event: events[index] })
    }
    return { reply: clip('Reply with the number of the one you want.', dryRun), status: 'error' }
  }
  if (!/^(yes|y|no|n)$/.test(answer)) {
    return { reply: clip('Reply YES or NO.', dryRun), status: 'error', pending }
  }
  if (answer === 'no' || answer === 'n') {
    if (pending.kind === 'approval') {
      const requester = String(pending.payload.requesterPhone ?? '')
      const title = String(pending.payload.title ?? 'that call')
      if (!dryRun && requester) await effects.sendSms({ to: requester, content: `Joseph passed on ${title}.` })
    }
    return { reply: clip('Okay, cancelled.', dryRun), status: 'denied' }
  }
  if (pending.kind === 'approval') {
    const start = new Date(String(pending.payload.startIso))
    const end = new Date(String(pending.payload.endIso))
    const title = String(pending.payload.title ?? 'Client call')
    const requester = String(pending.payload.requesterPhone ?? '')
    const storedGuests = Array.isArray(pending.payload.guestEmails) ? pending.payload.guestEmails.filter((email): email is string => typeof email === 'string') : []
    const guests = [...new Set([...guestEmails(), ...storedGuests].map((email) => email.toLowerCase()))]
    if (dryRun) return { reply: clip(`Would book ${title} ${formatWhen(start, commandSettings().timeZone)}.`, true), status: 'preview' }
    await effects.createEvent({ summary: title, description: 'Booked from LoanPilot after approval.', start, end, guests })
    if (requester) await effects.sendSms({ to: requester, content: `Joseph approved ${title} ${formatWhen(start, commandSettings().timeZone)}.` })
    return { reply: clip(`Booked ${title} ${formatWhen(start, commandSettings().timeZone)}.`, false), status: 'done' }
  }
  const call = pending.payload.call as CommandCall | undefined
  if (call?.intent === 'cancel') {
    const eventId = String(pending.payload.eventId ?? '')
    const summary = String(pending.payload.summary ?? 'the event')
    if (dryRun) return { reply: clip(`Would cancel ${summary}.`, true), status: 'preview' }
    await effects.deleteEvent(eventId)
    return { reply: clip(`Cancelled ${summary}.`, false), status: 'done' }
  }
  if (call?.intent === 'text_client') {
    const phone = String(pending.payload.phone ?? '')
    const body = String(pending.payload.body ?? '')
    const name = String(pending.payload.leadName ?? 'the client')
    if (dryRun) return { reply: clip(`Would text ${name}: ${body}`, true), status: 'preview' }
    await effects.sendSms({ to: phone, content: body })
    return { reply: clip(`Texted ${name}.`, false), status: 'done' }
  }
  if (call?.intent === 'assign_lead') {
    const leadId = Number(pending.payload.leadId)
    const userId = Number(pending.payload.userId)
    const leadName = String(pending.payload.leadName ?? 'the lead')
    const assigneeName = String(pending.payload.assigneeName ?? 'the LOA')
    const assigneePhone = String(pending.payload.assigneePhone ?? '')
    if (dryRun) return { reply: clip(`Would assign ${leadName} to ${assigneeName}.`, true), status: 'preview' }
    await effects.assignLead(leadId, userId)
    await effects.addNote({ personId: leadId, body: `Assigned to ${assigneeName} from LoanPilot.`, mentionUserId: userId, mentionName: assigneeName })
    if (assigneePhone) await effects.sendSms({ to: assigneePhone, content: `LoanPilot: ${leadName} is now assigned to you.` })
    return { reply: clip(`Assigned ${leadName} to ${assigneeName}.`, false), status: 'done' }
  }
  return { reply: clip('That confirmation expired. Send the command again.', dryRun), status: 'error' }
}

function latestPending(state: CommandState, phone: string, now: Date): CommandPending | undefined {
  return [...state.pending].reverse().find((item) => item.phone === phone && new Date(item.expiresAt).getTime() > now.getTime())
}

function remember(state: CommandState, log: CommandLog, pending?: CommandPending, dropPhone?: string) {
  state.recent = [log, ...state.recent].slice(0, 40)
  state.pending = state.pending.filter((item) => item.phone !== (dropPhone ?? log.actor) && new Date(item.expiresAt).getTime() > Date.now())
  if (pending) state.pending.push(pending)
}

export async function handleCommandMessage(input: {
  from: string
  to?: string | string[]
  body: string
  messageId: string
  now?: Date
  parse?: ToolCompletion
  effects?: CommandEffects
}): Promise<{ ignored?: 'disabled' | 'line' | 'sender' | 'duplicate' | 'prefix'; reply?: string; actor?: string }> {
  const settings = commandSettings()
  if (!settings.enabled) return { ignored: 'disabled' }
  const toList = (Array.isArray(input.to) ? input.to : input.to ? [input.to] : []).map((value) => e164(value)).filter((value): value is string => Boolean(value))
  if (settings.line && toList.length && !toList.includes(settings.line)) return { ignored: 'line' }
  const now = input.now ?? new Date()
  const state = await loadCommandState()
  if (state.seen.includes(input.messageId)) return { ignored: 'duplicate' }
  state.seen = [input.messageId, ...state.seen].slice(0, 300)
  const actor = actorForPhone(input.from)
  if (!actor) {
    await saveCommandState(state)
    return { ignored: 'sender' }
  }
  let text = input.body.trim()
  if (settings.prefix) {
    if (!text.toLowerCase().startsWith(settings.prefix.toLowerCase())) {
      await saveCommandState(state)
      return { ignored: 'prefix' }
    }
    text = text.slice(settings.prefix.length).trim()
  }
  const effects = input.effects ?? (await defaultEffects())
  const dryRun = settings.dryRun
  const pending = latestPending(state, actor.phone, now)
  let result: RunResult | undefined
  try {
    if (pending && (/^\d+$/.test(text) || /^(yes|y|no|n)$/i.test(text))) {
      result = await finishPending(actor, pending, text, effects, now, dryRun)
    } else {
      let parsed: Awaited<ReturnType<typeof parseCommand>> | null = null
      try {
        parsed = await parseCommand(text, actor.role, input.parse)
      } catch (err) {
        const detail = err instanceof Error && err.message ? err.message : 'parse failed'
        console.log(`[command-mode] parse failed: ${detail}`)
        result = { reply: clip("Sorry, I couldn't process that", dryRun), status: 'error' }
      }
      if (parsed) {
        result = await runCall(actor, parsed, effects, now, dryRun)
        if (parsed.intent === 'busy_until' && !dryRun && result.status === 'done') {
          const when = parseWhen(parsed.whenText ?? '', now, settings.timeZone)
          if (when) state.busyUntil = when.start.toISOString()
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Command failed'
    result = { reply: clip(message, dryRun), status: 'error' }
  }
  if (!result) {
    result = { reply: clip("Sorry, I couldn't process that", dryRun), status: 'error' }
  }
  remember(state, {
    id: input.messageId,
    at: now.toISOString(),
    actor: actor.name,
    role: actor.role,
    command: text.slice(0, 180),
    summary: result.reply,
    status: result.status,
    dryRun,
  }, result.pending, actor.phone)
  if (result.pending && result.pending.phone !== actor.phone) {
    state.pending = state.pending.filter((item) => item.phone !== result.pending?.phone)
    state.pending.push(result.pending)
  }
  await saveCommandState(state)
  return { reply: result.reply, actor: actor.name }
}

export function readQuoInbound(payload: unknown): { id: string; from: string; to: string[]; body: string; incoming: boolean; type: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  const object = data.object && typeof data.object === 'object' ? (data.object as Record<string, unknown>) : data
  const type = String(root.type ?? data.type ?? object.type ?? '')
  if (type && type !== 'message.received' && type !== 'message') return null
  const from = String(object.from ?? '')
  const body = String(object.body ?? object.text ?? object.content ?? '')
  const toRaw = object.to
  const to = Array.isArray(toRaw) ? toRaw.map((item) => String(item)) : toRaw ? [String(toRaw)] : []
  const direction = String(object.direction ?? 'incoming').toLowerCase()
  const incoming = direction === 'incoming' || direction === 'inbound'
  const id = String(object.id ?? root.id ?? '')
  if (!from || !id) return null
  return { id, from, to, body, incoming, type: type || 'message.received' }
}

export async function getCommandPanel(): Promise<{
  enabled: boolean
  dryRun: boolean
  line?: string
  prefix: string
  busyUntil?: string
  needsGoogleReconnect: boolean
  recent: CommandLog[]
}> {
  const settings = commandSettings()
  const state = await loadCommandState()
  const access = await googleAccess()
  return {
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    line: settings.line,
    prefix: settings.prefix,
    busyUntil: state.busyUntil,
    needsGoogleReconnect: access.connected && (!access.write || !access.freebusy),
    recent: state.recent,
  }
}

async function googleAccess(): Promise<{ write: boolean; freebusy: boolean; connected: boolean }> {
  const stored = await loadGoogleTokens()
  if (stored?.accessToken) {
    return {
      connected: true,
      write: calendarCanWriteEvents(stored.scope),
      freebusy: calendarCanReadFreeBusy(stored.scope),
    }
  }
  const envToken = Boolean(env('GOOGLE_CALENDAR_ACCESS_TOKEN'))
  return { connected: false, write: envToken, freebusy: envToken }
}

async function defaultEffects(): Promise<CommandEffects> {
  const tz = commandSettings().timeZone
  return {
    googleAccess: async () => {
      const access = await googleAccess()
      return { write: access.write, freebusy: access.freebusy }
    },
    searchLeads: async (query) => {
      if (isDemoMode()) return []
      const data = (await fubGet(`/people?limit=100&sort=-updated&fields=id,name,stage,assignedTo,phones,lastActivity`)) as {
        people?: { id: number; name?: string; stage?: string; assignedTo?: string; lastActivity?: string; phones?: { value?: string }[] }[]
      } | null
      const needle = norm(query)
      return (data?.people ?? [])
        .filter((person) => person.name && norm(person.name).split(' ').some((part) => needle.includes(part) || part.includes(needle.split(' ')[0] ?? '')))
        .slice(0, 12)
        .map((person) => ({
          id: person.id,
          name: person.name ?? '',
          phone: e164(person.phones?.find((item) => item.value)?.value),
          stage: person.stage,
          assignedTo: person.assignedTo,
          lastActivity: person.lastActivity,
        }))
    },
    leadDetail: async (id) => {
      if (isDemoMode() || !id) return null
      const person = (await fubGet(`/people/${id}`)) as { id?: number; name?: string; stage?: string; assignedTo?: string; lastActivity?: string; phones?: { value?: string }[] } | null
      const notes = (await fubGet(`/notes?personId=${id}&limit=2`)) as { notes?: { body?: string }[] } | null
      const tasks = (await fubGet(`/tasks?personId=${id}&limit=5`)) as { tasks?: { name?: string; isCompleted?: boolean }[] } | null
      if (!person?.id) return null
      return {
        lead: {
          id: person.id,
          name: person.name ?? '',
          phone: e164(person.phones?.[0]?.value),
          stage: person.stage,
          assignedTo: person.assignedTo,
          lastActivity: person.lastActivity,
        },
        notes: (notes?.notes ?? []).map((note) => (note.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean),
        tasks: (tasks?.tasks ?? []).filter((task) => !task.isCompleted).map((task) => task.name ?? '').filter(Boolean),
      }
    },
    addNote: async (input) => {
      const mention = input.mentionUserId
        ? fubMentionNote({ body: input.body, mentionUserId: input.mentionUserId, mentionName: input.mentionName ?? 'Teammate' })
        : undefined
      await addNote({
        personId: input.personId,
        subject: mention?.subject ?? 'LoanPilot note',
        body: mention?.body ?? input.body,
        isHtml: Boolean(mention),
        mentionUserIds: mention?.mentionUserIds,
      })
    },
    createFubTask: async (input) => {
      await createTask({ personId: input.personId, personName: input.personName, name: input.title, dueDate: input.due, type: 'Follow Up' })
    },
    createPersonalTask: async (input) => {
      await createGoogleTask({ title: input.title, due: input.due })
    },
    assignLead: async (personId, userId) => {
      await assignPerson(personId, userId)
    },
    sendSms: async (input) => {
      await sendSmsIfConfigured(input)
    },
    listEvents: async (start, end) => {
      const { accessToken } = await resolveGoogleAccessToken()
      if (!accessToken) return []
      const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      })
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`)
      const data = (await res.json()) as { items?: { id?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; status?: string }[] }
      return (data.items ?? [])
        .filter((item) => item.id && item.start?.dateTime && item.status !== 'cancelled')
        .map((item) => ({
          id: item.id as string,
          summary: item.summary?.trim() || 'Busy',
          startIso: new Date(item.start?.dateTime ?? '').toISOString(),
          endIso: new Date(item.end?.dateTime ?? item.start?.dateTime ?? '').toISOString(),
        }))
    },
    createEvent: async (input) => {
      const created = await createCalendarEvent({
        summary: input.summary,
        description: input.description,
        startIso: input.start.toISOString(),
        endIso: input.end.toISOString(),
        attendees: input.guests,
        sendUpdates: input.guests.length ? 'all' : 'none',
      })
      return { id: created.id }
    },
    moveEvent: async (id, start, end) => {
      const { accessToken } = await resolveGoogleAccessToken()
      if (!accessToken) throw new Error('Google Calendar is not connected')
      const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(id)}?sendUpdates=all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { dateTime: start.toISOString(), timeZone: tz },
          end: { dateTime: end.toISOString(), timeZone: tz },
        }),
      })
      if (!res.ok) throw new Error(`Calendar update failed: ${res.status}`)
    },
    deleteEvent: async (id) => {
      const { accessToken } = await resolveGoogleAccessToken()
      if (!accessToken) throw new Error('Google Calendar is not connected')
      const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID', 'primary'))
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(id)}?sendUpdates=all`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok && res.status !== 204 && res.status !== 410) throw new Error(`Calendar delete failed: ${res.status}`)
    },
    freeBusy: async (start, end) => {
      const { accessToken } = await resolveGoogleAccessToken()
      if (!accessToken) return []
      const calendarId = env('GOOGLE_CALENDAR_ID', 'primary')
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: tz, items: [{ id: calendarId }] }),
      })
      if (!res.ok) throw new Error(`Free/busy failed: ${res.status}`)
      const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> }
      return (data.calendars?.[calendarId]?.busy ?? []).map((span) => ({ startIso: span.start, endIso: span.end }))
    },
    digestMisses: async () => {
      const today = zonedParts(new Date(), tz)
      const key = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`
      const tasks = await listOpenFubTasks()
      const overdue = tasks.filter((task) => task.due && task.due.slice(0, 10) < key).map((task) => task.title).slice(0, 5)
      if (isDemoMode()) return { tasks: overdue, calls: [], texts: [] }
      const calls = (await fubGet('/calls?limit=20')) as { calls?: { isIncoming?: boolean; outcome?: string; created?: string; person?: { name?: string } }[] } | null
      const texts = (await fubGet('/textMessages?limit=20')) as { textmessages?: { isIncoming?: boolean; message?: string; person?: { name?: string } }[] } | null
      const missedCalls = (calls?.calls ?? [])
        .filter((call) => call.isIncoming && ['missed', 'no answer', 'no-answer', 'unanswered'].includes((call.outcome ?? '').toLowerCase()))
        .slice(0, 3)
        .map((call) => call.person?.name || 'Unknown')
      const unanswered = (texts?.textmessages ?? []).filter((text) => text.isIncoming).slice(0, 3).map((text) => text.person?.name || 'Unknown')
      return { tasks: overdue, calls: missedCalls, texts: unanswered }
    },
  }
}

export async function deliverCommandReply(to: string, reply: string | undefined) {
  if (!reply) return
  await sendSmsIfConfigured({ to, content: reply })
}
