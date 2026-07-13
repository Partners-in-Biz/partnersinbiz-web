import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessModule } from '@/lib/orgMembers/access-policy'
import { assertUserCanPerformOrganizationModuleAction, type ModulePolicyAccessResult } from '@/lib/organizations/module-policy-access'

export type MarketingMutationAction = 'create' | 'approvePublish'

export async function authorizeMarketingStudioMutation(
  user: ApiUser,
  orgId: string,
  action: MarketingMutationAction,
): Promise<ModulePolicyAccessResult> {
  if (!orgId || !canAccessOrg(user, orgId)) return { ok: false, status: 403, error: 'Forbidden' }
  if (user.role === 'client' && !canAccessModule(user.memberAccessPolicy, 'marketing')) {
    return { ok: false, status: 403, error: 'Marketing module is disabled for this organisation member' }
  }
  return assertUserCanPerformOrganizationModuleAction(user, orgId, 'marketing', action, 'Your role cannot perform this Marketing Studio action')
}
