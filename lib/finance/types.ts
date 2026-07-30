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
  assignments: FinanceRoleAssignment[]
  correlationId?: string
  delegationId?: string
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
