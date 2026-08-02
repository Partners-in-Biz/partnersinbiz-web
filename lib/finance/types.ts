export type AccountingBasis = 'cash' | 'accrual'
export type FinanceRole =
  | 'finance_viewer'
  | 'bookkeeper'
  | 'accountant'
  | 'finance_approver'
  | 'payroll_clerk'
  | 'payroll_approver'
  | 'finance_admin'

export interface FinanceScope {
  orgId: string
  legalEntityId: string
  bookId?: string
}

export interface FinanceRoleAssignment extends FinanceScope {
  id: string
  userId: string
  scopeMode: 'entity' | 'book'
  role: FinanceRole
  status: 'active' | 'revoked' | 'expired'
  effectiveFrom?: string
  effectiveTo?: string
}

export interface FinanceActorContext {
  uid: string
  orgId: string
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer'
  membershipActive: boolean
  financeModuleEnabled: boolean
  assignments: FinanceRoleAssignment[]
  correlationId?: string
  delegationId?: string
  delegationOrgId?: string
  delegationScopes?: string[]
  authKind?: 'human' | 'delegation' | 'system'
}

export type FinanceApprovalAction =
  | 'book-policy.approve'
  | 'journal.post'
  | 'journal.reverse'
  | 'period.reopen'
  | 'period.close'
  | 'period.adjust'
  | 'tax-rule.approve'
  | 'tax.return.prepare'
  | 'tax.return.approve'
  | 'reconciliation.approve'
  | 'intercompany.receive'
  | 'elimination.rule.approve'
  | 'consolidation.run.approve'
  | 'payroll.rule.approve'
  | 'payroll.run.approve'
  | 'payroll.run.reverse'
  | 'payroll.adjustment.approve'
  | 'payroll.tax_year.lock'
  | 'payroll.ytd_opening.approve'
  | 'payroll.statutory.approve'
  | 'payroll.export.approve'
  | 'asset.depreciation.run.post'
  | 'asset.dispose'

export interface FinanceApprovalEvidence {
  approvalId: string
  approvedBy: string
  approvedAt: string
  action: FinanceApprovalAction
  reason: string
}

export interface FinanceApprovalRecord extends Required<FinanceScope> {
  id: string
  schemaVersion: 1
  action: FinanceApprovalAction
  status: 'approved'
  approvedBy: string
  approverRole: FinanceRole
  approverAssignmentId: string
  approvedAt: string
  reason: string
  subjectDigest: string
  expiresAt?: string
  immutable: true
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: 'sha256-v1'
  contentHash: string
}

export interface VersionedFinanceRecord extends FinanceScope {
  id: string
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}
