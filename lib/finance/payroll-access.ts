import { authorizeFinanceAction, FinanceAuthorizationError, type FinanceAction } from './policy'
import { FinanceNotFoundError } from './errors'
import { normalizeRequiredFinanceScope, type RequiredFinanceScope } from './scope'
import type { FinanceActorContext, FinanceRole, FinanceScope } from './types'

const SENSITIVE_PAYROLL_FIELDS = [
  'bankAccountNumber',
  'bankBranchCode',
  'bankAccount',
  'salaryBankAccount',
  'taxNumber',
  'nationalIdNumber',
  'idNumber',
  'passportNumber',
  'identityDocumentNumber',
  'encryptedIdentity',
  'encryptedBankDetails',
  'protectedIdentity',
  'protectedBank',
] as const

const PAYSLIP_READ_ACTION: FinanceAction = 'payroll.payslip.read'

export function sensitivePayrollFieldKeys(): readonly string[] {
  return SENSITIVE_PAYROLL_FIELDS
}

export function listPayslipReadableRoles(): readonly FinanceRole[] {
  return ['finance_admin', 'payroll_clerk', 'payroll_approver']
}

/**
 * Redact sensitive payroll identity/bank fields for default API/UI delivery.
 * Does not mutate the input object.
 */
export function redactSensitivePayrollRecord<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = { ...record }
  for (const key of SENSITIVE_PAYROLL_FIELDS) {
    if (key in next && next[key] !== undefined && next[key] !== null) {
      next[key] = '[redacted]'
    }
  }
  return next as T
}

export type PayslipReadOptions = {
  payslipId?: string
  /** Optional employee self-service path: linked platform user may read own payslip. */
  employeeLinkedUserId?: string
  at?: string
}

/**
 * Authorize payslip read. Failures for unauthorized callers use non-enumerating 404.
 * Employee self-read is allowed only when employeeLinkedUserId matches the actor.
 */
export function authorizePayslipRead(
  actor: FinanceActorContext,
  scope: FinanceScope,
  options: PayslipReadOptions = {},
): RequiredFinanceScope {
  const required = normalizeRequiredFinanceScope(scope)
  const at = options.at ?? new Date().toISOString()

  if (options.employeeLinkedUserId && options.employeeLinkedUserId === actor.uid) {
    if (!actor.membershipActive || actor.orgId !== required.orgId || !actor.financeModuleEnabled) {
      throw new FinanceNotFoundError('Payslip not found')
    }
    return required
  }

  try {
    authorizeFinanceAction(actor, required, PAYSLIP_READ_ACTION, at)
  } catch (error) {
    if (error instanceof FinanceAuthorizationError) {
      throw new FinanceNotFoundError('Payslip not found')
    }
    throw error
  }
  return required
}

/**
 * Employee master-data read: payroll roles only (narrower than general finance reporting).
 * Sensitive fields must still be redacted unless a future elevated capability is approved.
 */
export function authorizeEmployeeRead(
  actor: FinanceActorContext,
  scope: FinanceScope,
  at = new Date().toISOString(),
): RequiredFinanceScope {
  const required = normalizeRequiredFinanceScope(scope)
  try {
    authorizeFinanceAction(actor, required, 'payroll.employee.read', at)
  } catch (error) {
    if (error instanceof FinanceAuthorizationError) {
      throw new FinanceNotFoundError('Employee not found')
    }
    throw error
  }
  return required
}

/**
 * IRP5/IT3(a), EMP201, EMP501, and tax-year summary reads.
 * Unauthorized callers receive non-enumerating 404.
 */
export function authorizeStatutoryRead(
  actor: FinanceActorContext,
  scope: FinanceScope,
  at = new Date().toISOString(),
): RequiredFinanceScope {
  const required = normalizeRequiredFinanceScope(scope)
  try {
    authorizeFinanceAction(actor, required, 'payroll.statutory.read', at)
  } catch (error) {
    if (error instanceof FinanceAuthorizationError) {
      throw new FinanceNotFoundError('Statutory record not found')
    }
    throw error
  }
  return required
}

/**
 * Export manifests carry employee tax aggregates. Read uses the same role set as generate.
 * Unauthorized callers receive non-enumerating 404.
 */
export function authorizeExportManifestRead(
  actor: FinanceActorContext,
  scope: FinanceScope,
  at = new Date().toISOString(),
): RequiredFinanceScope {
  const required = normalizeRequiredFinanceScope(scope)
  try {
    authorizeFinanceAction(actor, required, 'payroll.export.generate', at)
  } catch (error) {
    if (error instanceof FinanceAuthorizationError) {
      throw new FinanceNotFoundError('Export manifest not found')
    }
    throw error
  }
  return required
}
