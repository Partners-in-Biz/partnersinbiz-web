import { adminDb } from '@/lib/firebase/admin'
import type { FinanceAuditEvent } from '@/lib/accounting/types'
import type { FinanceActorContext, FinanceRoleAssignment } from '@/lib/finance/types'
import {
  PracticeFinanceService,
  createEmptyPracticeStore,
  type AssignFinanceRoleCommand,
  type AuthorizePracticeGrantAccessCommand,
  type CreatePracticeGrantCommand,
  type EmitFinanceNotificationCommand,
  type MarkFinanceNotificationCommand,
  type PracticeFinanceStore,
  type PracticeMembershipRow,
  type RevokeFinanceRoleCommand,
  type RevokePracticeGrantCommand,
  type UpsertPracticeClientLinkCommand,
} from './service'
import type {
  FinanceOperatorNotification,
  PracticeAuditQuery,
  PracticeClientGrant,
  PracticeClientLink,
  PracticeGrantAccessEvent,
} from './types'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { canAccessModule, resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadMembershipsForUser(uid: string): Promise<Map<string, PracticeMembershipRow>> {
  const db = adminDb
  const snap = await db.collection('orgMembers').where('userId', '==', uid).limit(200).get()
  const map = new Map<string, PracticeMembershipRow>()
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    if (!isActiveOrgMembershipRow(data)) continue
    const orgId = typeof data.orgId === 'string' ? data.orgId : ''
    if (!orgId) continue
    const roleRaw = data.role
    const membershipRole =
      roleRaw === 'owner' || roleRaw === 'admin' || roleRaw === 'member' || roleRaw === 'viewer'
        ? roleRaw
        : 'viewer'
    const accessPolicy = resolveMemberAccessPolicy({
      role: membershipRole,
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
    })
    const financeModuleEnabled = canAccessModule(accessPolicy, 'billing')
    let orgName = orgId
    try {
      const orgSnap = await db.collection('organizations').doc(orgId).get()
      const orgData = orgSnap.data() as { name?: string } | undefined
      if (orgData?.name) orgName = orgData.name
    } catch {
      // keep orgId label
    }
    map.set(`${orgId}_${uid}`, {
      orgId,
      orgName,
      userId: uid,
      role: membershipRole,
      active: true,
      financeModuleEnabled,
    })
  }
  return map
}

async function loadStoreForActor(actor: FinanceActorContext, orgId: string): Promise<PracticeFinanceStore> {
  const db = adminDb
  const [
    assignmentsSnap,
    notificationsSnap,
    auditSnap,
    memberships,
    grantsSnap,
    linksSnap,
    grantAccessSnap,
  ] = await Promise.all([
    db.collection('finance_role_assignments').where('orgId', '==', orgId).limit(1000).get(),
    db.collection('finance_operator_notifications').where('orgId', '==', orgId).limit(500).get(),
    db.collection('finance_audit_events').where('orgId', '==', orgId).limit(500).get(),
    loadMembershipsForUser(actor.uid),
    db.collection('finance_practice_grants').where('firmOrgId', '==', orgId).limit(1000).get(),
    db.collection('finance_practice_client_links').where('firmOrgId', '==', orgId).limit(500).get(),
    db.collection('finance_practice_grant_access_events').where('firmOrgId', '==', orgId).limit(500).get(),
  ])

  // Also load actor's own assignments across memberships for practice switcher (uid-scoped only).
  const crossAssignmentSnaps = await Promise.all(
    [...memberships.values()]
      .filter((m) => m.orgId !== orgId)
      .slice(0, 40)
      .map((m) =>
        db
          .collection('finance_role_assignments')
          .where('orgId', '==', m.orgId)
          .where('userId', '==', actor.uid)
          .where('status', '==', 'active')
          .limit(100)
          .get(),
      ),
  )

  // Actor's grants as grantee (any firm) — uid-scoped only.
  const myGrantsSnap = await db
    .collection('finance_practice_grants')
    .where('granteeUserId', '==', actor.uid)
    .where('status', '==', 'active')
    .limit(200)
    .get()

  const store = createEmptyPracticeStore()
  store.assignments = asMap<FinanceRoleAssignment>(assignmentsSnap)
  for (const snap of crossAssignmentSnaps) {
    for (const doc of snap.docs) {
      const data = doc.data() as FinanceRoleAssignment
      const id = data.id || doc.id
      // Tenant safety: only ever index the actor's own cross-org assignments.
      if (data.userId !== actor.uid) continue
      store.assignments.set(id, { ...data, id })
    }
  }
  store.notifications = asMap<FinanceOperatorNotification>(notificationsSnap)
  store.auditEvents = asMap<FinanceAuditEvent>(auditSnap)
  store.memberships = memberships
  store.grants = asMap<PracticeClientGrant>(grantsSnap)
  for (const doc of myGrantsSnap.docs) {
    const data = doc.data() as PracticeClientGrant
    const id = data.id || doc.id
    if (data.granteeUserId !== actor.uid) continue
    store.grants.set(id, { ...data, id })
  }
  store.clientLinks = asMap<PracticeClientLink>(linksSnap)
  store.grantAccessEvents = asMap<PracticeGrantAccessEvent>(grantAccessSnap)
  return store
}

