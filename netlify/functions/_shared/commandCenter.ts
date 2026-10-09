import { getStore } from '@netlify/blobs'
import {
  type CommandEffects,
  commandActors,
  commandSettings,
  handleCommandMessage,
  pendingPrompt,
  type PendingPrompt,
} from './commandMode'
import type { ToolCompletion } from './commandParse'
import { loadCommandState, type CommandLog } from './commandStore'
import { env, isDemoMode } from './env'
import { fubGet } from './followupboss'
import { listQuoMessages, sendSmsIfConfigured, type QuoHistoryMessage } from './quo'
import { teamRoster } from './teamRoster'

export type CommandThreadItem = {
  id: string
  at: string
  actor: string
  role: 'owner' | 'team'
  source: 'hub' | 'sms'
  command: string
  reply: string
  status: CommandLog['status']
  dryRun: boolean
}

export type HubText = {
  id: string
  at: string
  phone: string
  name: string
  direction: 'in' | 'out'
  text: string
}

type TextState = { sent: HubText[] }

let texts: TextState = { sent: [] }

function textStore() {
  try {
    return getStore('loanpilot-quo-messages')
  } catch {
    return null
  }
}

export async function resetCommandCenterForTests() {
  texts = { sent: [] }
  const blob = textStore()
  if (!blob) return
  try {
    await blob.delete('sent')
  } catch {
    /* memory */
  }
}

async function loadTexts(): Promise<HubText[]> {
  const blob = textStore()
  if (blob) {
    try {
      const raw = (await blob.get('sent', { type: 'json' })) as TextState | null
      if (raw && Array.isArray(raw.sent)) {
        texts = { sent: raw.sent.slice(0, 200) }
        return [...texts.sent]
      }
    } catch {
      /* memory */
    }
  }
  return [...texts.sent]
}

async function saveTexts(sent: HubText[]) {
  texts = { sent: sent.slice(0, 200) }
  const blob = textStore()
  if (!blob) return
  try {
    await blob.setJSON('sent', texts)
  } catch {
    /* memory */
  }
}

function e164(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+') && digits.length >= 8) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return undefined
}

function owner() {
  return commandActors().find((actor) => actor.role === 'owner')
}

export function commandChips(): { label: string; text: string; send: boolean }[] {
  return [
    { label: "What's on today", text: "what's on today", send: true },
    { label: 'My availability', text: 'when am I free today', send: true },
    { label: 'Text team', text: 'text the team: ', send: false },
    { label: 'Hold calls', text: 'hold calls till ', send: false },
    { label: 'Help', text: 'help', send: true },
  ]
}

function threadItem(log: CommandLog): CommandThreadItem {
  return {
    id: log.id,
    at: log.at,
    actor: log.actor,
    role: log.role,
    source: log.source === 'hub' ? 'hub' : 'sms',
    command: log.command,
    reply: log.summary,
    status: log.status,
    dryRun: log.dryRun,
  }
}

export async function getCommandCenter(now = new Date()): Promise<{
  enabled: boolean
  dryRun: boolean
  ownerName: string
  team: { name: string; phone: string; title?: string }[]
  thread: CommandThreadItem[]
  pending: PendingPrompt | null
  chips: { label: string; text: string; send: boolean }[]
}> {
  const settings = commandSettings()
  const state = await loadCommandState()
  const joseph = owner()
  const pending = joseph
    ? pendingPrompt([...state.pending].reverse().find((item) => item.phone === joseph.phone && new Date(item.expiresAt).getTime() > now.getTime()))
    : null
  return {
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    ownerName: joseph?.name || env('FUB_LO_NAME', 'Joseph'),
    team: teamRoster().map((member) => ({ name: member.name, phone: member.phone, title: member.title })),
    thread: [...state.recent].reverse().map(threadItem),
    pending,
    chips: commandChips(),
  }
}

function withPrefix(body: string): string {
  const prefix = commandSettings().prefix
  if (!prefix) return body
  if (body.toLowerCase().startsWith(prefix.toLowerCase())) return body
  return `${prefix} ${body}`.trim()
}

