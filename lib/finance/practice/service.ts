import type { FinanceAuditEvent } from '@/lib/accounting/types'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import {
  ACTION_ROLES_FOR_COVERAGE,
  authorizeFinanceAction,
  FinanceAuthorizationError,
  type FinanceAction,
} from '@/lib/finance/policy'
import { APPROVAL_GATED_ACTIONS, AUDITED_MUTATION_ACTIONS } from '@/lib/finance/security-matrix'
import type {
  FinanceActorContext,
  FinanceRole,
  FinanceRoleAssignment,
  FinanceScope,
} from '@/lib/finance/types'
import type {
  FinanceOperatorNotification,
  FinanceOperatorNotificationKind,
  FinanceRoleMatrixRow,
  PracticeAuditEventView,
  PracticeAuditQuery,
  PracticeClientGrant,
  PracticeClientLink,
  PracticeClientSummary,
  PracticeGrantAccessEvent,
  PracticeGrantRole,
  PracticeQueueItem,
  PracticeWorkspaceBundle,
} from './types'
import {
  authorizePracticeGrantAction,
  buildPracticeQueue,
  grantSafetyFlags,
  isPracticeGrantRole,
  newGrantAccessEvent,
  PRACTICE_GRANT_HARD_DENY_ACTIONS,
} from './grants'

export class PracticeFinanceValidationError extends FinanceValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'PracticeFinanceValidationError'
  }
}

export interface PracticeMembershipRow {
  orgId: string
  orgName: string
  userId: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  active: boolean
  financeModuleEnabled: boolean
}

export interface PracticeFinanceStore {
  assignments: Map<string, FinanceRoleAssignment>
  notifications: Map<string, FinanceOperatorNotification>
  auditEvents: Map<string, FinanceAuditEvent>
  memberships: Map<string, PracticeMembershipRow>
  claims: Set<string>
  grants: Map<string, PracticeClientGrant>
  clientLinks: Map<string, PracticeClientLink>
  grantAccessEvents: Map<string, PracticeGrantAccessEvent>
}

export function createEmptyPracticeStore(): PracticeFinanceStore {
  return {
    assignments: new Map(),
    notifications: new Map(),
    auditEvents: new Map(),
    memberships: new Map(),
    claims: new Set(),
    grants: new Map(),
    clientLinks: new Map(),
    grantAccessEvents: new Map(),
  }
}

export function clonePracticeStore(store: PracticeFinanceStore): PracticeFinanceStore {
  return {
    assignments: new Map(store.assignments),
    notifications: new Map(store.notifications),
    auditEvents: new Map(store.auditEvents),
    memberships: new Map(store.memberships),
    claims: new Set(store.claims),
    grants: new Map(store.grants),
    clientLinks: new Map(store.clientLinks),
    grantAccessEvents: new Map(store.grantAccessEvents),
  }
}

const ALL_ROLES: readonly FinanceRole[] = [
  'finance_viewer',
  'bookkeeper',
  'accountant',
  'finance_approver',
  'payroll_clerk',
  'payroll_approver',
  'finance_admin',
]

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PracticeFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function claim(store: PracticeFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new PracticeFinanceValidationError(message)
  store.claims.add(key)
}

function assertOrgMembership(actor: FinanceActorContext, orgId: string): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
}

function canManageRoles(actor: FinanceActorContext, scope: FinanceScope, at: string): void {
  assertOrgMembership(actor, scope.orgId)
  if (actor.membershipRole === 'owner' || actor.membershipRole === 'admin') {
    // Org owners/admins may manage roles when they hold finance_admin assignment or during bootstrap coverage.
    try {
      authorizeFinanceAction(actor, scope, 'role.assign', at)
      return
    } catch {
      if (actor.assignments.some((a) => a.orgId === scope.orgId && a.status === 'active' && a.role === 'finance_admin')) {
        authorizeFinanceAction(actor, scope, 'role.assign', at)
        return
      }
      // Fall through to standard authorize which will throw clearly.
    }
  }
  authorizeFinanceAction(actor, scope, 'role.assign', at)
}

