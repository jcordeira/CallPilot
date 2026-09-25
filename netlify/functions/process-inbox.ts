import type { Config, Context } from '@netlify/functions'
import { sweepInboxes } from './_shared/sweep'

/** Scheduled inbox sweep — Gmail + Neo every 5 minutes. */
export default async (_req: Request, _context: Context) => {
  const results = await sweepInboxes()
  return Response.json({
    ok: true,
    processed: results.length,
    results: results.map((r) => r.activity),
  })
}

export const config: Config = {
  schedule: '*/5 * * * *',
}
