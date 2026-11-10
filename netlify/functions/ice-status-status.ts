import { loadIceRun } from './_shared/iceStatusStore'

/** Last ICE status run. No message bodies or borrower emails. */
export default async () => {
  const last = await loadIceRun()
  if (!last || typeof last !== 'object') return Response.json({ ok: false, error: 'no run yet' }, { status: 404 })
  return Response.json(last)
}
