/**
 * Sample records must never be confused with live Follow Up Boss people.
 * FUB person ids are positive integers, so demo people use negative ids.
 * Legacy demo runs used 1001–1004 and 2101–2102, which can collide with real people.
 */
export const LEGACY_SAMPLE_PERSON_IDS = new Set([1001, 1002, 1003, 1004, 2101, 2102])

export function isDemoArtifactId(id: string): boolean {
  const value = id.toLowerCase()
  return value.includes('demo') || value.includes('seed-')
}

export function hideEventInLive(event: { id: string; source: string }): boolean {
  return event.source === 'demo' || isDemoArtifactId(event.id)
}

export function hideTaskInLive(task: { id: string; source: string }): boolean {
  return task.source === 'demo' || isDemoArtifactId(task.id)
}

/** Drop demo leads on read. Legacy colliding ids are dropped only until the one-time purge flag is set. */
export function hideLeadInLive(lead: { personId: number }, dropLegacy: boolean): boolean {
  if (lead.personId < 0) return true
  return dropLegacy && LEGACY_SAMPLE_PERSON_IDS.has(lead.personId)
}
