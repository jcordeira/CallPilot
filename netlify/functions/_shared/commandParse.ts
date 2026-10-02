import OpenAI from 'openai'
import { env } from './env'
import { teamRoster } from './teamRoster'

export type CommandRole = 'owner' | 'team'

export type CommandIntent =
  | 'book_call'
  | 'reschedule'
  | 'cancel'
  | 'text_team'
  | 'text_client'
  | 'today_digest'
  | 'lead_brief'
  | 'add_note'
  | 'create_task'
  | 'assign_lead'
  | 'availability'
  | 'busy_until'
  | 'request_booking'
  | 'help'
  | 'unknown'

export type CommandCall = {
  intent: CommandIntent
  clientName?: string
  topic?: string
  whenText?: string
  toWhenText?: string
  body?: string
  /** First name, or "team" for everyone. */
  who?: string
  personal?: boolean
  /** First name of a Follow Up Boss teammate. */
  assignee?: string
  /** Teammate first names to add on the calendar invite. */
  guests?: string[]
}

const OWNER_INTENTS: CommandIntent[] = [
  'book_call',
  'reschedule',
  'cancel',
  'text_team',
  'text_client',
  'today_digest',
  'lead_brief',
  'add_note',
  'create_task',
  'assign_lead',
  'availability',
  'busy_until',
  'help',
]

const TEAM_INTENTS: CommandIntent[] = ['availability', 'request_booking', 'lead_brief', 'add_note', 'create_task', 'help']

