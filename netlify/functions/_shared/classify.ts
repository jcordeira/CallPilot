import type { AssistantSettings, IncomingMessage, SenderKind } from './types'

const OPS_SUBJECT_HINTS = [
  /conditions?\s+(cleared|outstanding)/i,
  /underwriting\s+(update|decision)/i,
  /clear\s+to\s+close/i,
  /funding\s+(date|wire)/i,
  /docs?\s+out/i,
  /appraisal\s+(ordered|received|reviewed)/i,
  /title\s+(commitment|objection)/i,
  /internal\s+only/i,
]

const LEAD_HINTS = [
  /pre-?approv/i,
  /pre-?qual/i,
  /mortgage/i,
  /home\s+loan/i,
  /interest\s+rate/i,
  /refinance|refi\b/i,
  /first[- ]time\s+buyer/i,
  /down\s+payment/i,
  /looking\s+to\s+(buy|purchase)/i,
  /can\s+i\s+(afford|qualify)/i,
  /what\s+documents/i,
]

export function classifySender(
  message: IncomingMessage,
  settings: AssistantSettings,
  fubIsLead?: boolean | null,
): SenderKind {
  if (fubIsLead === true) return 'lead'
  if (fubIsLead === false) return 'ops'

  const email = (message.fromEmail ?? '').toLowerCase()
  const domain = email.includes('@') ? email.split('@')[1] : ''

  for (const blocked of settings.opsEmailBlocklist) {
    if (email.includes(blocked.toLowerCase())) return 'ops'
  }
  for (const blocked of settings.opsDomainBlocklist) {
    const b = blocked.toLowerCase()
    if (domain.includes(b) || email.includes(b)) return 'ops'
  }

  const subject = message.subject ?? ''
  if (OPS_SUBJECT_HINTS.some((re) => re.test(subject) || re.test(message.body))) {
    return 'ops'
  }

  if (LEAD_HINTS.some((re) => re.test(subject) || re.test(message.body))) {
    return 'lead'
  }

  // SMS from unknown numbers defaults to lead (ops rarely text LO mobiles via Quo)
  if (message.channel === 'sms' && message.fromPhone) return 'lead'

  return 'unknown'
}

export function shouldAutoRespond(
  kind: SenderKind,
  settings: AssistantSettings,
): { ok: boolean; reason?: string } {
  if (!settings.autoReplyEnabled) return { ok: false, reason: 'Auto-reply is paused' }
  if (settings.leadOnly && kind === 'ops') {
    return { ok: false, reason: 'Sender classified as operations — not a lead' }
  }
  if (settings.leadOnly && kind === 'unknown') {
    return { ok: false, reason: 'Sender not confirmed as a lead — escalate for human review' }
  }
  return { ok: true }
}
