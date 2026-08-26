import { FieldValue } from 'firebase-admin/firestore'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

/**
 * Portal switcher mirrors live on users.orgIds. Platform-admin home
 * `pib-platform-owner` stays on users.orgId and is not duplicated into orgIds.
 * Never overwrite an existing primary orgId.
 */
export function normalizePortalUserOrgIds(userData: Record<string, unknown>, orgId: string): string[] {
  const ids = new Set<string>()
  const isPlatformAdmin = userData.role === 'admin'
  if (Array.isArray(userData.orgIds)) {
    for (const value of userData.orgIds) {
      if (typeof value === 'string' && value.trim()) {
        const linkedOrgId = value.trim()
        if (!isPlatformAdmin || linkedOrgId !== PIB_PLATFORM_ORG_ID) ids.add(linkedOrgId)
      }
    }
  }
  if (typeof userData.orgId === 'string' && userData.orgId.trim()) {
    const primaryOrgId = userData.orgId.trim()
    if (!isPlatformAdmin || primaryOrgId !== PIB_PLATFORM_ORG_ID) ids.add(primaryOrgId)
  }
  ids.add(orgId)
  return Array.from(ids)
}

export function portalUserMembershipUpdate(
  userData: Record<string, unknown>,
  orgId: string,
): Record<string, unknown> {
  return {
    orgIds: normalizePortalUserOrgIds(userData, orgId),
    ...(userData.orgId ? {} : { orgId }),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
