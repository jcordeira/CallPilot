/** Follow Up Boss web app profile. `/2/` is the app route, then the person id. */
export const FUB_PERSON_URL_BASE = 'https://teamcordeira.followupboss.com/2/people/view'

export type NamedPerson = { personId: number; name: string }

export function fubPersonUrl(personId: number | undefined): string | undefined {
  if (personId == null || !Number.isInteger(personId) || personId <= 0) return undefined
  return `${FUB_PERSON_URL_BASE}/${personId}`
}

export function matchPersonInText(
  text: string,
  people: NamedPerson[],
): { personId: number; label: string; index: number } | undefined {
  const hay = text.toLowerCase()
  const hits = people
    .filter((person) => person.personId > 0 && person.name.trim().length > 2)
    .map((person) => {
      const name = person.name.trim()
      return { personId: person.personId, name, index: hay.indexOf(name.toLowerCase()) }
    })
    .filter((row) => row.index >= 0)
    .sort((a, b) => b.name.length - a.name.length || a.index - b.index)
  const best = hits[0]
  if (!best) return undefined
  const distinct = new Set(hits.map((row) => row.personId))
  if (distinct.size !== 1) return undefined
  return { personId: best.personId, label: text.slice(best.index, best.index + best.name.length), index: best.index }
}

/** Exact name match when the row already has a person name and no id. */
export function personIdForName(name: string | undefined, people: NamedPerson[]): number | undefined {
  const needle = name?.trim().toLowerCase()
  if (!needle || needle.length <= 2) return undefined
  const hits = people.filter((person) => person.personId > 0 && person.name.trim().toLowerCase() === needle)
  return hits.length === 1 ? hits[0].personId : undefined
}
