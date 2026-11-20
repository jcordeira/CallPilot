import { frankieTodaySummary, loadFrankieToday } from './_shared/frankieTodayRun'

/** Cached Frankie Today counts. Names only for the uncalled section. */
export default async () => {
  try {
    const board = await loadFrankieToday()
    return Response.json(frankieTodaySummary(board))
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'unavailable' }, { status: 500 })
  }
}
