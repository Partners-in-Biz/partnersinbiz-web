import type { FinanceRole } from '@/lib/finance/types'
import type {
  FinanceGuidedWorkflow,
  FinanceGuidedWorkflowId,
  FinancePersona,
  FinanceRoleHubModule,
  FinanceRoleUxContext,
  RoleGatedLink,
} from './types'
import type { FinanceOperatorNotification, PracticeAuditEventView } from '@/lib/finance/practice/types'

const OWNER_ADMIN_ROLES: readonly FinanceRole[] = ['finance_admin']
const APPROVER_ROLES: readonly FinanceRole[] = [
  'finance_admin',
  'finance_approver',
  'accountant',
  'payroll_approver',
]
const BOOKKEEPER_ROLES: readonly FinanceRole[] = [
  'finance_admin',
  'bookkeeper',
  'accountant',
  'finance_approver',
  'payroll_clerk',
]
const ACCOUNTANT_ROLES: readonly FinanceRole[] = [
  'finance_admin',
  'accountant',
  'finance_approver',
]
const PRACTICE_ROLES: readonly FinanceRole[] = [
  'finance_admin',
  'accountant',
  'finance_approver',
  'bookkeeper',
]
const READ_ROLES: readonly FinanceRole[] = [
  'finance_admin',
  'accountant',
  'finance_approver',
  'bookkeeper',
  'finance_viewer',
  'payroll_clerk',
  'payroll_approver',
]

export const FINANCE_ROLE_HUB_MODULES: readonly FinanceRoleHubModule[] = [
  {
    id: 'owner.cash',
    persona: 'owner',
    title: 'Cash position',
    summary: 'Bank balances and runway signals without initiating payments.',
    href: '/portal/finance',
    icon: 'account_balance_wallet',
    allowedRoles: READ_ROLES,
    allowOrgOwnerAdmin: true,
    emphasis: 'primary',
  },
  {
    id: 'owner.runway',
    persona: 'owner',
    title: 'Runway & budgets',
    summary: 'Cashflow plan and budget variance for owner decisions.',
    href: '/portal/finance/budgets',
    icon: 'trending_up',
    allowedRoles: [...OWNER_ADMIN_ROLES, 'accountant', 'finance_approver', 'finance_viewer'],
    allowOrgOwnerAdmin: true,
  },
  {
    id: 'owner.approvals',
    persona: 'owner',
    title: 'Approval queue',
    summary: 'Pay runs, recon, tax packs, and journals waiting for SOD approval.',
    href: '/portal/finance/practice',
    icon: 'verified_user',
    allowedRoles: APPROVER_ROLES,
    allowOrgOwnerAdmin: true,
    emphasis: 'primary',
  },
  {
    id: 'bookkeeper.daily_capture',
    persona: 'bookkeeper',
    title: 'Daily capture',
    summary: 'Invoices, bills, and journals for today’s books.',
    href: '/portal/finance/documents',
    icon: 'edit_note',
    allowedRoles: BOOKKEEPER_ROLES,
    emphasis: 'primary',
  },
  {
    id: 'bookkeeper.recon_queue',
    persona: 'bookkeeper',
    title: 'Reconciliation queue',
    summary: 'Suggested matches awaiting human accept — never auto-post.',
    href: '/portal/finance/statements',
    icon: 'fact_check',
    allowedRoles: BOOKKEEPER_ROLES,
    emphasis: 'primary',
  },
  {
    id: 'bookkeeper.bank_import',
    persona: 'bookkeeper',
    title: 'Bank import & rules',
    summary: 'CSV/OFX/MT940 import and human-gated bank rules.',
    href: '/portal/finance/bank-rules',
    icon: 'account_balance',
    allowedRoles: BOOKKEEPER_ROLES,
  },
  {
    id: 'accountant.period_close',
    persona: 'accountant',
    title: 'Period close',
    summary: 'Close blockers, adjustments, and period lock readiness.',
    href: '/portal/finance/ledger',
    icon: 'lock_clock',
    allowedRoles: ACCOUNTANT_ROLES,
    emphasis: 'primary',
  },
  {
    id: 'accountant.reports',
    persona: 'accountant',
    title: 'Reports pack',
    summary: 'Trial balance, P&L, and balance sheet for the open book.',
    href: '/portal/finance/reports',
    icon: 'analytics',
    allowedRoles: [...ACCOUNTANT_ROLES, 'finance_viewer', 'bookkeeper'],
    emphasis: 'primary',
  },
  {
    id: 'accountant.packs',
    persona: 'accountant',
    title: 'Accountant & statutory packs',
    summary: 'Download-only packaging. No SARS submit, no payout.',
    href: '/portal/finance/packaging',
    icon: 'inventory_2',
    allowedRoles: [...ACCOUNTANT_ROLES, 'payroll_approver', 'payroll_clerk'],
  },
  {
    id: 'practice.multi_client',
    persona: 'practice',
    title: 'Multi-client switcher',
    summary: 'Jump between finance-enabled memberships with X-Org-Id scope.',
    href: '/portal/finance/practice',
    icon: 'swap_horiz',
    allowedRoles: PRACTICE_ROLES,
    allowOrgOwnerAdmin: true,
    emphasis: 'primary',
  },
  {
    id: 'practice.notification_centre',
    persona: 'practice',
    title: 'Notification centre',
    summary: 'In-app operator inbox for pay runs, recon, and cutover events.',
    href: '/portal/finance/practice#notifications',
    icon: 'notifications',
    allowedRoles: READ_ROLES,
    allowOrgOwnerAdmin: true,
  },
  {
    id: 'practice.audit_explorer',
    persona: 'practice',
    title: 'Audit explorer',
    summary: 'Filter by actor, entity, event type and export CSV for the current org.',
    href: '/portal/finance/practice#audit',
    icon: 'policy',
    allowedRoles: [...ACCOUNTANT_ROLES, 'bookkeeper', 'finance_viewer'],
    allowOrgOwnerAdmin: true,
  },
] as const

