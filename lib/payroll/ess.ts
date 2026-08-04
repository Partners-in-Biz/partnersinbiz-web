/**
 * Employee self-service (ESS) contracts — mobile/PWA-first payslip + leave surface.
 * Strict least privilege: never expose admin payroll controls or other employees' data
 * on the employee path. Packs are user-initiated download only (no mass email).
 */

export const ESS_HARD_GATES = {
  externalEgressAllowed: false as const,
  sarsSubmissionInitiated: false as const,
  externalPaymentInitiated: false as const,
  autoSent: false as const,
  massEmailAllowed: false as const,
  adminPayrollControls: false as const,
} as const

/** Commands allowed on the ESS surface (leave request + own payslip pack). */
export const ESS_ALLOWED_COMMANDS = [
  'leave.request',
  'leave.decide',
  'payslip.pack',
  'payslip.pack.mark-downloaded',
] as const

export type EssAllowedCommand = (typeof ESS_ALLOWED_COMMANDS)[number]

/** Admin-only payroll commands that must never appear on the ESS UI. */
export const ESS_BLOCKED_ADMIN_COMMANDS = [
  'employee.create',
  'employee.link-user',
  'calendar.create',
  'period.create',
  'leave-type.create',
  'leave-balance.set',
  'pay-run.create',
  'pay-run.freeze',
  'pay-run.approve',
  'payslip.bulk-pack',
  'salary-structure.create',
  'emp501.annual-pack',
] as const

export function isEssAllowedCommand(command: string): command is EssAllowedCommand {
  return (ESS_ALLOWED_COMMANDS as readonly string[]).includes(command)
}

export function isEssBlockedAdminCommand(command: string): boolean {
  return (ESS_BLOCKED_ADMIN_COMMANDS as readonly string[]).includes(command)
}

export type EssEmployeeCard = {
  id: string
  employeeNumber: string
  displayName: string
  status: string
}

export type EssLeaveTypeCard = {
  id: string
  code: string
  name: string
  unit: string
  payEffect: string
  hoursPerDay: number
  accrues: boolean
}

export type EssLeaveBalanceCard = {
  id: string
  leaveTypeId: string
  leaveTypeCode: string
  unit: string
  balanceQuantity: number
  balanceHours: number
  asOfDate: string
}

export type EssLeaveRecordCard = {
  id: string
  leaveTypeId: string
  leaveTypeCode: string
  startDate: string
  endDate: string
  unit: string
  quantity: number
  hours: number
  payEffect: string
  status: string
  note?: string
  version: number
}

export type EssPendingApprovalCard = EssLeaveRecordCard & {
  employeeId: string
  employeeLabel: string
}

export type EssPayslipCard = {
  id: string
  payDate: string
  periodStart: string
  periodEnd: string
  employeeId: string
  netPayMinor?: number
  currency?: string
  status: string
}

export type EssBundle = {
  surface: 'employee_self_service'
  linked: boolean
  employees: EssEmployeeCard[]
  leaveTypes: EssLeaveTypeCard[]
  leaveBalances: EssLeaveBalanceCard[]
  leaveRecords: EssLeaveRecordCard[]
  payslips: EssPayslipCard[]
  /** Present only when actor may payroll.leave.approve — never exposes bank/tax identity. */
  pendingApprovals: EssPendingApprovalCard[]
  canApproveLeave: boolean
  pwa: {
    installableShell: true
    startPath: '/portal/finance/ess'
    displayModeHint: 'standalone'
  }
  a11y: {
    pageLandmark: 'main'
    payslipListLabel: 'Your payslips'
    leaveBalanceListLabel: 'Your leave balances'
    leaveRequestFormLabel: 'Request leave'
    pendingApprovalsLabel: 'Leave awaiting your approval'
  }
  hardGates: typeof ESS_HARD_GATES
}

export function emptyEssBundle(canApproveLeave = false): EssBundle {
  return {
    surface: 'employee_self_service',
    linked: false,
    employees: [],
    leaveTypes: [],
    leaveBalances: [],
    leaveRecords: [],
    payslips: [],
    pendingApprovals: [],
    canApproveLeave,
    pwa: {
      installableShell: true,
      startPath: '/portal/finance/ess',
      displayModeHint: 'standalone',
    },
    a11y: {
      pageLandmark: 'main',
      payslipListLabel: 'Your payslips',
      leaveBalanceListLabel: 'Your leave balances',
      leaveRequestFormLabel: 'Request leave',
      pendingApprovalsLabel: 'Leave awaiting your approval',
    },
    hardGates: { ...ESS_HARD_GATES },
  }
}
