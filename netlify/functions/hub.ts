import type { Config, Context } from '@netlify/functions'
import { calendarOk, createCalendar, patchCalendar, peopleQuery, readCalendar, removeCalendar } from './_shared/calendarApi'
import { createHubEvent, createHubTask, eventInputFromBody, getHubSummary, scoreHubLeads, taskInputFromBody } from './_shared/hub'
import { requireHubSession } from './_shared/hubSession'
import { listLeadHeat } from './_shared/leadHeat'
import { getReminderPanel, runLoaReminders } from './_shared/loaReminders'
import { getCommandPanel } from './_shared/commandMode'
import { getWhatsappPanel, runWhatsappAutoreply } from './_shared/whatsappAutoreply'
import { getCalendarGuestPanel, runCalendarGuest } from './_shared/calendarGuest'
import { errorResponse, jsonFail, jsonOk, readJson } from './_shared/http'

export default async (req: Request, context: Context) => {
  const denied = requireHubSession(req)
  if (denied) return denied
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()

  try {
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
      if (text.trim()) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return jsonFail('Invalid JSON body', 400)
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonFail('JSON object body is required', 400)
      }
      return jsonOk(await runCalendarGuest({ trigger: 'hub', dryRun: true }))
    }
    if (action === 'commands') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await getCommandPanel())
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
