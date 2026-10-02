import { isDemoMode } from './env'
import { loadHubExtrasRaw, projectLiveExtras, saveHubExtras } from './hubExtras'
import { purgeDemoActivity } from './store'

let purgedThisInstance = false

export function resetStoredDemoPurgeForTests() {
  purgedThisInstance = false
}

/**
 * One-time (per instance) cleanup of sample rows saved while demo mode was on.
 * Safe to call on every hub load and inbox sweep: after the flag is stored, legacy
 * person ids are left alone so a real Follow Up Boss person with that id can be scored.
 * Structural demo rows (source, id) are still removed on later runs.
 */
export async function purgeStoredDemoData(): Promise<void> {
  if (isDemoMode() || purgedThisInstance) return
  try {
    const raw = await loadHubExtrasRaw()
    const next = projectLiveExtras(raw)
    next.demoPurged = true
    if (JSON.stringify(raw) !== JSON.stringify(next)) {
      await saveHubExtras(next)
    }
    await purgeDemoActivity()
    purgedThisInstance = true
  } catch {
    /* retry on the next call */
  }
}