async function saveStore(before: PracticeFinanceStore, after: PracticeFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }
  for (const [id, value] of after.assignments) {
    touch('finance_role_assignments', id, value, before.assignments.get(id))
  }
  for (const [id, value] of after.notifications) {
    touch('finance_operator_notifications', id, value, before.notifications.get(id))
  }
  for (const [id, value] of after.grants) {
    touch('finance_practice_grants', id, value, before.grants.get(id))
  }
  for (const [id, value] of after.clientLinks) {
    touch('finance_practice_client_links', id, value, before.clientLinks.get(id))
  }
  for (const [id, value] of after.auditEvents) {
    if (before.auditEvents.has(id)) continue
    // Append-only audit rows created by practice role mutations.
    batch.set(db.collection('finance_audit_events').doc(id), value, { merge: false })
    ops++
  }
  for (const [id, value] of after.grantAccessEvents) {
    if (before.grantAccessEvents.has(id)) continue
    batch.set(db.collection('finance_practice_grant_access_events').doc(id), value, { merge: false })
    ops++
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_practice_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
}

export class FirestorePracticeFinanceGateway {
  private serviceFor(actor: FinanceActorContext, orgId: string) {
    return new PracticeFinanceService(
      () => loadStoreForActor(actor, orgId),
      saveStore,
    )
  }

  getBundle(actor: FinanceActorContext, orgId: string, auditQuery: Omit<PracticeAuditQuery, 'orgId'> = {}) {
    return this.serviceFor(actor, orgId).getBundle(actor, orgId, auditQuery)
  }

  assignRole(actor: FinanceActorContext, command: AssignFinanceRoleCommand) {
    return this.serviceFor(actor, command.orgId).assignRole(actor, command)
  }

  revokeRole(actor: FinanceActorContext, command: RevokeFinanceRoleCommand) {
    return this.serviceFor(actor, command.orgId).revokeRole(actor, command)
  }

  emitNotification(actor: FinanceActorContext, command: EmitFinanceNotificationCommand) {
    return this.serviceFor(actor, command.orgId).emitNotification(actor, command)
  }

  markNotification(actor: FinanceActorContext, command: MarkFinanceNotificationCommand) {
    return this.serviceFor(actor, command.orgId).markNotification(actor, command)
  }

  listAudit(actor: FinanceActorContext, query: PracticeAuditQuery) {
    return this.serviceFor(actor, query.orgId).listAudit(actor, query)
  }

  upsertClientLink(actor: FinanceActorContext, command: UpsertPracticeClientLinkCommand) {
    return this.serviceFor(actor, command.firmOrgId).upsertClientLink(actor, command)
  }

  createGrant(actor: FinanceActorContext, command: CreatePracticeGrantCommand) {
    return this.serviceFor(actor, command.firmOrgId).createGrant(actor, command)
  }

  revokeGrant(actor: FinanceActorContext, command: RevokePracticeGrantCommand) {
    return this.serviceFor(actor, command.firmOrgId).revokeGrant(actor, command)
  }

  authorizeGrantAccess(actor: FinanceActorContext, command: AuthorizePracticeGrantAccessCommand) {
    return this.serviceFor(actor, command.firmOrgId).authorizeGrantAccess(actor, command)
  }

  getPracticeQueue(actor: FinanceActorContext, firmOrgId: string) {
    return this.serviceFor(actor, firmOrgId).getPracticeQueue(actor, firmOrgId)
  }
}

export type {
  AssignFinanceRoleCommand,
  AuthorizePracticeGrantAccessCommand,
  CreatePracticeGrantCommand,
  EmitFinanceNotificationCommand,
  MarkFinanceNotificationCommand,
  RevokeFinanceRoleCommand,
  RevokePracticeGrantCommand,
  UpsertPracticeClientLinkCommand,
}
