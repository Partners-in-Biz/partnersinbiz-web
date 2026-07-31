import type { FinanceActorContext, FinanceRole, FinanceScope } from './types'

export type FinanceAction =
  | 'foundation.configure'
  | 'foundation.read'
  | 'journal.create'
  | 'journal.post'
  | 'journal.reverse'
  | 'period.adjust'
  | 'period.close'
  | 'period.reopen'
  | 'book-policy.approve'
  | 'tax.configure'
  | 'tax.read'
  | 'tax-rule.approve'
  | 'tax.return.prepare'
  | 'tax.return.approve'
  | 'report.read'
  | 'invoice.create'
  | 'invoice.issue'
  | 'invoice.void'
  | 'invoice.read'
  | 'supplier_bill.create'
  | 'supplier_bill.issue'
  | 'supplier_bill.read'
  | 'payment.observe'
  | 'payment.verify'
  | 'payment.allocate'
  | 'payment.read'
  | 'bank.configure'
  | 'bank.import'
  | 'bank.read'
  | 'reconciliation.create'
  | 'reconciliation.match'
  | 'reconciliation.submit'
  | 'reconciliation.approve'
  | 'reconciliation.read'
  | 'intercompany.pair.configure'
  | 'intercompany.propose'
  | 'intercompany.post_source'
  | 'intercompany.receive'
  | 'intercompany.receive_approve'
  | 'intercompany.post_receiving'
  | 'intercompany.read'
  | 'consolidation.configure'
  | 'consolidation.run'
  | 'consolidation.approve'
  | 'consolidation.run.approve'
  | 'elimination.rule.approve'
  | 'payroll.rule.approve'
  | 'payroll.rule.configure'
  | 'payroll.employee.write'
  | 'payroll.component.configure'
  | 'payroll.calendar.configure'
  | 'payroll.calculate'
  | 'payroll.run.create'
  | 'payroll.run.submit'
  | 'payroll.run.approve'
  | 'payroll.run.reverse'
  | 'payroll.run.correct'
  | 'payroll.payslip.read'
  | 'payroll.payment.observe'
  | 'consolidation.read'

const ACTION_ROLES: Record<FinanceAction, readonly FinanceRole[]> = {
  'foundation.configure': ['finance_admin'],
  'foundation.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'journal.create': ['bookkeeper', 'accountant', 'finance_admin'],
  'journal.post': ['accountant', 'finance_approver', 'finance_admin'],
  'journal.reverse': ['accountant', 'finance_approver', 'finance_admin'],
  'period.adjust': ['accountant', 'finance_approver', 'finance_admin'],
  'period.close': ['finance_approver', 'finance_admin'],
  'period.reopen': ['finance_approver', 'finance_admin'],
  'book-policy.approve': ['finance_approver', 'finance_admin'],
  'tax.configure': ['finance_admin', 'accountant'],
  'tax.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'tax-rule.approve': ['finance_approver', 'finance_admin'],
  'tax.return.prepare': ['accountant', 'finance_approver', 'finance_admin'],
  'tax.return.approve': ['finance_approver', 'finance_admin'],
  'report.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'invoice.create': ['bookkeeper', 'accountant', 'finance_admin'],
  'invoice.issue': ['bookkeeper', 'accountant', 'finance_admin'],
  'invoice.void': ['accountant', 'finance_approver', 'finance_admin'],
  'invoice.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'supplier_bill.create': ['bookkeeper', 'accountant', 'finance_admin'],
  'supplier_bill.issue': ['bookkeeper', 'accountant', 'finance_admin'],
  'supplier_bill.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'payment.observe': ['bookkeeper', 'accountant', 'finance_admin'],
  'payment.verify': ['accountant', 'finance_approver', 'finance_admin'],
  'payment.allocate': ['bookkeeper', 'accountant', 'finance_admin'],
  'payment.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'bank.configure': ['finance_admin', 'accountant'],
  'bank.import': ['bookkeeper', 'accountant', 'finance_admin'],
  'bank.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'reconciliation.create': ['bookkeeper', 'accountant', 'finance_admin'],
  'reconciliation.match': ['bookkeeper', 'accountant', 'finance_admin'],
  'reconciliation.submit': ['bookkeeper', 'accountant', 'finance_admin'],
  'reconciliation.approve': ['finance_approver', 'finance_admin'],
  'reconciliation.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'intercompany.pair.configure': ['finance_admin'],
  'intercompany.propose': ['accountant', 'finance_admin'],
  'intercompany.post_source': ['accountant', 'finance_admin'],
  'intercompany.receive': ['finance_approver', 'finance_admin'],
  'intercompany.receive_approve': ['finance_approver', 'finance_admin'],
  'intercompany.post_receiving': ['accountant', 'finance_admin'],
  'intercompany.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'consolidation.configure': ['finance_admin', 'accountant'],
  'consolidation.run': ['finance_admin', 'accountant'],
  'consolidation.approve': ['finance_approver', 'finance_admin'],
  'consolidation.run.approve': ['finance_approver', 'finance_admin'],
  'elimination.rule.approve': ['finance_approver', 'finance_admin'],
  'payroll.rule.approve': ['finance_approver', 'finance_admin', 'payroll_approver'],
  'payroll.rule.configure': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.employee.write': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.component.configure': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.calendar.configure': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.calculate': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.run.create': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.run.submit': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.run.approve': ['finance_admin', 'payroll_approver'],
  'payroll.run.reverse': ['finance_admin', 'payroll_approver'],
  'payroll.run.correct': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'payroll.payslip.read': ['finance_admin', 'payroll_clerk', 'payroll_approver'],
  'payroll.payment.observe': ['finance_admin', 'accountant', 'payroll_clerk', 'payroll_approver'],
  'consolidation.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
}