/** Firm-level grant/link admin: owner/admin + finance_admin assignment in firm (any entity). */
function canManagePracticeGrants(actor: FinanceActorContext, firmOrgId: string, at: string): void {
  assertOrgMembership(actor, firmOrgId)
  if (actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
    throw new FinanceAuthorizationError('Practice grants require owner or admin membership on the firm')
  }
  const firmAdminAssignment = actor.assignments.find(
    (a) => a.orgId === firmOrgId && a.status === 'active' && a.role === 'finance_admin',
  )
  if (!firmAdminAssignment) {
    throw new FinanceAuthorizationError('Practice grants require an active finance_admin assignment on the firm')
  }
  authorizeFinanceAction(
    actor,
    { orgId: firmOrgId, legalEntityId: firmAdminAssignment.legalEntityId, bookId: firmAdminAssignment.bookId },
    'role.assign',
    at,
  )
}

function canReadRoles(actor: FinanceActorContext, orgId: string, at: string, legalEntityId?: string): void {
  assertOrgMembership(actor, orgId)
  if (legalEntityId) {
    authorizeFinanceAction(actor, { orgId, legalEntityId }, 'role.read', at)
    return
  }
  // Org-level list: any active finance assignment in org, or org owner/admin.
  if (actor.membershipRole === 'owner' || actor.membershipRole === 'admin') return
  if (actor.assignments.some((a) => a.orgId === orgId && a.status === 'active')) return
  throw new FinanceAuthorizationError('No active finance assignment covers this scope')
}

function canReadAudit(actor: FinanceActorContext, orgId: string, at: string, legalEntityId?: string, bookId?: string): void {
  assertOrgMembership(actor, orgId)
  if (legalEntityId) {
    authorizeFinanceAction(actor, { orgId, legalEntityId, bookId }, 'audit.read', at)
    return
  }
  if (actor.membershipRole === 'owner' || actor.membershipRole === 'admin') return
  if (actor.assignments.some((a) => a.orgId === orgId && a.status === 'active' &&
    ['finance_admin', 'accountant', 'finance_approver', 'bookkeeper', 'finance_viewer'].includes(a.role))) {
    return
  }
  throw new FinanceAuthorizationError('No active finance assignment covers this scope')
}

function canReadNotifications(actor: FinanceActorContext, orgId: string, at: string): void {
  assertOrgMembership(actor, orgId)
  if (actor.membershipRole === 'owner' || actor.membershipRole === 'admin') return
  if (actor.assignments.some((a) => a.orgId === orgId && a.status === 'active')) return
  // Still allow authorize with a synthetic entity if actor has entity assignment via policy
  const first = actor.assignments.find((a) => a.orgId === orgId && a.status === 'active')
  if (first) {
    authorizeFinanceAction(actor, { orgId, legalEntityId: first.legalEntityId, bookId: first.bookId }, 'notification.read', at)
    return
  }
  throw new FinanceAuthorizationError('No active finance assignment covers this scope')
}

/** Pure role matrix for UI / docs. */
export function buildFinanceRoleMatrix(): FinanceRoleMatrixRow[] {
  const approval = new Set(APPROVAL_GATED_ACTIONS as readonly string[])
  const audited = new Set(AUDITED_MUTATION_ACTIONS as readonly string[])
  return (Object.keys(ACTION_ROLES_FOR_COVERAGE) as FinanceAction[])
    .sort((a, b) => a.localeCompare(b))
    .map((action) => ({
      action,
      roles: ACTION_ROLES_FOR_COVERAGE[action],
      approvalGated: approval.has(action),
      audited: audited.has(action),
    }))
}

export function filterAssignmentsForOrg(
  assignments: Iterable<FinanceRoleAssignment>,
  orgId: string,
): FinanceRoleAssignment[] {
  return [...assignments]
    .filter((row) => row.orgId === orgId)
    .sort((a, b) => a.userId.localeCompare(b.userId) || a.legalEntityId.localeCompare(b.legalEntityId))
}

