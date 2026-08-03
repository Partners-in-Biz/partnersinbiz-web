import type { FinanceRole } from '@/lib/finance/types'

/** Operator personas for role-dense finance hub modules (not a second skin). */
export type FinancePersona = 'owner' | 'bookkeeper' | 'accountant' | 'practice'

export type FinanceGuidedWorkflowId = 'first_month_close' | 'first_pay_run' | 'first_bank_recon'

export type FinanceRoleHubModuleId =
  | 'owner.cash'
  | 'owner.runway'
  | 'owner.approvals'
  | 'bookkeeper.daily_capture'
  | 'bookkeeper.recon_queue'
  | 'bookkeeper.bank_import'
  | 'accountant.period_close'
  | 'accountant.reports'
  | 'accountant.packs'
  | 'practice.multi_client'
  | 'practice.notification_centre'
  | 'practice.audit_explorer'

export interface FinanceRoleHubModule {
  id: FinanceRoleHubModuleId
  persona: FinancePersona
  title: string
  summary: string
  href: string
  icon: string
  /** Finance roles that may see this module card. Empty = persona-only (membership owner path). */
  allowedRoles: readonly FinanceRole[]
  /** When true, org membership owner/admin may also see the module without a finance role. */
  allowOrgOwnerAdmin?: boolean
  emphasis?: 'primary' | 'secondary'
}

export interface FinanceGuidedWorkflowStep {
  id: string
  title: string
  detail: string
  href: string
  /** Roles that can complete this step (viewer may observe but not complete gated steps). */
  allowedRoles: readonly FinanceRole[]
  allowOrgOwnerAdmin?: boolean
  approvalGated?: boolean
  hardGateNote?: string
}

export interface FinanceGuidedWorkflow {
  id: FinanceGuidedWorkflowId
  title: string
  description: string
  personas: readonly FinancePersona[]
  steps: readonly FinanceGuidedWorkflowStep[]
}

export interface FinanceRoleUxContext {
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer'
  /** Active finance roles for the actor in the current org. */
  roles: readonly FinanceRole[]
  /** Count of finance-enabled memberships for practice switcher density. */
  practiceClientCount?: number
}

export interface RoleGatedLink {
  href: string
  title: string
  visible: boolean
  reason?: string
}
