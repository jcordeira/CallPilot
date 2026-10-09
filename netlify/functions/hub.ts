import type { Config, Context } from '@netlify/functions'
import { calendarOk, createCalendar, patchCalendar, peopleQuery, readCalendar, removeCalendar } from './_shared/calendarApi'
import { createHubEvent, createHubTask, eventInputFromBody, getHubSummary, scoreHubLeads, taskInputFromBody } from './_shared/hub'
import { requireHubSession } from './_shared/hubSession'
import { listLeadHeat } from './_shared/leadHeat'
import { getReminderPanel, runLoaReminders } from './_shared/loaReminders'
import { getCommandPanel } from './_shared/commandMode'
import { probeCommandGateway } from './_shared/commandParse'
import { getWhatsappPanel, runWhatsappAutoreply } from './_shared/whatsappAutoreply'
import { getCalendarGuestPanel, runCalendarGuest } from './_shared/calendarGuest'
import { getCommandCenter, listContactMessages, postCommandCenter, searchMessageLeads, sendHubText } from './_shared/commandCenter'
import { errorResponse, jsonFail, jsonOk, readJson } from './_shared/http'
import { getSmsUsage } from './_shared/quo'

export default async (req: Request, context: Context) => {
  const denied = requireHubSession(req)
  if (denied) return denied
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()

  try {
    if (action === 'sms-usage') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await getSmsUsage())
    }
    if (action === 'summary') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await getHubSummary())
    }
    if (action === 'tasks') {
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      return jsonOk(await createHubTask(taskInputFromBody(await readJson(req))), 201)
    }
    if (action === 'events') {
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      return jsonOk(await createHubEvent(eventInputFromBody(await readJson(req))), 201)
    }
    if (action === 'calendar') {
      if (req.method === 'GET') return calendarOk(await readCalendar(url))
      if (req.method === 'POST') return calendarOk(await createCalendar(await readJson(req)), 201)
      if (req.method === 'PATCH') return calendarOk(await patchCalendar(await readJson(req)))
      if (req.method === 'DELETE') return calendarOk(await removeCalendar(url))
      return jsonFail('Method not allowed', 405)
    }
    if (action === 'people') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return calendarOk(await peopleQuery(url))
    }
    if (action === 'leads') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await listLeadHeat())
    }
    if (action === 'score') {
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      return jsonOk(await scoreHubLeads())
    }
    if (action === 'reminders') {
      if (req.method === 'GET') return jsonOk(await getReminderPanel())
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      const text = await req.text()
      if (text.trim()) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return jsonFail('Invalid JSON body', 400)
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonFail('JSON object body is required', 400)
      }
      // The hub endpoint only previews. Live sends stay on the schedule and call/text webhooks.
      return jsonOk(await runLoaReminders({ trigger: 'hub', dryRun: true }))
    }
    if (action === 'whatsapp') {
      if (req.method === 'GET') return jsonOk(await getWhatsappPanel())
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      const text = await req.text()
      if (text.trim()) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return jsonFail('Invalid JSON body', 400)
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonFail('JSON object body is required', 400)
      }
      return jsonOk(await runWhatsappAutoreply({ trigger: 'hub', dryRun: true }))
    }
    if (action === 'calendar-guests') {
      if (req.method === 'GET') return jsonOk(await getCalendarGuestPanel())
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      const text = await req.text()
      let live = false
      if (text.trim()) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return jsonFail('Invalid JSON body', 400)
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonFail('JSON object body is required', 400)
        live = (body as { live?: unknown }).live === true
      }
      return jsonOk(await runCalendarGuest({ trigger: live ? 'hub-live' : 'hub', dryRun: !live }))
    }
    if (action === 'command-check') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await probeCommandGateway())
    }
    if (action === 'commands') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await getCommandPanel())
    }
    if (action === 'command-center') {
      if (req.method === 'GET') return jsonOk(await getCommandCenter())
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      const body = await readJson(req)
      return jsonOk(await postCommandCenter({
        text: typeof body.text === 'string' ? body.text : undefined,
        choice: typeof body.choice === 'string' ? body.choice : undefined,
      }))
    }
    if (action === 'messages') {
      if (req.method === 'GET') {
        const q = url.searchParams.get('q')?.trim() ?? ''
        const phone = url.searchParams.get('phone')?.trim() ?? ''
        if (q) return jsonOk({ leads: await searchMessageLeads(q) })
        if (phone) return jsonOk(await listContactMessages(phone))
        return jsonOk({ messages: [] })
      }
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      const body = await readJson(req)
      const kind = body.kind === 'lead' ? 'lead' : body.kind === 'team' ? 'team' : ''
      if (!kind) return jsonFail('Pick a team member or a lead', 400)
      return jsonOk(await sendHubText({
        to: typeof body.to === 'string' ? body.to : '',
        name: typeof body.name === 'string' ? body.name : '',
        content: typeof body.content === 'string' ? body.content : '',
        kind,
        confirmed: body.confirmed === true,
      }))
    }
    return jsonFail('Unknown action', 404)
  } catch (err) {
    return errorResponse(err)
  }
}

export const config: Config = {
  path: '/api/hub/:action',
  method: ['GET', 'POST', 'PATCH', 'DELETE'],
}