export function filterAuditEventsForQuery(
  events: Iterable<FinanceAuditEvent | PracticeAuditEventView>,
  query: PracticeAuditQuery,
): PracticeAuditEventView[] {
  const orgId = requiredText(query.orgId, 'orgId')
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const fromMs = query.from ? Date.parse(query.from) : Number.NaN
  const toMs = query.to ? Date.parse(query.to) : Number.NaN

  return [...events]
    .filter((event) => {
      if (event.orgId !== orgId) return false
      if (query.legalEntityId && event.legalEntityId !== query.legalEntityId) return false
      if (query.bookId && event.bookId !== query.bookId) return false
      if (query.actorId && event.actorId !== query.actorId) return false
      if (query.eventType && event.eventType !== query.eventType) return false
      const at = Date.parse(event.occurredAt)
      if (Number.isFinite(fromMs) && !(at >= fromMs)) return false
      if (Number.isFinite(toMs) && !(at <= toMs)) return false
      return true
    })
    .map((event) => ({
      id: event.id,
      orgId: event.orgId,
      legalEntityId: event.legalEntityId,
      bookId: event.bookId,
      eventType: event.eventType,
      actorId: event.actorId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
      reason: 'reason' in event ? event.reason : undefined,
      sequence: event.sequence,
      eventHash: event.eventHash,
      externalEgressAllowed: false as const,
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.sequence - a.sequence)
    .slice(0, limit)
}

export function buildPracticeClientSummaries(input: {
  actorUid: string
  currentOrgId: string
  memberships: PracticeMembershipRow[]
  assignments: FinanceRoleAssignment[]
}): PracticeClientSummary[] {
  const byOrg = new Map<string, FinanceRoleAssignment[]>()
  for (const assignment of input.assignments) {
    if (assignment.userId !== input.actorUid || assignment.status !== 'active') continue
    const list = byOrg.get(assignment.orgId) ?? []
    list.push(assignment)
    byOrg.set(assignment.orgId, list)
  }

  return input.memberships
    .filter((m) => m.userId === input.actorUid && m.active && m.financeModuleEnabled)
    .map((m) => {
      const rows = byOrg.get(m.orgId) ?? []
      const roles = [...new Set(rows.map((r) => r.role))]
      const legalEntityIds = [...new Set(rows.map((r) => r.legalEntityId))]
      return {
        orgId: m.orgId,
        orgName: m.orgName,
        membershipRole: m.role,
        financeModuleEnabled: m.financeModuleEnabled,
        assignmentCount: rows.length,
        roles,
        legalEntityIds,
        isCurrent: m.orgId === input.currentOrgId,
      }
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.orgName.localeCompare(b.orgName))
}

export interface AssignFinanceRoleCommand {
  id: string
  orgId: string
  userId: string
  legalEntityId: string
  role: FinanceRole
  scopeMode?: 'entity' | 'book'
  bookId?: string
  requestId: string
  idempotencyKey: string
}

export interface RevokeFinanceRoleCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
  reason?: string
}

export interface EmitFinanceNotificationCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId?: string
  kind: FinanceOperatorNotificationKind
  title: string
  body: string
  href?: string
  targetUserId?: string
  aggregateType?: string
  aggregateId?: string
  requestId: string
  idempotencyKey: string
}

export interface MarkFinanceNotificationCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
  status: 'read' | 'dismissed'
}

export interface UpsertPracticeClientLinkCommand {
  id: string
  firmOrgId: string
  clientOrgId: string
  clientName: string
  status?: 'active' | 'inactive'
  relationshipId?: string
  openPeriodCount?: number
  closeBlockerCount?: number
  reconBacklogCount?: number
  requestId: string
  idempotencyKey: string
}

export interface CreatePracticeGrantCommand {
  id: string
  firmOrgId: string
  clientOrgId: string
  granteeUserId: string
  role: PracticeGrantRole
  legalEntityIds?: string[]
  bookIds?: string[]
  relationshipId?: string
  requestId: string
  idempotencyKey: string
}

export interface RevokePracticeGrantCommand {
  id: string
  firmOrgId: string
  reason?: string
  requestId: string
  idempotencyKey: string
}

export interface AuthorizePracticeGrantAccessCommand {
  firmOrgId: string
  clientOrgId: string
  action: FinanceAction
  legalEntityId?: string
  bookId?: string
  resource?: string
  requestId: string
  idempotencyKey: string
}