export const FINANCE_GUIDED_WORKFLOWS: readonly FinanceGuidedWorkflow[] = [
  {
    id: 'first_month_close',
    title: 'First month close',
    description: 'Bring the first full period to a close-ready state without spreadsheets.',
    personas: ['owner', 'accountant', 'bookkeeper', 'practice'],
    steps: [
      {
        id: 'close.scope',
        title: 'Confirm entity & book',
        detail: 'Select the legal entity and primary book on the hub scope bar.',
        href: '/portal/finance',
        allowedRoles: READ_ROLES,
        allowOrgOwnerAdmin: true,
      },
      {
        id: 'close.capture',
        title: 'Finish daily capture',
        detail: 'Issue invoices, enter bills, and post routine journals.',
        href: '/portal/finance/documents',
        allowedRoles: BOOKKEEPER_ROLES,
      },
      {
        id: 'close.bank',
        title: 'Complete bank reconciliation',
        detail: 'Import statements, apply rules, and approve zero-difference recon (SOD).',
        href: '/portal/finance/statements',
        allowedRoles: BOOKKEEPER_ROLES,
        approvalGated: true,
      },
      {
        id: 'close.payroll',
        title: 'Lock pay run if applicable',
        detail: 'Calculate → submit → approve/lock. Creator cannot approve.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'payroll_approver', 'accountant'],
        approvalGated: true,
      },
      {
        id: 'close.reports',
        title: 'Review TB / P&L / BS',
        detail: 'Confirm balances before period close.',
        href: '/portal/finance/reports',
        allowedRoles: [...ACCOUNTANT_ROLES, 'finance_viewer', 'bookkeeper'],
      },
      {
        id: 'close.period',
        title: 'Close the period',
        detail: 'Accountant/approver closes the period when blockers are clear.',
        href: '/portal/finance/ledger',
        allowedRoles: ACCOUNTANT_ROLES,
        approvalGated: true,
      },
      {
        id: 'close.pack',
        title: 'Export accountant pack',
        detail: 'Download-only packaging. No SARS submit.',
        href: '/portal/finance/packaging',
        allowedRoles: [...ACCOUNTANT_ROLES, 'payroll_approver'],
        hardGateNote: 'externalEgressAllowed=false · sarsSubmissionInitiated=false',
      },
    ],
  },
  {
    id: 'first_pay_run',
    title: 'First pay run',
    description: 'Walk a ZA pay run from employee setup to locked payslips (export only).',
    personas: ['owner', 'bookkeeper', 'accountant', 'practice'],
    steps: [
      {
        id: 'pay.employees',
        title: 'Confirm employees & terms',
        detail: 'Master data and approved payroll rule version must exist.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'payroll_approver', 'accountant'],
      },
      {
        id: 'pay.calendar',
        title: 'Check pay calendar cutoff',
        detail: 'Do not freeze or submit before cut-off.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'payroll_approver', 'accountant', 'bookkeeper'],
      },
      {
        id: 'pay.calculate',
        title: 'Calculate the run',
        detail: 'Calculate against the approved immutable rule version.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'accountant'],
      },
      {
        id: 'pay.submit',
        title: 'Submit for approval',
        detail: 'Moves draft/calculated → in_review. Creator cannot lock.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'accountant'],
      },
      {
        id: 'pay.approve',
        title: 'Approve & lock',
        detail: 'SOD: submitter ≠ approver. Bookkeeper cannot approve.',
        href: '/portal/finance/payroll',
        allowedRoles: ['finance_admin', 'payroll_approver'],
        approvalGated: true,
        hardGateNote: 'externalPaymentInitiated=false · payslips internal_only',
      },
      {
        id: 'pay.pack',
        title: 'Download payslip / net pay pack',
        detail: 'Browser download only — no mass email.',
        href: '/portal/finance/packaging',
        allowedRoles: ['finance_admin', 'payroll_clerk', 'payroll_approver', 'accountant'],
        hardGateNote: 'massEmailAllowed=false · externalEgressAllowed=false',
      },
    ],
  },
  {
    id: 'first_bank_recon',
    title: 'First bank reconciliation',
    description: 'Import a statement, apply rules, and approve a balanced recon.',
    personas: ['bookkeeper', 'accountant', 'owner', 'practice'],
    steps: [
      {
        id: 'recon.import',
        title: 'Import bank statement',
        detail: 'CSV, OFX, or MT940 into statements workbench.',
        href: '/portal/finance/statements',
        allowedRoles: BOOKKEEPER_ROLES,
      },
      {
        id: 'recon.rules',
        title: 'Evaluate bank rules',
        detail: 'Suggestions only — rules never auto-post.',
        href: '/portal/finance/bank-rules',
        allowedRoles: BOOKKEEPER_ROLES,
        hardGateNote: 'bank rules never auto-post',
      },
      {
        id: 'recon.match',
        title: 'Accept / dismiss matches',
        detail: 'Human-gated accept for each suggestion.',
        href: '/portal/finance/statements',
        allowedRoles: BOOKKEEPER_ROLES,
      },
      {
        id: 'recon.difference',
        title: 'Clear difference to zero',
        detail: 'No silent balancing plug. Difference must be 0 before approve.',
        href: '/portal/finance/statements',
        allowedRoles: BOOKKEEPER_ROLES,
      },
      {
        id: 'recon.approve',
        title: 'Approve reconciliation (SOD)',
        detail: 'Approver role required; preparer cannot self-approve when SOD applies.',
        href: '/portal/finance/statements',
        allowedRoles: APPROVER_ROLES,
        approvalGated: true,
      },
    ],
  },
] as const

