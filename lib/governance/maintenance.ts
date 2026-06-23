// lib/governance/maintenance.ts
// Shared helpers for platform maintenance state. The admin maintenance page
// writes to platform_config/maintenance; public/portal layouts can read the
// current state via getMaintenanceState() and decide whether to show a banner
// or block access. This module intentionally does not edit any layout — it
// only exposes a read helper + an "is active now" predicate.
import { adminDb } from '@/lib/firebase/admin'
import { toMillis } from '@/lib/governance/firestore'

export interface MaintenanceState {
  enabled: boolean
  message: string
  scheduledStart?: string
  scheduledEnd?: string
  ipAllowlist: string[]
}

const DEFAULT_STATE: MaintenanceState = {
  enabled: false,
  message: '',
  ipAllowlist: [],
}

/** Read the current maintenance configuration. Never throws — returns defaults. */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  try {
    const snap = await adminDb.collection('platform_config').doc('maintenance').get()
    if (!snap.exists) return { ...DEFAULT_STATE }
    const data = snap.data() ?? {}
    const start = data.scheduledStart ? new Date(toMillis(data.scheduledStart)).toISOString() : undefined
    const end = data.scheduledEnd ? new Date(toMillis(data.scheduledEnd)).toISOString() : undefined
    return {
      enabled: data.enabled === true,
      message: typeof data.message === 'string' ? data.message : '',
      scheduledStart: start && start !== '1970-01-01T00:00:00.000Z' ? start : undefined,
      scheduledEnd: end && end !== '1970-01-01T00:00:00.000Z' ? end : undefined,
      ipAllowlist: Array.isArray(data.ipAllowlist)
        ? data.ipAllowlist.filter((ip: unknown): ip is string => typeof ip === 'string' && ip.length > 0)
        : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/**
 * True when maintenance should be considered active right now: either the
 * manual toggle is on, OR the current time falls within the scheduled window.
 */
export function isMaintenanceActiveNow(state: MaintenanceState, nowMs: number): boolean {
  if (state.enabled) return true
  const startMs = state.scheduledStart ? Date.parse(state.scheduledStart) : NaN
  const endMs = state.scheduledEnd ? Date.parse(state.scheduledEnd) : NaN
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
    return nowMs >= startMs && nowMs <= endMs
  }
  return false
}
