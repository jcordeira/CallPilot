import { generateReply } from './ai'
import { holdFollowUpSlot } from './calendar'
import { classifySender, shouldAutoRespond } from './classify'
import { addNote, createTask, findPersonByEmail, findPersonByPhone, personLooksLikeLead } from './followupboss'
import { publishLeadScore } from './leadHeat'
import { scoreLead } from './leadScore'
import { createDraftReply, sendReply } from './gmail'
import { sendNeoReply } from './neo'
import { sendSms } from './quo'
import { appendActivity } from './store'
import { loanOfficer } from './team'
import type { ActivityItem, AssistantSettings, IncomingMessage } from './types'

export type ProcessResult = {
  activity: ActivityItem
  replyBody?: string
}

async function recordLeadHeat(
  message: IncomingMessage,
  person: { id: number; name?: string; stage?: string; tags?: string[] },
  options: { escalate: boolean; needsAppointment: boolean; taskName?: string },
): Promise<number | undefined> {
  const personName = person.name || message.fromName || 'Lead'
  const result = scoreLead({
    stage: person.stage,
    tags: person.tags,
    recentText: `${message.subject ?? ''}\n${message.body}`,
    lastInboundAt: message.receivedAt,
    lastContactAt: message.receivedAt,
    appointmentRequested: options.needsAppointment,
    now: new Date(),
  })
  const saved = await publishLeadScore({
    personId: person.id,
    personName,
    result,
    stage: person.stage,
    escalate: options.escalate,
    taskName: options.taskName,
    taskType: options.needsAppointment && !options.escalate ? 'Appointment' : undefined,
    now: new Date(),
  })
  return saved?.taskId
}

export async function processIncomingMessage(
  message: IncomingMessage,
  settings: AssistantSettings,
): Promise<ProcessResult> {
  let person =
    (message.fromEmail ? await findPersonByEmail(message.fromEmail) : null) ??
    (message.fromPhone ? await findPersonByPhone(message.fromPhone) : null)

  const fubLead = personLooksLikeLead(person)
  const senderKind = classifySender(message, settings, fubLead)
  const gate = shouldAutoRespond(senderKind, settings)

  const baseActivity = {
    id: `act-${message.id}-${Date.now()}`,
    at: new Date().toISOString(),
    channel: message.channel,
    from: message.fromEmail ?? message.fromPhone ?? message.fromName ?? 'unknown',
    subject: message.subject,
    senderKind,
    fubPersonId: person?.id,
  }

  if (!gate.ok) {
    const activity: ActivityItem = {
      ...baseActivity,
      decision: 'skipped',
      summary: gate.reason ?? 'Skipped',
    }
    await appendActivity(activity)
    return { activity }
  }

  const ai = await generateReply(message, settings)

  if (!ai.canAnswer || !ai.replyBody) {
    let fubTaskId: number | undefined
    if (settings.createFubTasks && person) {
      fubTaskId = await recordLeadHeat(message, person, {
        escalate: true,
        needsAppointment: Boolean(ai.needsAppointment),
        taskName: ai.taskTitle ?? `Human follow-up needed: ${message.subject ?? 'lead message'}`,
      })
      await addNote({
        personId: person.id,
        subject: 'LoanPilot — escalated (no safe auto-reply)',
        body: ai.escalateReason ?? 'Assistant could not answer confidently.',
      })
    }
    const activity: ActivityItem = {
      ...baseActivity,
      decision: 'escalated',
      summary: ai.escalateReason ?? 'Needs human reply',
      fubTaskId,
    }
    await appendActivity(activity)
    return { activity }
  }

  // Send or draft on the right channel
  if (message.channel === 'gmail') {
    const to = message.fromEmail ?? ''
    const subject = message.subject ?? 'Your mortgage question'
    if (settings.draftOnly) {
      await createDraftReply({ to, subject, body: ai.replyBody, threadId: message.threadId ?? message.id })
    } else {
      await sendReply({ to, subject, body: ai.replyBody, threadId: message.threadId ?? message.id })
    }
  } else if (message.channel === 'neo') {
    await sendNeoReply({
      to: message.fromEmail ?? '',
      subject: message.subject ?? 'Your mortgage question',
      body: ai.replyBody,
    })
  } else if (message.channel === 'sms' && message.fromPhone) {
    if (!settings.draftOnly) {
      await sendSms({ to: message.fromPhone, content: ai.replyBody })
    }
  }

  let fubTaskId: number | undefined
  let calendarEventId: string | undefined
  let decision: ActivityItem['decision'] = 'replied'

  if (settings.createFubTasks && person) {
    fubTaskId = await recordLeadHeat(message, person, {
      escalate: false,
      needsAppointment: Boolean(ai.needsAppointment),
      taskName: ai.taskTitle ?? 'Review AI lead reply',
    })
    await addNote({
      personId: person.id,
      subject: settings.draftOnly ? 'LoanPilot — draft reply prepared' : 'LoanPilot — auto-replied',
      body: ai.replyBody,
    })
  }

  if (settings.createCalendarEvents && ai.needsAppointment) {
    const cal = await holdFollowUpSlot({
      leadName: message.fromName ?? person?.name ?? 'Lead',
      hint: ai.appointmentHint,
      attendeeEmail: message.fromEmail,
    })
    calendarEventId = cal.id
    decision = 'appointment_created'
    if (settings.createFubTasks && person && !fubTaskId) {
      const lo = loanOfficer()
      const task = await createTask({
        personId: person.id,
        personName: person.name,
        name: `Confirm call ${cal.startIso}`,
        type: 'Appointment',
        dueDate: cal.startIso.slice(0, 10),
        assignedTo: lo.name,
        assignedUserId: lo.userId,
      })
      fubTaskId = task.id
    }
  }

  const activity: ActivityItem = {
    ...baseActivity,
    decision,
    summary: settings.draftOnly
      ? `Draft prepared (${Math.round(ai.confidence * 100)}% confidence)`
      : `Replied (${Math.round(ai.confidence * 100)}% confidence)`,
    replyPreview: ai.replyBody.slice(0, 180),
    fubTaskId,
    calendarEventId,
  }
  await appendActivity(activity)
  return { activity, replyBody: ai.replyBody }
}
