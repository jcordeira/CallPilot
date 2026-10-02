import OpenAI from 'openai'
import { env } from './env'

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
  who?: 'frankie' | 'daniel' | 'both'
  personal?: boolean
  assignee?: 'frankie' | 'daniel'
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

function who(value: unknown): CommandCall['who'] {
  const text = str(value)?.toLowerCase()
  if (text === 'frankie' || text === 'frank' || text === '16') return 'frankie'
  if (text === 'daniel' || text === '27') return 'daniel'
  if (text === 'both' || text === 'team') return 'both'
  return undefined
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
    who: who(bag.who ?? bag.assignee),
    personal: bag.personal === true,
    assignee: who(bag.assignee) === 'both' ? undefined : (who(bag.assignee) as CommandCall['assignee']),
  }
}

const TOOL_DEFS: Record<CommandIntent, { description: string; properties: Record<string, unknown>; required?: string[] }> = {
  book_call: {
    description: 'Book a client call on Joseph\'s calendar. Example: book Siddick Chowdhury tomorrow 2pm refi call.',
    properties: {
      clientName: { type: 'string' },
      whenText: { type: 'string', description: 'Natural time such as tomorrow 2pm or Thu 3pm' },
      topic: { type: 'string', description: 'Short topic such as refi, purchase, preapproval, HELOC' },
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
    description: 'Text Frankie, Daniel, or both immediately. Example: text Frankie: pull appraisal for Barua.',
    properties: { who: { type: 'string', enum: ['frankie', 'daniel', 'both'] }, body: { type: 'string' } },
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
    description: 'Reassign a lead to Frankie or Daniel. Confirm before doing it.',
    properties: { clientName: { type: 'string' }, assignee: { type: 'string', enum: ['frankie', 'daniel'] } },
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
    },
    required: ['clientName', 'whenText'],
  },
  help: { description: 'List what this sender can ask.', properties: {} },
  unknown: { description: 'Use only when the text is not a command.', properties: {} },
}

export function toolSchema(role: CommandRole): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return intentsForRole(role).map((intent) => {
    const spec = TOOL_DEFS[intent]
    return {
      type: 'function',
      function: {
        name: intent,
        description: spec.description,
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

function commandClient(): OpenAI | null {
  const openAiKey = env('OPENAI_API_KEY').trim()
  const model = env('COMMAND_MODEL').trim()
  const gatewayKey = env('OPENROUTER_API_KEY').trim()
  const gatewayBase = env('OPENROUTER_BASE_URL').trim()
  const preferOpenAi = model.startsWith('gpt') || (Boolean(openAiKey) && !gatewayKey && !gatewayBase)
  if (preferOpenAi && openAiKey) {
    return new OpenAI({ apiKey: openAiKey, baseURL: env('OPENAI_BASE_URL').trim() || undefined })
  }
  if (!gatewayKey && !gatewayBase && !openAiKey) return null
  return new OpenAI({
    apiKey: gatewayKey || openAiKey || 'unused',
    baseURL: gatewayBase || undefined,
    defaultHeaders: {
      'HTTP-Referer': env('URL', 'https://loanpilot.netlify.app'),
      'X-Title': 'LoanPilot',
    },
  })
}

export function commandModel(): string {
  return env('COMMAND_MODEL').trim() || env('ASSISTANT_MODEL').trim() || 'x-ai/grok-4.5'
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
          'You route LoanPilot SMS commands. Call exactly one tool. Copy names and times from the text. Do not invent a client. Team senders cannot book, cancel, text clients, or text the team; use request_booking to ask Joseph.',
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

export async function parseCommand(text: string, role: CommandRole, complete: ToolCompletion = completeWithGateway): Promise<CommandCall> {
  const result = await complete(text, role)
  return commandFromToolCall(result.name, result.arguments, role)
}