export async function postCommandCenter(input: {
  text?: string
  choice?: string
  now?: Date
  parse?: ToolCompletion
  effects?: CommandEffects
}): Promise<{
  enabled: boolean
  dryRun: boolean
  ownerName: string
  team: { name: string; phone: string; title?: string }[]
  thread: CommandThreadItem[]
  pending: PendingPrompt | null
  chips: { label: string; text: string; send: boolean }[]
  reply?: string
  error?: string
}> {
  const now = input.now ?? new Date()
  const settings = commandSettings()
  if (!settings.enabled) {
    return { ...(await getCommandCenter(now)), error: 'Command mode is off.' }
  }
  const joseph = owner()
  if (!joseph) {
    return { ...(await getCommandCenter(now)), error: 'Set FUB_LO_PHONE so the Hub can act as Joseph.' }
  }
  const raw = (input.choice ?? input.text ?? '').trim()
  if (!raw) return { ...(await getCommandCenter(now)), error: 'Type a command.' }
  const result = await handleCommandMessage({
    from: joseph.phone,
    to: settings.line,
    body: withPrefix(raw),
    messageId: `hub-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    now,
    parse: input.parse,
    effects: input.effects,
    source: 'hub',
  })
  const view = await getCommandCenter(now)
  if (result.ignored === 'disabled') return { ...view, error: 'Command mode is off.' }
  if (result.ignored) return { ...view, error: 'That command was not accepted.' }
  return { ...view, reply: result.reply, pending: result.pending ?? view.pending }
}

export async function searchMessageLeads(query: string): Promise<{ id: number; name: string; phone?: string; stage?: string }[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2 || isDemoMode()) return []
  const data = (await fubGet('/people?limit=50&sort=-updated&fields=id,name,stage,phones')) as {
    people?: { id: number; name?: string; stage?: string; phones?: { value?: string }[] }[]
  } | null
  return (data?.people ?? [])
    .filter((person) => person.name && person.name.toLowerCase().includes(needle.split(' ')[0] ?? needle))
    .slice(0, 8)
    .map((person) => ({
      id: person.id,
      name: person.name ?? '',
      phone: e164(person.phones?.find((item) => item.value)?.value),
      stage: person.stage,
    }))
}

export async function listContactMessages(phone: string): Promise<{ messages: QuoHistoryMessage[]; quoError?: string }> {
  const normalized = e164(phone)
  if (!normalized) return { messages: [] }
  const local = (await loadTexts()).filter((item) => item.phone === normalized)
  let remote: QuoHistoryMessage[] = []
  let quoError: string | undefined
  try {
    remote = await listQuoMessages(normalized)
  } catch (err) {
    quoError = err instanceof Error && err.message ? err.message : 'Could not load Quo messages'
  }
  const byId = new Map<string, QuoHistoryMessage>()
  for (const item of [...remote, ...local]) byId.set(item.id, item)
  const messages = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-40)
  return quoError ? { messages, quoError } : { messages }
}

export async function sendHubText(input: {
  to: string
  name?: string
  content: string
  kind: 'team' | 'lead'
  confirmed?: boolean
}): Promise<{ sent: true; id: string } | { sent: false; needsConfirm?: boolean; preview?: string; error?: string }> {
  const content = input.content.trim()
  if (!content) return { sent: false, error: 'Write a message.' }
  const phone = e164(input.to)
  if (!phone) return { sent: false, error: 'That number is not valid.' }
  const name = (input.name || '').trim() || phone
  if (input.kind === 'team') {
    if (!teamRoster().some((member) => member.phone === phone)) return { sent: false, error: 'Pick someone on the team.' }
  } else if (input.kind === 'lead') {
    if (input.confirmed !== true) {
      return { sent: false, needsConfirm: true, preview: `Text ${name}: ${content}` }
    }
  } else {
    return { sent: false, error: 'Pick a team member or a lead.' }
  }
  const result = await sendSmsIfConfigured({
    to: phone,
    content,
    priority: 'high',
    truncate: input.kind === 'lead' ? 'exempt' : 'auto',
    truncateStyle: 'hub',
  })
  if ('skipped' in result) {
    if (result.skipped === 'budget') return { sent: false, error: 'Daily text limit reached.' }
    return { sent: false, error: 'Quo is not configured.' }
  }
  const sent = await loadTexts()
  await saveTexts([
    { id: result.id, at: new Date().toISOString(), phone, name, direction: 'out', text: content },
    ...sent,
  ])
  return { sent: true, id: result.id }
}
