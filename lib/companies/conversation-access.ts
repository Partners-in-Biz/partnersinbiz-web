import type { ApiUser } from '@/lib/api/types'
import { loadCompany } from '@/lib/companies/store'
import type { Company } from '@/lib/companies/types'
import { crmActorCanReadCompanyRecord } from '@/lib/crm/assignment-access'
import { resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'

export type AccessibleConversationCompany = {
  id: string
  name: string
  data: Company
}

export async function getConversationCompanyForUser(
  companyId: string,
  orgId: string,
  user: ApiUser,
): Promise<AccessibleConversationCompany | null> {
  const loaded = await loadCompany(companyId.trim(), orgId)
  if (!loaded) return null
  const company = loaded.data

  if (user.role !== 'admin' && user.role !== 'ai') {
    const accessPolicy = user.memberAccessPolicy ?? resolveMemberAccessPolicy({ role: 'member' })
    const allowed = await crmActorCanReadCompanyRecord({
      orgId,
      uid: user.uid,
      actor: { uid: user.uid, displayName: user.uid, kind: 'human' },
      role: 'member',
      isAgent: false,
      permissions: {},
      accessPolicy,
      user,
    }, companyId, company)
    if (!allowed) return null
  }

  const name = typeof company.name === 'string' ? company.name.trim() : ''
  return { id: companyId, name: name || companyId, data: company }
}
