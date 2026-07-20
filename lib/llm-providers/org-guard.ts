import type { ApiUser } from '@/lib/api/types'

export function clientCanAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role !== 'client') return true
  return (
    user.orgId === orgId ||
    user.activeOrgId === orgId ||
    (user.orgIds ?? []).includes(orgId)
  )
}

/** Org-scoped LLM connections require admin/owner (or platform admin/ai). */
export function canWriteOrgLlmConnection(user: ApiUser): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  const orgRole = (user as ApiUser & { orgRole?: string }).orgRole
  return orgRole === 'owner' || orgRole === 'admin' || user.role === 'client'
}
