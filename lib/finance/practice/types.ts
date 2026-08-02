import type { FinanceRole, FinanceRoleAssignment, FinanceScope } from '@/lib/finance/types'

export type FinanceOperatorNotificationKind =
  | 'payroll.run.submitted'
  | 'reconciliation.awaiting_approval'
  | 'cutover.ready'
  | 'role.assigned'
  | 'role.revoked'
  | 'practice.generic'

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
  safety: {
    noSarsSubmit: true
    noExternalPaymentInitiate: true
    tenantScoped: true
  }
}
