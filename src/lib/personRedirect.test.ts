import { describe, expect, it } from 'vitest'
import type { Context } from '@netlify/functions'
import handler from '../../netlify/functions/person-redirect'

function call(path: string, personId?: string) {
  return handler(new Request(`https://thriving-faloodeh-857600.netlify.app${path}`), { params: personId ? { personId } : {} } as Context)
}

describe('person redirect', () => {
  it('sends a numeric id to the Follow Up Boss profile and hides everything else', async () => {
    const found = await call('/p/99', '99')
    expect(found.status).toBe(302)
    expect(found.headers.get('Location')).toBe('https://teamcordeira.followupboss.com/2/people/view/99')
    expect(await found.text()).toBe('')

    const fromPath = await call('/p/100')
    expect(fromPath.status).toBe(302)
    expect(fromPath.headers.get('Location')).toBe('https://teamcordeira.followupboss.com/2/people/view/100')

    expect((await call('/p/ada', 'ada')).status).toBe(404)
    expect((await call('/p/0', '0')).status).toBe(404)
    expect((await call('/p/')).status).toBe(404)
  })
})
