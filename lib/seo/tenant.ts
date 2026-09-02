import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { decideSharedAction } from '@/lib/company-work/projection'
import { isClientPrivate } from '@/lib/work-scope'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function sprintIdsForUser(user: ApiUser): Promise<string[]> {
  if (!user.orgId) return []
  const snap = await adminDb.collection('seo_sprints').where('orgId', '==', user.orgId).get()
  return snap.docs.map((d) => d.id)
}

/**
 * Owner-org access OR linked-org projection via company_workspace grant
 * covering `seo` for the sprint's companyId.
 */
export async function requireSprintAccess(
  sprintId: string,
  user: ApiUser,
  options: { action?: 'view' | 'comment' | 'approve' } = {},
) {
  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!snap.exists) throw new Error('Sprint not found')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = snap.data() as any
  if (data.deleted) throw new Error('Sprint not found')

  if (canAccessOrg(user, data.orgId)) {
    return { id: snap.id, ...data, accessMode: 'owner' as const }
  }

  // Projection branch: viewer org holds company_workspace grant for seo.
  const companyId = clean(data.companyId)
  const viewerOrgId = clean(user.orgId)
  if (!companyId || !viewerOrgId || !user.uid) {
    throw new Error('Sprint access denied')
  }
  if (isClientPrivate(data)) {
    throw new Error('Sprint access denied')
  }

  const decision = await decideSharedAction({
    viewerUid: user.uid,
    viewerOrgId,
    module: 'seo',
    resourceId: companyId,
    action: options.action ?? 'view',
  })
  if (!decision.allowed) {
    throw new Error('Sprint access denied')
  }

  return { id: snap.id, ...data, accessMode: 'projected' as const, grantId: decision.grantId }
}

/** Stamp child SEO records with the sprint's company scope. */
export function inheritSprintCompanyFields(sprint: {
  companyId?: unknown
  marketingOwner?: unknown
  workOwner?: unknown
  clientVisibility?: unknown
}): Record<string, unknown> {
  const companyId = clean(sprint.companyId)
  const out: Record<string, unknown> = {}
  if (companyId) {
    out.companyId = companyId
    out.workOwner = 'company'
    out.marketingOwner = 'company'
  }
  if (sprint.clientVisibility === 'private' || sprint.clientVisibility === 'shared') {
    out.clientVisibility = sprint.clientVisibility
  }
  return out
}
