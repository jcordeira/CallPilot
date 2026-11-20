import type { Config } from '@netlify/functions'
import { loadFrankieToday } from './_shared/frankieTodayRun'

/** Every 30 minutes. Rebuilds Frankie's read-only call list. */
export default async () => {
  const board = await loadFrankieToday({ refresh: true })
  return Response.json({ ok: true, updatedAt: board.updatedAt, totalDue: board.totalDue, sections: board.sections })
}

export const config: Config = {
  schedule: '*/30 * * * *',
}
