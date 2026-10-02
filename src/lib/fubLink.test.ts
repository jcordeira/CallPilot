import { describe, expect, it } from 'vitest'
import { fubPersonUrl, matchPersonInText, personIdForName } from './fubLink'

const people = [
  { personId: 1001, name: 'Alex Buyer' },
  { personId: 1002, name: 'Jordan Hale' },
]

describe('Follow Up Boss profile links', () => {
  it('uses the teamcordeira people view url', () => {
    expect(fubPersonUrl(1001)).toBe('https://teamcordeira.followupboss.com/2/people/view/1001')
    expect(fubPersonUrl(0)).toBeUndefined()
    expect(fubPersonUrl(-1001)).toBeUndefined()
    expect(fubPersonUrl(undefined)).toBeUndefined()
  })

  it('finds one lead name inside a calendar title or task', () => {
    expect(matchPersonInText('Call: Jordan Hale', people)).toEqual({
      personId: 1002,
      label: 'Jordan Hale',
      index: 'Call: '.length,
    })
    expect(matchPersonInText('Send pre-approval checklist to Alex Buyer', people)?.personId).toBe(1001)
    expect(matchPersonInText('Team Cordeira Weekly Meeting', people)).toBeUndefined()
  })

  it('does not pick between two different leads in the same line', () => {
    expect(matchPersonInText('Alex Buyer and Jordan Hale', people)).toBeUndefined()
  })

  it('matches a task person name only when it is unique', () => {
    expect(personIdForName('Alex Buyer', people)).toBe(1001)
    expect(personIdForName('alex buyer', people)).toBe(1001)
    expect(personIdForName('Frankie Cordeira', people)).toBeUndefined()
    expect(personIdForName('Alex Buyer', [...people, { personId: 9, name: 'Alex Buyer' }])).toBeUndefined()
  })
})
