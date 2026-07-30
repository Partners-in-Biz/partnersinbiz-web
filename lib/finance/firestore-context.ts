import type { Firestore } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { FinanceAuthorizationError } from './policy'
import type { FinanceActorContext, FinanceRole, FinanceRoleAssignment } from './types'

const FINANCE_ROLES = new Set<FinanceRole>([
  'finance_viewer', 'bookkeeper', 'accountant', 'finance_approver',
  'payroll_clerk', 'payroll_approver', 'finance_admin',
])

function cleanAssignment(id: string, data: Record<string, unknown>): FinanceRoleAssignment | null {
  const role = data.role as FinanceRole
  const scopeMode = data.scopeMode
  if (!FINANCE_ROLES.has(role) || (scopeMode !== 'entity' && scopeMode !== 'book')) return null
  if (
    typeof data.orgId !== 'string' || typeof data.userId !== 'string' ||
    typeof data.legalEntityId !== 'string' || data.status !== 'active'
  ) return null
  const bookId = typeof data.bookId === 'string' ? data.bookId : undefined
  if (scopeMode === 'book' && !bookId) return null
  return {
    id,
    orgId: data.orgId,
    userId: data.userId,
    legalEntityId: data.legalEntityId,
    bookId,
    scopeMode,
    role,
    status: 'active',
    effectiveFrom: typeof data.effectiveFrom === 'string' ? data.effectiveFrom : undefined,
    effectiveTo: typeof data.effectiveTo === 'string' ? data.effectiveTo : undefined,
  }
}

export async function loadFinanceActorContext(
  user: ApiUser,
  orgId: string,
  options: { db?: Firestore; correlationId?: string } = {},
): Promise<FinanceActorContext> {
  const db = options.db ?? adminDb
  const subjectUid = user.authKind === 'user_delegation' ? user.actingForUserId : user.uid
  if (!subjectUid || user.authKind === 'legacy_ai_key' || user.authKind === 'agent_api_key') {
    throw new FinanceAuthorizationError('Finance mutations require a scoped human or human-delegated identity')
  }
  const membershipSnapshot = await db.collection('orgMembers').doc(`${orgId}_${subjectUid}`).get()
  const membershipData = membershipSnapshot.data() ?? {}
  if (!membershipSnapshot.exists || !isActiveOrgMembershipRow(membershipData)) {
    throw new FinanceAuthorizationError('Active organization membership is required')
  }
  const role = membershipData.role
  const membershipRole = role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer' ? role : 'viewer'
  const assignmentsSnapshot = await db.collection('finance_role_assignments')
    .where('orgId', '==', orgId)
    .where('userId', '==', subjectUid)
    .where('status', '==', 'active')
    .get()
  const assignments = assignmentsSnapshot.docs.flatMap((doc) => {
    const assignment = cleanAssignment(doc.id, doc.data())
    return assignment ? [assignment] : []
  })
  return {
    uid: subjectUid,
    orgId,
    membershipRole,
    membershipActive: true,
    assignments,
    correlationId: options.correlationId,
    delegationId: user.delegationId,
  }
}