export function intentsForRole(role: CommandRole): CommandIntent[] {
  return role === 'owner' ? OWNER_INTENTS : TEAM_INTENTS
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function label(value: unknown): string | undefined {
  const text = str(value)?.toLowerCase().replace(/^the\s+/, '')
  if (!text) return undefined
  if (text === 'both' || text === 'all' || text === 'everyone') return 'team'
  return text
}

function guestsOf(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const names = raw.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  return names.length ? names : undefined
}

export function commandFromToolCall(name: string, args: unknown, role: CommandRole): CommandCall {
  const bag = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const intent = name as CommandIntent
  if (!intentsForRole(role).includes(intent)) return { intent: 'unknown' }
  return {
    intent,
    clientName: str(bag.clientName),
    topic: str(bag.topic),
    whenText: str(bag.whenText),
    toWhenText: str(bag.toWhenText),
    body: str(bag.body),
    who: label(bag.who),
    personal: bag.personal === true,
    assignee: label(bag.assignee),
    guests: guestsOf(bag.guests),
  }
}

const TOOL_DEFS: Record<CommandIntent, { description: string; properties: Record<string, unknown>; required?: string[] }> = {
  book_call: {
    description: 'Book a client call on Joseph\'s calendar. Example: book Siddick Chowdhury tomorrow 2pm refi call.',
    properties: {
      clientName: { type: 'string' },
      whenText: { type: 'string', description: 'Natural time such as tomorrow 2pm or Thu 3pm' },
      topic: { type: 'string', description: 'Short topic such as refi, purchase, preapproval, HELOC' },
      guests: { type: 'array', items: { type: 'string' }, description: 'Teammate first names to add on the invite. Example: ["Debra"]' },
    },
    required: ['clientName', 'whenText'],
  },
  reschedule: {
    description: 'Move an existing event. Example: move my 3pm to 4pm.',
    properties: {
      clientName: { type: 'string' },
      whenText: { type: 'string', description: 'Current time or event hint' },
      toWhenText: { type: 'string', description: 'New time' },
    },
    required: ['toWhenText'],
  },
  cancel: {
    description: 'Cancel an event. Always requires a later YES. Example: cancel Siddick\'s call.',
    properties: { clientName: { type: 'string' }, whenText: { type: 'string' } },
    required: ['clientName'],
  },
  text_team: {
    description: 'Text one teammate, or the whole team, immediately.',
    properties: { who: { type: 'string', description: 'First name, or team' }, body: { type: 'string' } },
    required: ['who', 'body'],
  },
  text_client: {
    description: 'Draft an SMS to a lead. Do not send until the user replies YES.',
    properties: { clientName: { type: 'string' }, body: { type: 'string' } },
    required: ['clientName', 'body'],
  },
  today_digest: {
    description: 'What is on today: calendar, overdue tasks, missed calls and texts.',
    properties: {},
  },
  lead_brief: {
    description: 'Short brief on a lead. Example: brief Rakesh.',
    properties: { clientName: { type: 'string' } },
    required: ['clientName'],
  },
  add_note: {
    description: 'Add a Follow Up Boss note on a lead.',
    properties: { clientName: { type: 'string' }, body: { type: 'string' } },
    required: ['clientName', 'body'],
  },
  create_task: {
    description: 'Create a Follow Up Boss task, or a personal Google Task when personal is true.',
    properties: {
      clientName: { type: 'string' },
      body: { type: 'string', description: 'Task title' },
      whenText: { type: 'string', description: 'Due time if given' },
      personal: { type: 'boolean' },
    },
    required: ['body'],
  },
  assign_lead: {
    description: 'Reassign a lead to a teammate who is a Follow Up Boss user. Confirm before doing it.',
    properties: { clientName: { type: 'string' }, assignee: { type: 'string', description: 'First name of a Follow Up Boss teammate' } },
    required: ['clientName', 'assignee'],
  },
  availability: {
    description: 'List open 30-minute slots. Example: when is Joe free Thursday?',
    properties: { whenText: { type: 'string', description: 'Day such as Thursday or tomorrow. Omit for the next working day.' } },
  },
  busy_until: {
    description: 'Hold calls until a time. Example: hold calls till 2.',
    properties: { whenText: { type: 'string' } },
    required: ['whenText'],
  },
  request_booking: {
    description: 'Ask Joseph to approve a booking. Example: book Joe with Rakesh Thu 3pm.',
    properties: {
      clientName: { type: 'string' },
      whenText: { type: 'string' },
      topic: { type: 'string' },
      guests: { type: 'array', items: { type: 'string' }, description: 'Teammate first names to add on the invite once Joseph approves.' },
    },
    required: ['clientName', 'whenText'],
  },
  help: { description: 'List what this sender can ask.', properties: {} },
  unknown: { description: 'Use only when the text is not a command.', properties: {} },
}

function rosterHint(): string {
  const members = teamRoster()
  if (!members.length) return 'No teammates are configured.'
  return members
    .map((member) => {
      const bits = [member.name]
      if (member.title) bits.push(member.title)
      if (!member.userId) bits.push('not in Follow Up Boss')
      return bits.join(', ')
    })
    .join('; ')
}

export function toolSchema(role: CommandRole): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const names = teamRoster().map((member) => member.name.split(' ')[0]).filter(Boolean)
  const fubNames = teamRoster().filter((member) => member.userId).map((member) => member.name.split(' ')[0])
  return intentsForRole(role).map((intent) => {
    const spec = TOOL_DEFS[intent]
    const description =
      intent === 'text_team'
        ? `Text a teammate immediately. who is a first name (${names.join(', ') || 'a teammate'}) or "team". Example: text ${names[0] ?? 'Frankie'}: pull the appraisal.`
        : intent === 'assign_lead'
          ? `Reassign a lead to ${fubNames.join(' or ') || 'a Follow Up Boss teammate'}. Confirm before doing it. Skip teammates who are not Follow Up Boss users.`
          : intent === 'book_call'
            ? `Book a client call on Joseph's calendar. guests lists teammate first names to invite, such as ${names.at(-1) ?? 'a teammate'}.`
            : spec.description
    return {
      type: 'function',
      function: {
        name: intent,
        description,
        parameters: {
          type: 'object',
          properties: spec.properties,
          required: spec.required ?? [],
          additionalProperties: false,
        },
      },
    }
  })
}

export type ToolCompletion = (text: string, role: CommandRole) => Promise<{ name: string; arguments: Record<string, unknown> }>

