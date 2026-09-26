import type { Config } from '@netlify/functions'
import { rescoreOpenLeads } from './_shared/leadHeat'

/** Hourly rescore of open Follow Up Boss leads. Writes notes, scores, and Joseph/Frank tasks. */
export default async (_req: Request) => {
  const leads = await rescoreOpenLeads()
  return Response.json({
    ok: true,
    scored: leads.length,
    hot: leads.filter((lead) => lead.band === 'hot').length,
    warm: leads.filter((lead) => lead.band === 'warm').length,
  })
}

export const config: Config = {
  schedule: '@hourly',
}