export class PracticeFinanceService {
  constructor(
    private readonly load: () => Promise<PracticeFinanceStore>,
    private readonly save: (before: PracticeFinanceStore, after: PracticeFinanceStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    auditQuery: Omit<PracticeAuditQuery, 'orgId'> = {},
  ): Promise<PracticeWorkspaceBundle> {
    const store = await this.load()
    const at = this.now()
    canReadRoles(actor, orgId, at)
    canReadNotifications(actor, orgId, at)
    canReadAudit(actor, orgId, at, auditQuery.legalEntityId, auditQuery.bookId)

    const assignments = filterAssignmentsForOrg(store.assignments.values(), orgId)
    const myAssignments = assignments.filter((a) => a.userId === actor.uid && a.status === 'active')
    const notifications = [...store.notifications.values()]
      .filter((n) => n.orgId === orgId)
      .filter((n) => !n.targetUserId || n.targetUserId === actor.uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
    const auditEvents = filterAuditEventsForQuery(store.auditEvents.values(), {
      orgId,
      ...auditQuery,
      limit: auditQuery.limit ?? 50,
    })
    const practiceClients = buildPracticeClientSummaries({
      actorUid: actor.uid,
      currentOrgId: orgId,
      memberships: [...store.memberships.values()],
      assignments: [...store.assignments.values()],
    })

    const grants = [...store.grants.values()]
      .filter((g) => g.firmOrgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    const myGrants = [...store.grants.values()]
      .filter((g) => g.granteeUserId === actor.uid && g.status === 'active')
      .sort((a, b) => a.clientOrgId.localeCompare(b.clientOrgId) || a.role.localeCompare(b.role))
    const clientLinks = [...store.clientLinks.values()]
      .filter((l) => l.firmOrgId === orgId)
      .sort((a, b) => a.clientName.localeCompare(b.clientName))
    const practiceQueue = buildPracticeQueue({
      firmOrgId: orgId,
      links: clientLinks,
      grants: store.grants.values(),
    })
    const grantAccessEvents = [...store.grantAccessEvents.values()]
      .filter((e) => e.firmOrgId === orgId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.sequence - a.sequence)
      .slice(0, 100)

    return {
      orgId,
      matrix: buildFinanceRoleMatrix(),
      assignments,
      myAssignments,
      notifications,
      auditEvents,
      practiceClients,
      grants,
      myGrants,
      clientLinks,
      practiceQueue,
      grantAccessEvents,
      safety: {
        noSarsSubmit: true,
        noExternalPaymentInitiate: true,
        tenantScoped: true,
        clientVisibleMessagesAllowed: false,
        externalEgressAllowed: false,
        practiceGrantsEnabled: true,
      },
    }
  }

  async assignRole(actor: FinanceActorContext, command: AssignFinanceRoleCommand): Promise<FinanceRoleAssignment> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const userId = requiredText(command.userId, 'userId')
    const role = command.role
    if (!ALL_ROLES.includes(role)) throw new PracticeFinanceValidationError('Invalid finance role')
    const scopeMode = command.scopeMode ?? 'entity'
    if (scopeMode !== 'entity' && scopeMode !== 'book') {
      throw new PracticeFinanceValidationError('scopeMode must be entity or book')
    }
    if (scopeMode === 'book' && !command.bookId) {
      throw new PracticeFinanceValidationError('book scope requires bookId')
    }
    const scope: FinanceScope = {
      orgId,
      legalEntityId,
      bookId: scopeMode === 'book' ? requiredText(command.bookId, 'bookId') : undefined,
    }
    canManageRoles(actor, scope, at)
    claim(after, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate role assignment request')

    const existing = after.assignments.get(command.id)
    if (existing) {
      if (existing.orgId !== orgId) throw new PracticeFinanceValidationError('Assignment id collision across tenants')
      return existing
    }

    const assignment: FinanceRoleAssignment = {
      id: requiredText(command.id, 'id'),
      orgId,
      userId,
      legalEntityId,
      bookId: scope.bookId,
      scopeMode,
      role,
      status: 'active',
      effectiveFrom: at,
    }
    after.assignments.set(assignment.id, assignment)

    // lightweight audit row in practice store for explorer until foundation chain is used
    const auditId = `aud_${assignment.id}`
    after.auditEvents.set(auditId, {
      id: auditId,
      schemaVersion: 1,
      orgId,
      legalEntityId,
      bookId: scope.bookId,
      aggregateType: 'finance_role_assignment',
      aggregateId: assignment.id,
      aggregateVersion: 1,
      aggregateDigest: assignment.id,
      eventType: 'role.assigned',
      actorId: actor.uid,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      correlationId: actor.correlationId,
      occurredAt: at,
      sequence: after.auditEvents.size + 1,
      canonicalPayloadVersion: 1,
      hashAlgorithmVersion: 'sha256-v1',
      eventHash: `hash_${assignment.id}`,
      reason: `Assigned ${role} to ${userId}`,
    } as FinanceAuditEvent)

    const notificationId = `ntf_${assignment.id}`
    after.notifications.set(notificationId, {
      id: notificationId,
      schemaVersion: 1,
      orgId,
      legalEntityId,
      bookId: scope.bookId,
      kind: 'role.assigned',
      status: 'unread',
      title: 'Finance role assigned',
      body: `${role} granted on ${legalEntityId}${scope.bookId ? ` / ${scope.bookId}` : ''}`,
      href: '/portal/finance/practice',
      targetUserId: userId,
      actorId: actor.uid,
      aggregateType: 'finance_role_assignment',
      aggregateId: assignment.id,
      createdAt: at,
      externalEgressAllowed: false,
    })

    await this.save(before, after)
    return assignment
  }

  async revokeRole(actor: FinanceActorContext, command: RevokeFinanceRoleCommand): Promise<FinanceRoleAssignment> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const orgId = requiredText(command.orgId, 'orgId')
    const id = requiredText(command.id, 'id')
    const existing = after.assignments.get(id)
    if (!existing || existing.orgId !== orgId) {
      // Non-enumerating across tenants
      throw new PracticeFinanceValidationError('Finance role assignment not found')
    }
    canManageRoles(actor, {
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
    }, at)
    claim(after, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate role revoke request')

    const revoked: FinanceRoleAssignment = {
      ...existing,
      status: 'revoked',
      effectiveTo: at,
    }
    after.assignments.set(id, revoked)

    const auditId = `aud_rev_${id}_${after.auditEvents.size + 1}`
    after.auditEvents.set(auditId, {
      id: auditId,
      schemaVersion: 1,
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
      aggregateType: 'finance_role_assignment',
      aggregateId: id,
      aggregateVersion: 2,
      aggregateDigest: id,
      eventType: 'role.revoked',
      actorId: actor.uid,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      correlationId: actor.correlationId,
      occurredAt: at,
      sequence: after.auditEvents.size + 1,
      canonicalPayloadVersion: 1,
      hashAlgorithmVersion: 'sha256-v1',
      eventHash: `hash_rev_${id}`,
      reason: command.reason || `Revoked ${existing.role}`,
    } as FinanceAuditEvent)

    const notificationId = `ntf_rev_${id}`
    after.notifications.set(notificationId, {
      id: notificationId,
      schemaVersion: 1,
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
      kind: 'role.revoked',
      status: 'unread',
      title: 'Finance role revoked',
      body: `${existing.role} revoked on ${existing.legalEntityId}`,
      href: '/portal/finance/practice',
      targetUserId: existing.userId,
      actorId: actor.uid,
      aggregateType: 'finance_role_assignment',
      aggregateId: id,
      createdAt: at,
      externalEgressAllowed: false,
    })

    await this.save(before, after)
    return revoked
  }

  async emitNotification(
    actor: FinanceActorContext,
    command: EmitFinanceNotificationCommand,
  ): Promise<FinanceOperatorNotification> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const scope: FinanceScope = {
      orgId,
      legalEntityId,
      bookId: command.bookId ? requiredText(command.bookId, 'bookId') : undefined,
    }
    assertOrgMembership(actor, orgId)
    authorizeFinanceAction(actor, scope, 'notification.emit', at)
    claim(after, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate notification emit')

    const existing = after.notifications.get(command.id)
    if (existing) {
      if (existing.orgId !== orgId) throw new PracticeFinanceValidationError('Notification id collision across tenants')
      return existing
    }

    const notification: FinanceOperatorNotification = {
      id: requiredText(command.id, 'id'),
      schemaVersion: 1,
      orgId,
      legalEntityId,
      bookId: scope.bookId,
      kind: command.kind,
      status: 'unread',
      title: requiredText(command.title, 'title'),
      body: requiredText(command.body, 'body'),
      href: command.href,
      targetUserId: command.targetUserId,
      actorId: actor.uid,
      aggregateType: command.aggregateType,
      aggregateId: command.aggregateId,
      createdAt: at,
      externalEgressAllowed: false,
    }
    after.notifications.set(notification.id, notification)
    await this.save(before, after)
    return notification
  }

  async markNotification(
    actor: FinanceActorContext,
    command: MarkFinanceNotificationCommand,
  ): Promise<FinanceOperatorNotification> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const orgId = requiredText(command.orgId, 'orgId')
    canReadNotifications(actor, orgId, at)
    const existing = after.notifications.get(command.id)
    if (!existing || existing.orgId !== orgId) {
      throw new PracticeFinanceValidationError('Notification not found')
    }
    if (existing.targetUserId && existing.targetUserId !== actor.uid && actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
      throw new PracticeFinanceValidationError('Notification not found')
    }
    claim(after, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate notification mark')
    const next: FinanceOperatorNotification = {
      ...existing,
      status: command.status,
      readAt: command.status === 'read' || command.status === 'dismissed' ? at : existing.readAt,
    }
    after.notifications.set(next.id, next)
    await this.save(before, after)
    return next
  }

  async listAudit(actor: FinanceActorContext, query: PracticeAuditQuery): Promise<PracticeAuditEventView[]> {
    const store = await this.load()
    const at = this.now()
    const orgId = requiredText(query.orgId, 'orgId')
    canReadAudit(actor, orgId, at, query.legalEntityId, query.bookId)
    return filterAuditEventsForQuery(store.auditEvents.values(), query)
  }

  /** Firm admin links a client org for practice work without forcing membership sprawl. */
  async upsertClientLink(
    actor: FinanceActorContext,
    command: UpsertPracticeClientLinkCommand,
  ): Promise<PracticeClientLink> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const firmOrgId = requiredText(command.firmOrgId, 'firmOrgId')
    const clientOrgId = requiredText(command.clientOrgId, 'clientOrgId')
    if (firmOrgId === clientOrgId) {
      throw new PracticeFinanceValidationError('firmOrgId and clientOrgId must differ')
    }
    assertOrgMembership(actor, firmOrgId)
    canManagePracticeGrants(actor, firmOrgId, at)
    claim(after, `idem:${firmOrgId}:${command.idempotencyKey}`, 'Duplicate practice client link request')

    const existing = after.clientLinks.get(command.id)
    if (existing && existing.firmOrgId !== firmOrgId) {
      throw new PracticeFinanceValidationError('Client link id collision across firms')
    }

    const link: PracticeClientLink = {
      id: requiredText(command.id, 'id'),
      schemaVersion: 1,
      firmOrgId,
      clientOrgId,
      clientName: requiredText(command.clientName, 'clientName'),
      status: command.status ?? 'active',
      relationshipId: command.relationshipId,
      openPeriodCount: Math.max(0, command.openPeriodCount ?? existing?.openPeriodCount ?? 0),
      closeBlockerCount: Math.max(0, command.closeBlockerCount ?? existing?.closeBlockerCount ?? 0),
      reconBacklogCount: Math.max(0, command.reconBacklogCount ?? existing?.reconBacklogCount ?? 0),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    after.clientLinks.set(link.id, link)

    const eventId = `gae_link_${link.id}_${after.grantAccessEvents.size + 1}`
    after.grantAccessEvents.set(
      eventId,
      newGrantAccessEvent({
        id: eventId,
        grant: {
          id: 'link',
          schemaVersion: 1,
          firmOrgId,
          clientOrgId,
          granteeUserId: actor.uid,
          role: 'review',
          status: 'active',
          createdBy: actor.uid,
          createdAt: at,
          ...grantSafetyFlags(),
        },
        actorUserId: actor.uid,
        action: 'grant.link.upsert',
        resource: link.id,
        occurredAt: at,
        reason: `Upsert client link ${clientOrgId}`,
        sequence: after.grantAccessEvents.size + 1,
      }),
    )

    await this.save(before, after)
    return link
  }

  async createGrant(actor: FinanceActorContext, command: CreatePracticeGrantCommand): Promise<PracticeClientGrant> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const firmOrgId = requiredText(command.firmOrgId, 'firmOrgId')
    const clientOrgId = requiredText(command.clientOrgId, 'clientOrgId')
    const granteeUserId = requiredText(command.granteeUserId, 'granteeUserId')
    if (!isPracticeGrantRole(command.role)) {
      throw new PracticeFinanceValidationError('role must be prepare, review, or file-export')
    }
    if (firmOrgId === clientOrgId) {
      throw new PracticeFinanceValidationError('firmOrgId and clientOrgId must differ')
    }
    assertOrgMembership(actor, firmOrgId)
    canManagePracticeGrants(actor, firmOrgId, at)
    claim(after, `idem:${firmOrgId}:${command.idempotencyKey}`, 'Duplicate practice grant request')

    const activeLink = [...after.clientLinks.values()].find(
      (l) => l.firmOrgId === firmOrgId && l.clientOrgId === clientOrgId && l.status === 'active',
    )
    if (!activeLink) {
      throw new PracticeFinanceValidationError('Active firm→client link required before creating a grant')
    }

    const existing = after.grants.get(command.id)
    if (existing) {
      if (existing.firmOrgId !== firmOrgId) throw new PracticeFinanceValidationError('Grant id collision across firms')
      return existing
    }

    // One active grant per grantee+client+role+entity scope key
    const scopeKey = `${granteeUserId}|${clientOrgId}|${command.role}|${(command.legalEntityIds ?? []).slice().sort().join(',')}|${(command.bookIds ?? []).slice().sort().join(',')}`
    for (const g of after.grants.values()) {
      if (g.status !== 'active' || g.firmOrgId !== firmOrgId) continue
      const otherKey = `${g.granteeUserId}|${g.clientOrgId}|${g.role}|${(g.legalEntityIds ?? []).slice().sort().join(',')}|${(g.bookIds ?? []).slice().sort().join(',')}`
      if (otherKey === scopeKey) {
        throw new PracticeFinanceValidationError('Active practice grant already exists for this scope')
      }
    }

    const grant: PracticeClientGrant = {
      id: requiredText(command.id, 'id'),
      schemaVersion: 1,
      firmOrgId,
      clientOrgId,
      granteeUserId,
      role: command.role,
      status: 'active',
      legalEntityIds: command.legalEntityIds?.map((id) => requiredText(id, 'legalEntityId')),
      bookIds: command.bookIds?.map((id) => requiredText(id, 'bookId')),
      relationshipId: command.relationshipId ?? activeLink.relationshipId,
      createdBy: actor.uid,
      createdAt: at,
      ...grantSafetyFlags(),
    }
    after.grants.set(grant.id, grant)

    const auditId = `aud_grant_${grant.id}`
    after.auditEvents.set(auditId, {
      id: auditId,
      schemaVersion: 1,
      orgId: firmOrgId,
      legalEntityId: 'practice_firm',
      aggregateType: 'practice_client_grant',
      aggregateId: grant.id,
      aggregateVersion: 1,
      aggregateDigest: grant.id,
      eventType: 'practice.grant.created',
      actorId: actor.uid,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      correlationId: actor.correlationId,
      occurredAt: at,
      sequence: after.auditEvents.size + 1,
      canonicalPayloadVersion: 1,
      hashAlgorithmVersion: 'sha256-v1',
      eventHash: `hash_grant_${grant.id}`,
      reason: `Granted ${grant.role} on client ${clientOrgId} to ${granteeUserId}`,
    } as FinanceAuditEvent)

    const eventId = `gae_${grant.id}_create`
    after.grantAccessEvents.set(
      eventId,
      newGrantAccessEvent({
        id: eventId,
        grant,
        actorUserId: actor.uid,
        action: 'grant.create',
        resource: grant.id,
        occurredAt: at,
        reason: `create ${grant.role}`,
        sequence: after.grantAccessEvents.size + 1,
      }),
    )

    const notificationId = `ntf_grant_${grant.id}`
    after.notifications.set(notificationId, {
      id: notificationId,
      schemaVersion: 1,
      orgId: firmOrgId,
      legalEntityId: 'practice_firm',
      kind: 'practice.grant.created',
      status: 'unread',
      title: 'Practice grant created',
      body: `${grant.role} on ${clientOrgId} → ${granteeUserId}`,
      href: '/portal/finance/practice#grants',
      targetUserId: granteeUserId,
      actorId: actor.uid,
      aggregateType: 'practice_client_grant',
      aggregateId: grant.id,
      createdAt: at,
      externalEgressAllowed: false,
    })

    await this.save(before, after)
    return grant
  }

  async revokeGrant(actor: FinanceActorContext, command: RevokePracticeGrantCommand): Promise<PracticeClientGrant> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const firmOrgId = requiredText(command.firmOrgId, 'firmOrgId')
    const id = requiredText(command.id, 'id')
    const existing = after.grants.get(id)
    if (!existing || existing.firmOrgId !== firmOrgId) {
      throw new PracticeFinanceValidationError('Practice grant not found')
    }
    assertOrgMembership(actor, firmOrgId)
    canManagePracticeGrants(actor, firmOrgId, at)
    claim(after, `idem:${firmOrgId}:${command.idempotencyKey}`, 'Duplicate practice grant revoke')

    if (existing.status === 'revoked') return existing

    const revoked: PracticeClientGrant = {
      ...existing,
      status: 'revoked',
      revokedBy: actor.uid,
      revokedAt: at,
      revokeReason: command.reason,
      ...grantSafetyFlags(),
    }
    after.grants.set(id, revoked)

    const auditId = `aud_grant_rev_${id}_${after.auditEvents.size + 1}`
    after.auditEvents.set(auditId, {
      id: auditId,
      schemaVersion: 1,
      orgId: firmOrgId,
      legalEntityId: 'practice_firm',
      aggregateType: 'practice_client_grant',
      aggregateId: id,
      aggregateVersion: 2,
      aggregateDigest: id,
      eventType: 'practice.grant.revoked',
      actorId: actor.uid,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      correlationId: actor.correlationId,
      occurredAt: at,
      sequence: after.auditEvents.size + 1,
      canonicalPayloadVersion: 1,
      hashAlgorithmVersion: 'sha256-v1',
      eventHash: `hash_grant_rev_${id}`,
      reason: command.reason || `Revoked ${existing.role}`,
    } as FinanceAuditEvent)

    const eventId = `gae_${id}_revoke_${after.grantAccessEvents.size + 1}`
    after.grantAccessEvents.set(
      eventId,
      newGrantAccessEvent({
        id: eventId,
        grant: revoked,
        actorUserId: actor.uid,
        action: 'grant.revoke',
        resource: id,
        occurredAt: at,
        reason: command.reason || 'revoked',
        sequence: after.grantAccessEvents.size + 1,
      }),
    )

    const notificationId = `ntf_grant_rev_${id}`
    after.notifications.set(notificationId, {
      id: notificationId,
      schemaVersion: 1,
      orgId: firmOrgId,
      legalEntityId: 'practice_firm',
      kind: 'practice.grant.revoked',
      status: 'unread',
      title: 'Practice grant revoked',
      body: `${existing.role} on ${existing.clientOrgId} revoked for ${existing.granteeUserId}`,
      href: '/portal/finance/practice#grants',
      targetUserId: existing.granteeUserId,
      actorId: actor.uid,
      aggregateType: 'practice_client_grant',
      aggregateId: id,
      createdAt: at,
      externalEgressAllowed: false,
    })

    await this.save(before, after)
    return revoked
  }

  /**
   * Recorded authorize path for grantee acting on client books.
   * Mutating client modules should call this (or the pure helper) before side effects.
   */
  async authorizeGrantAccess(
    actor: FinanceActorContext,
    command: AuthorizePracticeGrantAccessCommand,
  ): Promise<{ allowed: true; grant: PracticeClientGrant; event: PracticeGrantAccessEvent }> {
    const before = await this.load()
    const after = clonePracticeStore(before)
    const at = this.now()
    const firmOrgId = requiredText(command.firmOrgId, 'firmOrgId')
    const clientOrgId = requiredText(command.clientOrgId, 'clientOrgId')
    claim(after, `idem:${firmOrgId}:${command.idempotencyKey}`, 'Duplicate practice grant access claim')

    try {
      const grant = authorizePracticeGrantAction({
        actor,
        firmOrgId,
        clientOrgId,
        action: command.action,
        grants: after.grants.values(),
        legalEntityId: command.legalEntityId,
        bookId: command.bookId,
      })
      const eventId = `gae_access_${grant.id}_${after.grantAccessEvents.size + 1}`
      const event = newGrantAccessEvent({
        id: eventId,
        grant,
        actorUserId: actor.uid,
        action: 'grant.access',
        resource: command.resource,
        financeAction: command.action,
        occurredAt: at,
        sequence: after.grantAccessEvents.size + 1,
      })
      after.grantAccessEvents.set(eventId, event)
      await this.save(before, after)
      return { allowed: true as const, grant, event }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'denied'
      const synthetic: PracticeClientGrant = {
        id: 'denied',
        schemaVersion: 1,
        firmOrgId,
        clientOrgId,
        granteeUserId: actor.uid,
        role: 'review',
        status: 'active',
        createdBy: actor.uid,
        createdAt: at,
        ...grantSafetyFlags(),
      }
      const eventId = `gae_denied_${firmOrgId}_${clientOrgId}_${after.grantAccessEvents.size + 1}`
      after.grantAccessEvents.set(
        eventId,
        newGrantAccessEvent({
          id: eventId,
          grant: synthetic,
          actorUserId: actor.uid,
          action: 'grant.denied',
          resource: command.resource,
          financeAction: command.action,
          occurredAt: at,
          reason,
          sequence: after.grantAccessEvents.size + 1,
        }),
      )
      await this.save(before, after)
      throw err
    }
  }

  async getPracticeQueue(actor: FinanceActorContext, firmOrgId: string): Promise<PracticeQueueItem[]> {
    const store = await this.load()
    const at = this.now()
    const orgId = requiredText(firmOrgId, 'firmOrgId')
    canReadRoles(actor, orgId, at)
    const queue = buildPracticeQueue({
      firmOrgId: orgId,
      links: store.clientLinks.values(),
      grants: store.grants.values(),
    })
    return queue
  }
}

export { PRACTICE_GRANT_HARD_DENY_ACTIONS, authorizePracticeGrantAction, grantAllowsAction } from './grants'