/** Tool-calling model the Netlify AI Gateway serves. Grok ids are not on that gateway. */
export const GATEWAY_COMMAND_MODEL = 'gpt-4o-mini'

function usingOpenRouter(): boolean {
  return Boolean(env('OPENROUTER_API_KEY').trim() || env('OPENROUTER_BASE_URL').trim())
}

/**
 * Netlify injects OPENAI_BASE_URL and OPENAI_API_KEY (or NETLIFY_AI_GATEWAY_*)
 * into functions when AI Gateway is on. No provider key is stored in env.
 * OpenRouter is only used when those vars are set explicitly.
 */
export function commandClient(): OpenAI | null {
  if (usingOpenRouter()) {
    return new OpenAI({
      apiKey: env('OPENROUTER_API_KEY').trim() || env('OPENAI_API_KEY').trim() || 'unused',
      baseURL: env('OPENROUTER_BASE_URL').trim() || undefined,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'HTTP-Referer': env('URL', 'https://loanpilot.netlify.app'),
        'X-Title': 'LoanPilot',
      },
    })
  }
  const baseURL = env('NETLIFY_AI_GATEWAY_BASE_URL').trim() || env('OPENAI_BASE_URL').trim()
  const apiKey = env('NETLIFY_AI_GATEWAY_KEY').trim() || env('OPENAI_API_KEY').trim()
  if (!baseURL && !apiKey) return null
  return new OpenAI({ apiKey: apiKey || 'unused', baseURL: baseURL || undefined, dangerouslyAllowBrowser: true })
}

export function commandModel(): string {
  const explicit = env('COMMAND_MODEL').trim()
  if (explicit) return explicit
  if (usingOpenRouter()) return env('ASSISTANT_MODEL').trim() || 'x-ai/grok-4.5'
  return GATEWAY_COMMAND_MODEL
}

export async function completeWithGateway(text: string, role: CommandRole): Promise<{ name: string; arguments: Record<string, unknown> }> {
  const client = commandClient()
  if (!client) throw new Error('Command mode needs the Netlify AI Gateway or OPENAI_API_KEY')
  const completion = await client.chat.completions.create({
    model: commandModel(),
    temperature: 0,
    tool_choice: 'required',
    tools: toolSchema(role),
    messages: [
      {
        role: 'system',
        content:
          `You route LoanPilot SMS commands. Call exactly one tool. Copy names and times from the text. Do not invent a client. Team senders cannot book, cancel, text clients, or text the team; use request_booking to ask Joseph. Teammates: ${rosterHint()}. For text_team, set who to a first name or "team". When the owner says to add someone to a booking, put those first names in guests.`,
      },
      { role: 'user', content: text },
    ],
  })
  const call = completion.choices[0]?.message?.tool_calls?.[0]
  if (!call || call.type !== 'function') throw new Error('The model did not call a tool')
  let args: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(call.function.arguments || '{}') as unknown
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
  } catch {
    args = {}
  }
  return { name: call.function.name, arguments: args }
}

/** One short completion so a signed-in Hub session can confirm the gateway answers. */
export async function probeCommandGateway(): Promise<{ ok: boolean; model: string; reply?: string; error?: string }> {
  const model = commandModel()
  const client = commandClient()
  if (!client) return { ok: false, model, error: 'Command mode needs the Netlify AI Gateway or OPENAI_API_KEY' }
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word ok.' }],
    })
    const reply = (completion.choices[0]?.message?.content ?? '').trim().slice(0, 80)
    return reply ? { ok: true, model, reply } : { ok: false, model, error: 'The gateway returned an empty reply' }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'gateway failed'
    return { ok: false, model, error: message.slice(0, 400) }
  }
}

export async function parseCommand(text: string, role: CommandRole, complete: ToolCompletion = completeWithGateway): Promise<CommandCall> {
  const result = await complete(text, role)
  return commandFromToolCall(result.name, result.arguments, role)
}