const PERSONA_PRIORITY: readonly FinancePersona[] = ['practice', 'owner', 'accountant', 'bookkeeper']

export function resolveFinancePersona(ctx: FinanceRoleUxContext): FinancePersona {
  const roles = new Set(ctx.roles)
  const practiceClients = ctx.practiceClientCount ?? 0
  if (practiceClients >= 2 && (roles.has('finance_admin') || roles.has('accountant') || ctx.membershipRole === 'admin' || ctx.membershipRole === 'owner')) {
    return 'practice'
  }
  if (ctx.membershipRole === 'owner' || roles.has('finance_admin')) {
    return 'owner'
  }
  if (roles.has('accountant') || roles.has('finance_approver') || roles.has('payroll_approver')) {
    return 'accountant'
  }
  if (roles.has('bookkeeper') || roles.has('payroll_clerk') || roles.has('finance_viewer')) {
    return 'bookkeeper'
  }
  if (ctx.membershipRole === 'admin') return 'owner'
  return 'bookkeeper'
}

export function actorCanAccessModule(ctx: FinanceRoleUxContext, module: FinanceRoleHubModule): boolean {
  if (module.allowOrgOwnerAdmin && (ctx.membershipRole === 'owner' || ctx.membershipRole === 'admin')) {
    return true
  }
  return module.allowedRoles.some((role) => ctx.roles.includes(role))
}

export function actorCanCompleteStep(
  ctx: FinanceRoleUxContext,
  step: { allowedRoles: readonly FinanceRole[]; allowOrgOwnerAdmin?: boolean },
): boolean {
  if (step.allowOrgOwnerAdmin && (ctx.membershipRole === 'owner' || ctx.membershipRole === 'admin')) {
    return true
  }
  return step.allowedRoles.some((role) => ctx.roles.includes(role))
}

export function buildRoleHubModules(
  ctx: FinanceRoleUxContext,
  options?: { persona?: FinancePersona; includeOtherPersonas?: boolean },
): FinanceRoleHubModule[] {
  const persona = options?.persona ?? resolveFinancePersona(ctx)
  const includeOther = options?.includeOtherPersonas ?? false
  return FINANCE_ROLE_HUB_MODULES.filter((module) => {
    if (!includeOther && module.persona !== persona) return false
    return actorCanAccessModule(ctx, module)
  }).sort((a, b) => {
    if (a.persona !== b.persona) {
      return PERSONA_PRIORITY.indexOf(a.persona) - PERSONA_PRIORITY.indexOf(b.persona)
    }
    const ea = a.emphasis === 'primary' ? 0 : 1
    const eb = b.emphasis === 'primary' ? 0 : 1
    return ea - eb || a.title.localeCompare(b.title)
  })
}

