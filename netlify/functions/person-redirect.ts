import type { Config, Context } from '@netlify/functions'
import { env } from './_shared/env'

const PERSON_URL_BASE = 'https://teamcordeira.followupboss.com/2/people/view'

/** Public profile redirect. No Hub password and no lead data in the response. */
export default async (req: Request, context: Context) => {
  const fromParams = context.params?.personId
  const param = Array.isArray(fromParams) ? fromParams[0] : fromParams
  const fromPath = new URL(req.url).pathname.split('/').filter(Boolean).pop()
  const id = (param || fromPath || '').trim()
  if (!/^[1-9]\d*$/.test(id)) return new Response('Not found', { status: 404 })
  const base = env('FUB_PERSON_URL_BASE', PERSON_URL_BASE).replace(/\/$/, '')
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${base}/${id}`,
      'Cache-Control': 'public, max-age=300',
    },
  })
}

export const config: Config = {
  path: '/p/:personId',
}