const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/

export class FinanceAuthorizationError extends Error {
  readonly statusCode = 403

  constructor(message: string) {
    super(message)
    this.name = 'FinanceAuthorizationError'
  }
}

export function parseIsoTimestamp(value: string, field: string): number {
  const match = ISO_TIMESTAMP.exec(value)
  if (!match) throw new FinanceAuthorizationError(`${field} must be a strict ISO timestamp with timezone`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '0', zone,
    , offsetHourText = '0', offsetMinuteText = '0'] = match
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number)
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, Number(fraction.padEnd(3, '0')))
  const local = new Date(localEpoch)
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
      local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second ||
      offsetHour > 23 || offsetMinute > 59) {
    throw new FinanceAuthorizationError(`${field} must be a strict ISO timestamp with timezone`)
  }
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch) || (zone === 'Z' && epoch !== localEpoch)) {
    throw new FinanceAuthorizationError(`${field} must be a strict ISO timestamp with timezone`)
  }
  return epoch
}

function isAssignmentEffective(assignment: FinanceActorContext['assignments'][number], atEpoch: number): boolean {
  if (assignment.status !== 'active') return false
  if (assignment.effectiveFrom && parseIsoTimestamp(assignment.effectiveFrom, 'assignment.effectiveFrom') > atEpoch) return false
  if (assignment.effectiveTo && parseIsoTimestamp(assignment.effectiveTo, 'assignment.effectiveTo') < atEpoch) return false
  return true
}

export function effectiveFinanceAssignments(
  actor: FinanceActorContext,
  scope: FinanceScope,
  at: string,
): FinanceActorContext['assignments'] {
  const atEpoch = parseIsoTimestamp(at, 'authorization timestamp')
  return actor.assignments.filter((assignment) => {
    if (!isAssignmentEffective(assignment, atEpoch)) return false
    if (assignment.orgId !== scope.orgId || assignment.userId !== actor.uid) return false
    if (assignment.legalEntityId !== scope.legalEntityId) return false
    if (assignment.scopeMode === 'entity') return true
    return Boolean(scope.bookId) && assignment.bookId === scope.bookId
  })
}

export function authorizeFinanceAction(
  actor: FinanceActorContext,
  scope: FinanceScope,
  action: FinanceAction,
  at = new Date().toISOString(),
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== scope.orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  if (action === 'foundation.configure' && actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
    throw new FinanceAuthorizationError('Foundation configuration requires owner or admin membership')
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== scope.orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    if (!actor.delegationScopes?.includes(`finance:${action}`) && !actor.delegationScopes?.includes('finance:*')) {
      throw new FinanceAuthorizationError(`Delegation does not grant finance:${action}`)
    }
  }

  const coveringAssignments = effectiveFinanceAssignments(actor, scope, at)
  if (coveringAssignments.length === 0) {
    throw new FinanceAuthorizationError('No active finance assignment covers this scope')
  }
  if (!coveringAssignments.some((assignment) => ACTION_ROLES[action].includes(assignment.role))) {
    throw new FinanceAuthorizationError(`Finance role cannot perform ${action}`)
  }
}
