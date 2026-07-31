import { canonicalDigest } from '@/lib/finance/integrity'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import type {
  PayRun,
  PayRunItem,
  PayRunTotals,
  PayrollCalculationTotals,
  PayrollComponentLine,
  Payslip,
} from './types'

export function emptyPayRunTotals(): PayRunTotals {
  return {
    employeeCount: 0,
    grossEarningsMinor: 0,
    taxableEarningsMinor: 0,
    preTaxDeductionsMinor: 0,
    postTaxDeductionsMinor: 0,
    payeMinor: 0,
    uifEmployeeMinor: 0,
    uifEmployerMinor: 0,
    sdlEmployerMinor: 0,
    netPayMinor: 0,
    employerCostMinor: 0,
  }
}

export function aggregatePayRunTotals(items: Array<Pick<PayRunItem, 'totals'>>): PayRunTotals {
  const totals = emptyPayRunTotals()
  totals.employeeCount = items.length
  for (const item of items) {
    totals.grossEarningsMinor += item.totals.grossEarningsMinor
    totals.taxableEarningsMinor += item.totals.taxableEarningsMinor
    totals.preTaxDeductionsMinor += item.totals.preTaxDeductionsMinor
    totals.postTaxDeductionsMinor += item.totals.postTaxDeductionsMinor
    totals.payeMinor += item.totals.payeMinor
    totals.uifEmployeeMinor += item.totals.uifEmployeeMinor
    totals.uifEmployerMinor += item.totals.uifEmployerMinor
    totals.sdlEmployerMinor += item.totals.sdlEmployerMinor
    totals.netPayMinor += item.totals.netPayMinor
    totals.employerCostMinor += item.totals.employerCostMinor
  }
  return totals
}

export function negateTotals(totals: PayrollCalculationTotals): PayrollCalculationTotals {
  const n = (value: number) => {
    const next = -value
    return Object.is(next, -0) ? 0 : next
  }
  return {
    grossEarningsMinor: n(totals.grossEarningsMinor),
    taxableEarningsMinor: n(totals.taxableEarningsMinor),
    preTaxDeductionsMinor: n(totals.preTaxDeductionsMinor),
    postTaxDeductionsMinor: n(totals.postTaxDeductionsMinor),
    payeMinor: n(totals.payeMinor),
    uifEmployeeMinor: n(totals.uifEmployeeMinor),
    uifEmployerMinor: n(totals.uifEmployerMinor),
    sdlEmployerMinor: n(totals.sdlEmployerMinor),
    netPayMinor: n(totals.netPayMinor),
    employerCostMinor: n(totals.employerCostMinor),
    benefitsMinor: n(totals.benefitsMinor),
    allowancesMinor: n(totals.allowancesMinor),
    overtimeMinor: n(totals.overtimeMinor),
    bonusMinor: n(totals.bonusMinor),
    commissionMinor: n(totals.commissionMinor),
    leavePaidMinor: n(totals.leavePaidMinor),
    leaveUnpaidReductionMinor: n(totals.leaveUnpaidReductionMinor),
  }
}

export function negateLines(lines: PayrollComponentLine[]): PayrollComponentLine[] {
  return lines.map((line, index) => {
    const amountMinor = Object.is(-line.amountMinor, -0) ? 0 : -line.amountMinor
    const unitAmountMinor =
      line.quantity === 0
        ? Object.is(-line.unitAmountMinor, -0)
          ? 0
          : -line.unitAmountMinor
        : line.unitAmountMinor
    return {
      ...line,
      lineId: `rev_${line.lineId || index}`,
      amountMinor,
      unitAmountMinor,
      description: `REVERSAL: ${line.description}`,
    }
  })
}

export function buildInputSetHash(itemDigests: string[]): string {
  return canonicalDigest({ kind: 'pay_run_input_set', digests: [...itemDigests].sort() })
}

export function buildPayRunLockHash(input: {
  payRunId: string
  payPeriodId: string
  ruleVersionId: string
  inputCutoffAt: string
  inputSetHash: string
  totals: PayRunTotals
  itemIds: string[]
  itemResultDigests: string[]
}): string {
  return canonicalDigest({
    kind: 'pay_run_lock',
    ...input,
    itemIds: [...input.itemIds].sort(),
    itemResultDigests: [...input.itemResultDigests].sort(),
  })
}

export function buildPayslipGenerationChecksum(input: {
  payRunId: string
  payRunItemId: string
  employeeId: string
  resultDigest: string
  totals: PayrollCalculationTotals
  lines: PayrollComponentLine[]
}): string {
  return canonicalDigest({ kind: 'payslip_generation', ...input })
}

export function assertPayRunMutable(run: Pick<PayRun, 'status' | 'immutable' | 'id'>, action: string): void {
  if (run.immutable || run.status === 'approved_locked' || run.status === 'reversed') {
    throw new FinanceValidationError(`Pay run ${run.id} is locked/immutable and cannot ${action}`)
  }
}

export function assertCanSubmitPayRun(run: PayRun, itemCount: number, now: string): void {
  if (run.status !== 'calculated' && run.status !== 'draft') {
    throw new FinanceValidationError('Only draft/calculated pay runs can be submitted for review')
  }
  if (itemCount < 1) throw new FinanceValidationError('Pay run requires at least one calculated item before review')
  if (!run.inputsFrozen) throw new FinanceValidationError('Pay run inputs must be frozen at cut-off before review')
  if (now < run.inputCutoffAt) {
    throw new FinanceValidationError('Cannot submit pay run for review before input cut-off')
  }
  if (!run.inputSetHash) throw new FinanceValidationError('Pay run input set hash is required before review')
}

export function assertCanApprovePayRun(run: PayRun, actorId: string): void {
  if (run.status !== 'in_review') throw new FinanceValidationError('Only in_review pay runs can be approved and locked')
  if (run.submittedBy && run.submittedBy === actorId) {
    throw new FinanceValidationError('Pay run submitter cannot approve/lock the same run')
  }
  if (run.createdBy === actorId) {
    throw new FinanceValidationError('Pay run creator cannot approve/lock the same run')
  }
}

export function payRunHistoryEntry(run: PayRun): {
  payRunId: string
  status: PayRun['status']
  kind: PayRun['kind']
  lockedAt?: string
  approvalId?: string
  originalPayRunId?: string
  reversalPayRunId?: string
  lockHash?: string
  totals: PayRunTotals
} {
  return {
    payRunId: run.id,
    status: run.status,
    kind: run.kind,
    lockedAt: run.lockedAt,
    approvalId: run.approvalId,
    originalPayRunId: run.originalPayRunId,
    reversalPayRunId: run.reversalPayRunId,
    lockHash: run.lockHash,
    totals: run.totals,
  }
}

export function isPayslipReadable(payslip: Payslip): boolean {
  return payslip.status === 'generated' && payslip.immutable === true && payslip.autoSent === false
}
