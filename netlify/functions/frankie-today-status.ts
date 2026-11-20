import { frankieTodaySummary, loadFrankieToday } from './_shared/frankieTodayRun'

/** Cached Frankie Today counts. Names only for the uncalled section. */
export default async (req: Request) => {
  try {
    const refresh = new URL(req.url).searchParams.has('refresh')
    const board = await loadFrankieToday({ refresh, budgetMs: refresh ? 45_000 : 22_000 })
    return Response.json(frankieTodaySummary(board))
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'unavailable' }, { status: 500 })
  }
}
