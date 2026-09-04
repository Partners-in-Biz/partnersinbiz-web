import { adminDb } from '@/lib/firebase/admin'
import {
  type OrgFeatureFlags,
  resolveFeatureFlags,
} from '@/app/api/v1/org/feature-flags/route'

function settingsFeatureFlags(data: Record<string, unknown> | undefined): unknown {
  const settings = data?.settings
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined
  return (settings as Record<string, unknown>).featureFlags
}

export function featureFlagsFromOrgData(data: Record<string, unknown> | undefined): OrgFeatureFlags {
  return resolveFeatureFlags(settingsFeatureFlags(data))
}

export async function orgFeatureFlagEnabled(
  orgId: string,
  key: keyof OrgFeatureFlags,
): Promise<boolean> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return false
  const flags = featureFlagsFromOrgData(snap.data() as Record<string, unknown> | undefined)
  return flags[key] === true
}