export function getGuidedWorkflow(id: FinanceGuidedWorkflowId): FinanceGuidedWorkflow {
  const wf = FINANCE_GUIDED_WORKFLOWS.find((row) => row.id === id)
  if (!wf) throw new Error(`Unknown guided workflow: ${id}`)
  return wf
}

export function buildGuidedWorkflowView(
  id: FinanceGuidedWorkflowId,
  ctx: FinanceRoleUxContext,
): {
  workflow: FinanceGuidedWorkflow
  steps: Array<
    FinanceGuidedWorkflow['steps'][number] & {
      canComplete: boolean
      status: 'available' | 'blocked_role' | 'approval_gated'
    }
  >
} {
  const workflow = getGuidedWorkflow(id)
  const steps = workflow.steps.map((step) => {
    const canComplete = actorCanCompleteStep(ctx, step)
    let status: 'available' | 'blocked_role' | 'approval_gated' = 'available'
    if (!canComplete) status = 'blocked_role'
    else if (step.approvalGated) status = 'approval_gated'
    return { ...step, canComplete, status }
  })
  return { workflow, steps }
}

export function listGuidedWorkflowsForPersona(persona: FinancePersona): FinanceGuidedWorkflow[] {
  return FINANCE_GUIDED_WORKFLOWS.filter((wf) => wf.personas.includes(persona))
}

export function gateRoleLink(
  ctx: FinanceRoleUxContext,
  link: { href: string; title: string; allowedRoles: readonly FinanceRole[]; allowOrgOwnerAdmin?: boolean },
): RoleGatedLink {
  const visible = actorCanCompleteStep(ctx, link)
  return {
    href: link.href,
    title: link.title,
    visible,
    reason: visible ? undefined : 'Role cannot access this finance action',
  }
}

/** Bookkeeper must never be treated as able to approve pay runs via role UX. */
export function assertBookkeeperCannotApprovePayRun(ctx: FinanceRoleUxContext): boolean {
  if (ctx.roles.includes('finance_admin') || ctx.roles.includes('payroll_approver')) return false
  if (!ctx.roles.includes('bookkeeper')) return false
  const pay = buildGuidedWorkflowView('first_pay_run', ctx)
  const approve = pay.steps.find((s) => s.id === 'pay.approve')
  return approve?.canComplete === false
}

export function filterNotificationsForCentre<T extends Pick<FinanceOperatorNotification, 'kind' | 'status' | 'title' | 'body'>>(
  notifications: readonly T[],
  filter: { kind?: string; status?: 'unread' | 'read' | 'dismissed' | 'all'; query?: string } = {},
): T[] {
  const status = filter.status ?? 'all'
  const kind = filter.kind?.trim()
  const q = filter.query?.trim().toLowerCase()
  return notifications.filter((n) => {
    if (status !== 'all' && n.status !== status) return false
    if (kind && n.kind !== kind) return false
    if (q) {
      const hay = `${n.title} ${n.body} ${n.kind}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function exportAuditEventsCsv(events: readonly PracticeAuditEventView[]): string {
  const columns = [
    { key: 'occurredAt' as const, label: 'occurredAt' },
    { key: 'eventType' as const, label: 'eventType' },
    { key: 'actorId' as const, label: 'actorId' },
    { key: 'legalEntityId' as const, label: 'legalEntityId' },
    { key: 'bookId' as const, label: 'bookId' },
    { key: 'aggregateType' as const, label: 'aggregateType' },
    { key: 'aggregateId' as const, label: 'aggregateId' },
    { key: 'sequence' as const, label: 'sequence' },
    { key: 'eventHash' as const, label: 'eventHash' },
    { key: 'orgId' as const, label: 'orgId' },
    { key: 'id' as const, label: 'id' },
  ]
  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((c) => escape(c.label)).join(',')
  if (events.length === 0) return `${header}\n`
  const body = events
    .map((row) =>
      columns
        .map((c) => escape((row as unknown as Record<string, unknown>)[c.key]))
        .join(','),
    )
    .join('\n')
  return `${header}\n${body}\n`
}

export function uniqueAuditActors(events: readonly PracticeAuditEventView[]): string[] {
  return [...new Set(events.map((e) => e.actorId).filter(Boolean))].sort()
}

export function uniqueAuditEventTypes(events: readonly PracticeAuditEventView[]): string[] {
  return [...new Set(events.map((e) => e.eventType).filter(Boolean))].sort()
}

export function uniqueAuditEntities(events: readonly PracticeAuditEventView[]): string[] {
  return [...new Set(events.map((e) => e.legalEntityId).filter(Boolean))].sort()
}
