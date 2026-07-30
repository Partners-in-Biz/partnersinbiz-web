import type { Firestore, Transaction } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { canAccessModule, resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { authorizeFinanceAction, FinanceAuthorizationError, parseIsoTimestamp, type FinanceAction } from './policy'
import type { FinanceActorContext, FinanceRole, FinanceRoleAssignment } from './types'

const FINANCE_ROLES = new Set<FinanceRole>([
  'finance_viewer', 'bookkeeper', 'accountant', 'finance_approver',
  'payroll_clerk', 'payroll_approver', 'finance_admin',
])

function cleanAssignment(id: string, data: Record<string, unknown>): FinanceRoleAssignment | null {
  const role = data.role as FinanceRole
  const scopeMode = data.scopeMode
  if (!FINANCE_ROLES.has(role) || (scopeMode !== 'entity' && scopeMode !== 'book')) return null
  if (typeof data.orgId !== 'string' || typeof data.userId !== 'string' ||
      typeof data.legalEntityId !== 'string' || data.status !== 'active') return null
  const bookId = typeof data.bookId === 'string' ? data.bookId : undefined
  if (scopeMode === 'book' && !bookId) return null
  const effectiveFrom = typeof data.effectiveFrom === 'string' ? data.effectiveFrom : undefined
  const effectiveTo = typeof data.effectiveTo === 'string' ? data.effectiveTo : undefined
  try {
    if (effectiveFrom) parseIsoTimestamp(effectiveFrom, 'assignment.effectiveFrom')
    if (effectiveTo) parseIsoTimestamp(effectiveTo, 'assignment.effectiveTo')
  } catch { return null }
  return {
    id, orgId: data.orgId, userId: data.userId, legalEntityId: data.legalEntityId, bookId,
    scopeMode, role, status: 'active',
    effectiveFrom, effectiveTo,
  }
}

function membershipContext(data: Record<string, unknown>): Pick<FinanceActorContext,
  'membershipRole' | 'membershipActive' | 'financeModuleEnabled'> {
  if (!isActiveOrgMembershipRow(data)) {
    throw new FinanceAuthorizationError('Active organization membership is required')
  }
  const role = data.role
  const membershipRole = role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer' ? role : 'viewer'
  const accessPolicy = resolveMemberAccessPolicy({
    role: membershipRole, accessScope: data.accessScope, accessPolicy: data.accessPolicy,
  })
  if (!canAccessModule(accessPolicy, 'billing')) {
    throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  }
  return { membershipRole, membershipActive: true, financeModuleEnabled: true }
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
  if (user.authKind === 'user_delegation') {
    if (!user.delegationId || user.orgId !== orgId || user.actingForUserId !== subjectUid) {
      throw new FinanceAuthorizationError('Delegation identity and organization scope are invalid')
    }
    if (!user.delegationScopes?.some((scope) => scope === 'finance:*' || scope.startsWith('finance:'))) {
      throw new FinanceAuthorizationError('Delegation does not grant a finance scope')
    }
  }
  const membershipSnapshot = await db.collection('orgMembers').doc(`${orgId}_${subjectUid}`).get()
  if (!membershipSnapshot.exists) throw new FinanceAuthorizationError('Active organization membership is required')
  const membership = membershipContext(membershipSnapshot.data() ?? {})
  const assignmentsSnapshot = await db.collection('finance_role_assignments')
    .where('orgId', '==', orgId).where('userId', '==', subjectUid).where('status', '==', 'active').get()
  const assignments = assignmentsSnapshot.docs.flatMap((doc) => {
    const assignment = cleanAssignment(doc.id, doc.data())
    return assignment ? [assignment] : []
  })
  return {
    uid: subjectUid, orgId, ...membership, assignments, correlationId: options.correlationId,
    delegationId: user.delegationId, delegationOrgId: user.authKind === 'user_delegation' ? orgId : undefined,
    delegationScopes: user.delegationScopes,
  }
}

/** Re-loads every mutable authorization record inside the final Firestore transaction. */
export async function revalidateFinanceActorInTransaction(
  tx: Transaction,
  db: Firestore,
  claimed: FinanceActorContext,
  scope: { orgId: string; legalEntityId: string; bookId?: string },
  action: FinanceAction,
  at: string,
): Promise<FinanceActorContext> {
  const memberRef = db.collection('orgMembers').doc(`${scope.orgId}_${claimed.uid}`)
  const assignmentsQuery = db.collection('finance_role_assignments')
    .where('orgId', '==', scope.orgId).where('userId', '==', claimed.uid).where('status', '==', 'active')
  const refs = claimed.delegationId
    ? [memberRef, db.collection('agent_delegations').doc(claimed.delegationId)]
    : [memberRef]
  const [snapshots, assignmentSnapshot] = await Promise.all([tx.getAll(...refs), tx.get(assignmentsQuery)])
  const memberSnapshot = snapshots[0]
  if (!memberSnapshot.exists) throw new FinanceAuthorizationError('Active organization membership is required')
  const membership = membershipContext(memberSnapshot.data() ?? {})
  const assignments = assignmentSnapshot.docs.flatMap((doc) => {
    const assignment = cleanAssignment(doc.id, doc.data())
    return assignment ? [assignment] : []
  })
  let delegationFields: Pick<FinanceActorContext, 'delegationId' | 'delegationOrgId' | 'delegationScopes'> = {}
  if (claimed.delegationId) {
    const delegationSnapshot = snapshots[1]
    const delegation = delegationSnapshot?.data() ?? {}
    const scopes = Array.isArray(delegation.scopes)
      ? delegation.scopes.filter((value): value is string => typeof value === 'string')
      : []
    let delegationExpiresAt = Number.NaN
    try {
      delegationExpiresAt = typeof delegation.expiresAt === 'string'
        ? parseIsoTimestamp(delegation.expiresAt, 'delegation.expiresAt') : Number.NaN
    } catch { /* fail closed below */ }
    if (!delegationSnapshot?.exists || delegation.status !== 'active' || delegation.revokedAt ||
        delegation.actingForUserId !== claimed.uid || delegation.orgId !== scope.orgId ||
        !Number.isFinite(delegationExpiresAt) || delegationExpiresAt <= parseIsoTimestamp(at, 'authorization timestamp')) {
      throw new FinanceAuthorizationError('Persisted delegation is missing, revoked, expired, or out of scope')
    }
    delegationFields = {
      delegationId: claimed.delegationId,
      delegationOrgId: delegation.orgId as string,
      delegationScopes: scopes,
    }
  }
  const actor: FinanceActorContext = {
    uid: claimed.uid, orgId: scope.orgId, ...membership, assignments,
    correlationId: claimed.correlationId, ...delegationFields,
  }
  authorizeFinanceAction(actor, scope, action, at)
  return actor
}
