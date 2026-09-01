import type { ApiUser } from '@/lib/api/types'
import { findDuplicateCompany } from '@/lib/companies/store'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

/**
 * True when a PiB staff member is serving this client organisation via a
 * platform CRM company (`linkedOrgId`), even if they are not an org member.
 */
export async function pibStaffCanServeClientOrg(
  user: Pick<ApiUser, 'uid' | 'role'>,
  clientOrgId: string,
): Promise<boolean> {
  const orgId = typeof clientOrgId === 'string' ? clientOrgId.trim() : ''
  if (!orgId || orgId === PIB_PLATFORM_ORG_ID) return false
  if (user.role === 'admin' || user.role === 'ai') return false
  const staff = await loadPlatformStaffMembership(user.uid)
  if (!staff) return false
  const match = await findDuplicateCompany(staff.platformOrgId, { linkedOrgId: orgId })
  return Boolean(match?.id)
}
