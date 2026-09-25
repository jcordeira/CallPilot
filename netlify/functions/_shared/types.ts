export type Channel = 'gmail' | 'neo' | 'sms'

export type SenderKind = 'lead' | 'ops' | 'unknown'

export type ReplyDecision =
  | { action: 'reply'; body: string; confidence: number }
  | { action: 'escalate'; reason: string; draft?: string }
  | { action: 'skip'; reason: string }

export type IncomingMessage = {
  id: string
  channel: Channel
  threadId?: string
  fromEmail?: string
  fromPhone?: string
  fromName?: string
  subject?: string
  body: string
  receivedAt: string
}

export type ActivityItem = {
  id: string
  at: string
  channel: Channel
  from: string
  subject?: string
  senderKind: SenderKind
  decision: 'replied' | 'escalated' | 'skipped' | 'task_created' | 'appointment_created'
  summary: string
  replyPreview?: string
  fubPersonId?: number
  fubTaskId?: number
  calendarEventId?: string
}

export type AssistantSettings = {
  autoReplyEnabled: boolean
  draftOnly: boolean
  channels: { gmail: boolean; neo: boolean; sms: boolean }
  leadOnly: boolean
  opsDomainBlocklist: string[]
  opsEmailBlocklist: string[]
  escalateKeywords: string[]
  signature: string
  tone: 'warm_professional' | 'brief' | 'friendly'
  createFubTasks: boolean
  createCalendarEvents: boolean
  unavailableMessage: string
  loanOfficerName: string
  companyName: string
  nmls?: string
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  autoReplyEnabled: true,
  draftOnly: true,
  channels: { gmail: true, neo: true, sms: true },
  leadOnly: true,
  opsDomainBlocklist: [
    'title.com',
    'escrow.com',
    'underwriting.',
    'closing.',
    'docutech',
    'blend.com',
    'roostify.com',
    'ice.com',
    'EllieMae',
    'encompass',
  ],
  opsEmailBlocklist: [
    'noreply@',
    'no-reply@',
    'notifications@',
    'donotreply@',
    'ops@',
    'underwriting@',
    'closing@',
    'title@',
    'escrow@',
  ],
  escalateKeywords: [
    'rate lock',
    'lock extension',
    'adverse',
    'denial',
    'denied',
    'lawsuit',
    'attorney',
    'complaint',
    'ssn',
    'social security',
    'wire instruction',
    'wiring',
    'account number',
    'routing number',
  ],
  signature: '',
  tone: 'warm_professional',
  createFubTasks: true,
  createCalendarEvents: true,
  unavailableMessage:
    "Thanks for reaching out — I'm briefly tied up and will follow up personally soon. In the meantime I've noted your message.",
  loanOfficerName: 'Your Loan Officer',
  companyName: 'Your Mortgage Team',
  nmls: undefined,
}
