import { getPortalOrgIdsForUser, type PortalUserData } from '@/lib/portal/org-access'
import { organizationEmbeddedMemberOrgIds } from '@/lib/portal/embedded-org-memberships'

/**
 * Orgs the signed-in user should see in the portal workspace switcher:
 * every place they already belong, including Org.members-only owners that
 * orgMembers / users.orgIds never mirrored.
 */
export async function listPortalSwitcherOrgIds(uid: string, data: PortalUserData): Promise<string[]> {
  const ids = new Set<string>()
  const [memberOrgIds, embeddedOrgIds] = await Promise.all([
    getPortalOrgIdsForUser(uid, data),
    organizationEmbeddedMemberOrgIds(uid),
  ])
  for (const orgId of memberOrgIds) ids.add(orgId)
  for (const orgId of embeddedOrgIds) ids.add(orgId)
  return Array.from(ids)
}
