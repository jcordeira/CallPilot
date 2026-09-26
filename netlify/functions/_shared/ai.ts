import OpenAI from 'openai'
import { env, isDemoMode } from './env'
import { MORTGAGE_KNOWLEDGE, type StructuredAiResult } from './knowledge'
import type { AssistantSettings, IncomingMessage } from './types'

function buildSystemPrompt(settings: AssistantSettings): string {
  const sig =
    settings.signature ||
    `${settings.loanOfficerName}${settings.nmls ? ` | NMLS ${settings.nmls}` : ''}\n${settings.companyName}`

  const engine =
    settings.aiProvider === 'grok'
      ? 'You are LoanPilot, a mortgage loan-officer assistant powered by Grok (xAI).'
      : 'You are LoanPilot, a mortgage loan-officer assistant.'

  return `${engine}

${MORTGAGE_KNOWLEDGE}

Loan officer: ${settings.loanOfficerName}
Company: ${settings.companyName}
${settings.nmls ? `NMLS: ${settings.nmls}` : ''}

Tone: ${settings.tone.replace('_', ' ')}. Keep SMS under 320 characters when channel is sms.
Always sound human and helpful. Mention that ${settings.loanOfficerName} will personally follow up when needed.
Unavailable note to weave in when appropriate: "${settings.unavailableMessage}"
Sign email replies with:
${sig}

Respond with JSON only:
{
  "canAnswer": boolean,
  "replyBody": string,
  "escalateReason": string | null,
  "needsAppointment": boolean,
  "appointmentHint": string | null,
  "needsFollowUpTask": boolean,
  "taskTitle": string | null,
  "confidence": number
}`
}

function demoResult(message: IncomingMessage, settings: AssistantSettings): StructuredAiResult {
  const text = `${message.subject ?? ''} ${message.body}`.toLowerCase()
  const escalateHit = settings.escalateKeywords.find((k) => text.includes(k.toLowerCase()))
  if (escalateHit) {
    return {
      canAnswer: false,
      replyBody: '',
      escalateReason: `Sensitive topic detected: ${escalateHit}`,
      needsFollowUpTask: true,
      taskTitle: `Urgent lead follow-up: ${escalateHit}`,
      confidence: 0.9,
    }
  }

  const wantsAppt = /call|meet|appointment|schedule|available|tomorrow|monday|tuesday|wednesday|thursday|friday/.test(
    text,
  )
  const docs = /document|paperwork|w-?2|pay stub|bank statement|what do i need/.test(text)
  const rates = /rate|apr|payment|qualify|pre-?approv|pre-?qual|how much/.test(text)

  let replyBody: string
  if (message.channel === 'sms') {
    if (docs) {
      replyBody = `Hi! For pre-approval we usually need ID, recent pay stubs, W-2s, and 2 months of bank statements. ${settings.loanOfficerName} will confirm what's needed for your situation shortly.`
    } else if (rates) {
      replyBody = `Thanks for reaching out! Rates and payments depend on credit, loan type, and timing — I don't quote binding numbers by text. ${settings.loanOfficerName} will follow up ASAP. Want a quick call?`
    } else {
      replyBody = `Thanks for your message — ${settings.loanOfficerName} is briefly tied up and will get back to you soon. Anything time-sensitive?`
    }
  } else {
    const greeting = message.fromName ? `Hi ${message.fromName.split(' ')[0]},` : 'Hi,'
    if (docs) {
      replyBody = `${greeting}\n\nThanks for asking. For a typical pre-approval we start with a government ID, recent pay stubs, W-2s (or tax returns if self-employed), and about two months of bank statements. ${settings.loanOfficerName} will confirm the exact list for your file.\n\n${settings.unavailableMessage}\n\n— ${settings.loanOfficerName}`
    } else if (rates) {
      replyBody = `${greeting}\n\nAppreciate you reaching out. I can share general process guidance, but I won't quote a locked rate or payment over email — those depend on credit, loan program, property, and market timing.\n\n${settings.unavailableMessage} If you'd like, reply with a few windows that work for a call and we'll get something on the calendar.\n\n— ${settings.loanOfficerName}`
    } else {
      replyBody = `${greeting}\n\nThanks for your email — I've got it. ${settings.unavailableMessage}\n\nIf you share what you're looking to do (purchase, refinance, or pre-approval) and your preferred timeline, we can take the next step quickly.\n\n— ${settings.loanOfficerName}`
    }
  }

  return {
    canAnswer: true,
    replyBody,
    needsAppointment: wantsAppt,
    appointmentHint: wantsAppt ? 'Lead requested a call — propose times' : undefined,
    needsFollowUpTask: true,
    taskTitle: wantsAppt ? 'Schedule call with lead' : 'Review AI reply / follow up with lead',
    confidence: docs || rates ? 0.82 : 0.7,
  }
}

function parseAiJson(raw: string): StructuredAiResult {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(cleaned) as StructuredAiResult
  return {
    canAnswer: Boolean(parsed.canAnswer),
    replyBody: String(parsed.replyBody ?? ''),
    escalateReason: parsed.escalateReason ?? undefined,
    needsAppointment: Boolean(parsed.needsAppointment),
    appointmentHint: parsed.appointmentHint ?? undefined,
    needsFollowUpTask: Boolean(parsed.needsFollowUpTask),
    taskTitle: parsed.taskTitle ?? undefined,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  }
}

/** Grok (xAI) is reached through Netlify AI Gateway → OpenRouter. */
function createChatClient(provider: AssistantSettings['aiProvider']): OpenAI {
  if (provider === 'grok') {
    const baseURL = env('OPENROUTER_BASE_URL') || undefined
    const apiKey = env('OPENROUTER_API_KEY') || env('OPENAI_API_KEY') || 'unused'
    return new OpenAI({
      baseURL,
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': env('URL', 'https://loanpilot.netlify.app'),
        'X-Title': 'LoanPilot',
      },
    })
  }
  // OpenAI path — Netlify injects OPENAI_BASE_URL + OPENAI_API_KEY
  return new OpenAI()
}

function resolveModel(settings: AssistantSettings): string {
  const fromEnv = env('ASSISTANT_MODEL')
  if (fromEnv) return fromEnv
  if (settings.aiModel) return settings.aiModel
  return settings.aiProvider === 'grok' ? 'x-ai/grok-4.5' : 'gpt-4o-mini'
}

function gatewayReady(provider: AssistantSettings['aiProvider']): boolean {
  if (provider === 'grok') {
    return Boolean(env('OPENROUTER_BASE_URL') || env('OPENROUTER_API_KEY') || env('OPENAI_BASE_URL'))
  }
  return Boolean(env('OPENAI_BASE_URL') || process.env.OPENAI_API_KEY)
}

export async function generateReply(
  message: IncomingMessage,
  settings: AssistantSettings,
): Promise<StructuredAiResult> {
  const provider = settings.aiProvider ?? 'grok'
  // Demo / local without gateway: deterministic mortgage replies (still exercises lead/ops logic).
  if (isDemoMode() && !gatewayReady(provider)) {
    return demoResult(message, settings)
  }

  try {
    const client = createChatClient(provider)
    const model = resolveModel(settings)
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(settings) },
        {
          role: 'user',
          content: JSON.stringify({
            channel: message.channel,
            fromName: message.fromName,
            fromEmail: message.fromEmail,
            fromPhone: message.fromPhone,
            subject: message.subject,
            body: message.body,
          }),
        },
      ],
    })
    const content = completion.choices[0]?.message?.content
    if (!content) return demoResult(message, settings)
    return parseAiJson(content)
  } catch {
    return demoResult(message, settings)
  }
}
