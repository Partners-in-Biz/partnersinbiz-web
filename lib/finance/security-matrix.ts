import { ACTION_ROLES_FOR_COVERAGE, type FinanceAction } from './policy'
import type { FinanceApprovalAction, FinanceRole } from './types'

/**
 * Actions that must leave immutable finance_audit_events evidence on success.
 * Used by security/audit inventory tests and staging gates.
 */
export const AUDITED_MUTATION_ACTIONS: readonly FinanceAction[] = [
  'foundation.configure',
  'journal.create',
  'journal.post',
  'journal.reverse',
  'period.adjust',
  'period.close',
  'period.reopen',
  'book-policy.approve',
  'tax.configure',
  'tax-rule.approve',
  'tax.return.prepare',
  'tax.return.approve',
  'invoice.create',
  'invoice.issue',
  'invoice.void',
  'supplier_bill.create',
  'supplier_bill.issue',
  'payment.observe',
  'payment.verify',
  'payment.allocate',
  'bank.configure',
  'bank.import',
  'reconciliation.create',
  'reconciliation.match',
  'reconciliation.submit',
  'reconciliation.approve',
  'intercompany.pair.configure',
  'intercompany.propose',
  'intercompany.post_source',
  'intercompany.receive_approve',
  'intercompany.post_receiving',
  'consolidation.configure',
  'consolidation.run',
  'consolidation.approve',
  'payroll.rule.configure',
  'payroll.rule.approve',
  'payroll.employee.write',
  'payroll.component.configure',
  'payroll.calendar.configure',
  'payroll.calculate',
  'payroll.run.create',
  'payroll.run.submit',
  'payroll.run.approve',
  'payroll.run.reverse',
  'payroll.run.correct',
  'payroll.payment.observe',
  'payroll.tax_year.configure',
  'payroll.tax_year.lock',
  'payroll.ytd_opening.write',
  'payroll.ytd_opening.approve',
  'payroll.statutory.prepare',
  'payroll.statutory.approve',
  'payroll.export.generate',
  'payroll.export.approve',
] as const

/** Actions that require separate FinanceApprovalEvidence / SOD at commit time. */
export const APPROVAL_GATED_ACTIONS: readonly FinanceApprovalAction[] = [
  'book-policy.approve',
  'journal.post',
  'journal.reverse',
  'period.reopen',
  'period.close',
  'period.adjust',
  'tax-rule.approve',
  'tax.return.prepare',
  'tax.return.approve',
  'reconciliation.approve',
  'intercompany.receive',
  'elimination.rule.approve',
  'consolidation.run.approve',
  'payroll.rule.approve',
  'payroll.run.approve',
  'payroll.run.reverse',
  'payroll.adjustment.approve',
  'payroll.tax_year.lock',
  'payroll.ytd_opening.approve',
  'payroll.statutory.approve',
  'payroll.export.approve',
] as const

export function financeActionCoverage(): Record<string, readonly FinanceRole[]> {
  return { ...ACTION_ROLES_FOR_COVERAGE }
}

export function assertApprovalActionMapped(action: FinanceApprovalAction): void {
  const coverage = ACTION_ROLES_FOR_COVERAGE as Record<string, readonly FinanceRole[] | undefined>
  // Approval actions are either direct FinanceAction names or mapped closely (receive / run.approve).
  const direct = coverage[action]
  if (direct && direct.length > 0) return

  const aliases: Partial<Record<FinanceApprovalAction, FinanceAction>> = {
    'intercompany.receive': 'intercompany.receive_approve',
    'consolidation.run.approve': 'consolidation.approve',
    'elimination.rule.approve': 'consolidation.approve',
    'payroll.adjustment.approve': 'payroll.run.approve',
  }
  const alias = aliases[action]
  if (alias && coverage[alias]?.length) return
  throw new Error(`Approval action ${action} is not mapped to a finance policy role set`)
}
