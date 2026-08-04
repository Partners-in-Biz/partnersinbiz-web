import type { FinanceRole, FinanceRoleAssignment, FinanceScope } from '@/lib/finance/types'

export type FinanceOperatorNotificationKind =
  | 'payroll.run.submitted'
  | 'reconciliation.awaiting_approval'
  | 'cutover.ready'
  | 'role.assigned'
  | 'role.revoked'
  | 'practice.generic'
  | 'practice.grant.created'
  | 'practice.grant.revoked'

/** Firm→client practice grant roles (least privilege; not full org membership). */
export type PracticeGrantRole = 'prepare' | 'review' | 'file-export'

export type PracticeGrantStatus = 'active' | 'revoked'

export type PracticeGrantAccessAction =
  | 'grant.create'
  | 'grant.revoke'
  | 'grant.access'
  | 'grant.denied'
  | 'grant.link.upsert'
  | 'grant.queue.read'

export interface PracticeClientLink {
  id: string
  schemaVersion: 1
  firmOrgId: string
  clientOrgId: string
  clientName: string
  status: 'active' | 'inactive'
  /** Optional CRM / business relationship id — does not open packaging egress. */
  relationshipId?: string
  openPeriodCount?: number
  closeBlockerCount?: number
  reconBacklogCount?: number
  createdAt: string
  updatedAt: string
}

export interface PracticeClientGrant {
  id: string
  schemaVersion: 1
  firmOrgId: string
  clientOrgId: string
  granteeUserId: string
  role: PracticeGrantRole
  status: PracticeGrantStatus
  /** Empty / omitted = all entities under the client link. */
  legalEntityIds?: string[]
  bookIds?: string[]
  relationshipId?: string
  createdBy: string
  createdAt: string
  revokedBy?: string
  revokedAt?: string
  revokeReason?: string
  /** Hard safety flags — always false. */
  clientVisibleMessagesAllowed: false
  externalEgressAllowed: false
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface PracticeGrantAccessEvent {
  id: string
  schemaVersion: 1
  firmOrgId: string
  clientOrgId: string
  grantId: string
  actorUserId: string
  action: PracticeGrantAccessAction
  resource?: string
  financeAction?: string
  occurredAt: string
  reason?: string
  sequence: number
  externalEgressAllowed: false
  clientVisibleMessagesAllowed: false
}

export interface PracticeQueueItem {
  firmOrgId: string
  clientOrgId: string
  clientName: string
  attention: 'open_period' | 'close_blocker' | 'recon_backlog' | 'grant_only'
  severity: 'info' | 'warning' | 'high'
  summary: string
  grantIds: string[]
  openPeriodCount?: number
  closeBlockerCount?: number
  reconBacklogCount?: number
}

export type FinanceOperatorNotificationStatus = 'unread' | 'read' | 'dismissed'

export interface FinanceOperatorNotification extends FinanceScope {
  id: string
  schemaVersion: 1
  kind: FinanceOperatorNotificationKind
  status: FinanceOperatorNotificationStatus
  title: string
  body: string
  href?: string
  targetUserId?: string
  actorId: string
  aggregateType?: string
  aggregateId?: string
  createdAt: string
  readAt?: string
  externalEgressAllowed: false
}

export interface PracticeClientSummary {
  orgId: string
  orgName: string
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer'
  financeModuleEnabled: boolean
  assignmentCount: number
  roles: FinanceRole[]
  legalEntityIds: string[]
  isCurrent: boolean
}

export interface FinanceRoleMatrixRow {
  action: string
  roles: readonly FinanceRole[]
  approvalGated: boolean
  audited: boolean
}

export interface PracticeAuditQuery {
  orgId: string
  legalEntityId?: string
  bookId?: string
  actorId?: string
  eventType?: string
  from?: string
  to?: string
  limit?: number
}

export interface PracticeAuditEventView {
  id: string
  orgId: string
  legalEntityId: string
  bookId?: string
  eventType: string
  actorId: string
  aggregateType: string
  aggregateId: string
  occurredAt: string
  reason?: string
  sequence: number
  eventHash: string
  externalEgressAllowed: false
}

export interface PracticeWorkspaceBundle {
  orgId: string
  matrix: FinanceRoleMatrixRow[]
  assignments: FinanceRoleAssignment[]
  myAssignments: FinanceRoleAssignment[]
  notifications: FinanceOperatorNotification[]
  auditEvents: PracticeAuditEventView[]
  practiceClients: PracticeClientSummary[]
  /** Firm→client grants issued by this firm org (active + revoked). */
  grants: PracticeClientGrant[]
  /** Active grants where the actor is grantee (may span client orgs). */
  myGrants: PracticeClientGrant[]
  clientLinks: PracticeClientLink[]
  practiceQueue: PracticeQueueItem[]
  grantAccessEvents: PracticeGrantAccessEvent[]
  safety: {
    noSarsSubmit: true
    noExternalPaymentInitiate: true
    tenantScoped: true
    clientVisibleMessagesAllowed: false
    externalEgressAllowed: false
    practiceGrantsEnabled: true
  }
}
