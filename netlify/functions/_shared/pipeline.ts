import { generateReply } from './ai'
import { holdFollowUpSlot } from './calendar'
import { classifySender, shouldAutoRespond } from './classify'
import { addNote, createTask, findPersonByEmail, findPersonByPhone, personLooksLikeLead } from './followupboss'
import { createDraftReply, sendReply } from './gmail'
import { sendNeoReply } from './neo'
import { sendSms } from './quo'
import { appendActivity } from './store'
import type { ActivityItem, AssistantSettings, IncomingMessage } from './types'

export type ProcessResult = {
  activity: ActivityItem
  replyBody?: string
}

function tomorrowDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
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
      const task = await createTask({
        personId: person.id,
        name: ai.taskTitle ?? `Human follow-up needed: ${message.subject ?? 'lead message'}`,
        type: 'Follow Up',
        dueDate: tomorrowDueDate(),
      })
      fubTaskId = task.id
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
    const task = await createTask({
      personId: person.id,
      name: ai.taskTitle ?? 'Review AI lead reply',
      type: ai.needsAppointment ? 'Appointment' : 'Follow Up',
      dueDate: tomorrowDueDate(),
    })
    fubTaskId = task.id
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
      const task = await createTask({
        personId: person.id,
        name: `Confirm call ${cal.startIso}`,
        type: 'Appointment',
        dueDate: cal.startIso.slice(0, 10),
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
