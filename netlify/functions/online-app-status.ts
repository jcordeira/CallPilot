import { loadOnlineAppState } from './_shared/onlineAppStore'

/** Last online-application run. No message bodies. */
export default async () => {
  const state = await loadOnlineAppState()
  if (!state.last) return Response.json({ ok: false, error: 'no run yet' }, { status: 404 })
  return Response.json(state.last)
}
