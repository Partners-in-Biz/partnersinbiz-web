import { canonicalDigest } from '@/lib/finance/integrity'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import type {
  CertificateKind,
  Emp501Difference,
  Emp201Snapshot,
  Irp5Record,
  PayrollExportManifest,
  PayrollRuleVersion,
  PayrollTaxYear,
  PayPeriod,
  PayRun,
  PayRunItem,
  StatutoryMoneyTotals,
  StatutoryExportKind,
  TaxTableReference,
} from './types'

export function emptyStatutoryTotals(): StatutoryMoneyTotals {
  return {
    grossEarningsMinor: 0,
    taxableEarningsMinor: 0,
    payeMinor: 0,
    uifEmployeeMinor: 0,
    uifEmployerMinor: 0,
    sdlEmployerMinor: 0,
    netPayMinor: 0,
    periodsIncluded: 0,
  }
}

export function addStatutoryTotals(a: StatutoryMoneyTotals, b: StatutoryMoneyTotals): StatutoryMoneyTotals {
  return {
    grossEarningsMinor: a.grossEarningsMinor + b.grossEarningsMinor,
    taxableEarningsMinor: a.taxableEarningsMinor + b.taxableEarningsMinor,
    payeMinor: a.payeMinor + b.payeMinor,
    uifEmployeeMinor: a.uifEmployeeMinor + b.uifEmployeeMinor,
    uifEmployerMinor: a.uifEmployerMinor + b.uifEmployerMinor,
    sdlEmployerMinor: a.sdlEmployerMinor + b.sdlEmployerMinor,
    netPayMinor: a.netPayMinor + b.netPayMinor,
    periodsIncluded: a.periodsIncluded + b.periodsIncluded,
  }
}

export function totalsFromPayRunItem(item: Pick<PayRunItem, 'totals'>): StatutoryMoneyTotals {
  return {
    grossEarningsMinor: item.totals.grossEarningsMinor,
    taxableEarningsMinor: item.totals.taxableEarningsMinor,
    payeMinor: item.totals.payeMinor,
    uifEmployeeMinor: item.totals.uifEmployeeMinor,
    uifEmployerMinor: item.totals.uifEmployerMinor,
    sdlEmployerMinor: item.totals.sdlEmployerMinor,
    netPayMinor: item.totals.netPayMinor,
    periodsIncluded: 1,
  }
}

/**
 * IRP5 when PAYE was withheld; IT3(a) when PAYE is zero (or at/below optional threshold).
 * Threshold defaults to 0 minor units.
 */
export function chooseCertificateKind(payeMinor: number, payeThresholdMinor = 0): CertificateKind {
  if (!Number.isInteger(payeMinor)) throw new FinanceValidationError('payeMinor must be an integer minor unit')
  if (!Number.isInteger(payeThresholdMinor) || payeThresholdMinor < 0) {
    throw new FinanceValidationError('payeThresholdMinor must be a non-negative integer')
  }
  return Math.abs(payeMinor) > payeThresholdMinor ? 'IRP5' : 'IT3(a)'
}

export function taxMonthFromDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoDate)) {
    throw new FinanceValidationError('tax month source date must be YYYY-MM-DD')
  }
  return isoDate.slice(0, 7)
}

export function isDateWithinTaxYear(date: string, taxYear: Pick<PayrollTaxYear, 'startDate' | 'endDate'>): boolean {
  const day = date.slice(0, 10)
  return day >= taxYear.startDate && day <= taxYear.endDate
}

export function isPayRunEligibleForStatutory(run: Pick<PayRun, 'status' | 'kind'>): boolean {
  return run.status === 'approved_locked' || run.status === 'reversed'
}

export function buildTaxTableReference(rule: Pick<
  PayrollRuleVersion,
  'id' | 'packageId' | 'taxYearLabel' | 'sourceChecksum' | 'sourceCitation' | 'jurisdictionCode'
>): TaxTableReference {
  return {
    ruleVersionId: rule.id,
    packageId: rule.packageId,
    taxYearLabel: rule.taxYearLabel,
    sourceChecksum: rule.sourceChecksum,
    sourceCitation: rule.sourceCitation,
    jurisdictionCode: rule.jurisdictionCode,
  }
}

export function uniqueTaxTableReferences(refs: TaxTableReference[]): TaxTableReference[] {
  const map = new Map<string, TaxTableReference>()
  for (const ref of refs) {
    map.set(`${ref.ruleVersionId}:${ref.packageId}:${ref.sourceChecksum}`, ref)
  }
  return Array.from(map.values()).sort((a, b) => a.ruleVersionId.localeCompare(b.ruleVersionId))
}

export function aggregateItems(items: Array<Pick<PayRunItem, 'totals'>>): StatutoryMoneyTotals {
  return items.reduce((acc, item) => addStatutoryTotals(acc, totalsFromPayRunItem(item)), emptyStatutoryTotals())
}

export function applyYtdOpening(
  base: StatutoryMoneyTotals,
  opening?: {
    grossEarningsMinor: number
    taxableEarningsMinor: number
    payeMinor: number
    uifEmployeeMinor: number
    uifEmployerMinor: number
    sdlEmployerMinor: number
  } | null,
): StatutoryMoneyTotals {
  if (!opening) return base
  return {
    grossEarningsMinor: base.grossEarningsMinor + opening.grossEarningsMinor,
    taxableEarningsMinor: base.taxableEarningsMinor + opening.taxableEarningsMinor,
    payeMinor: base.payeMinor + opening.payeMinor,
    uifEmployeeMinor: base.uifEmployeeMinor + opening.uifEmployeeMinor,
    uifEmployerMinor: base.uifEmployerMinor + opening.uifEmployerMinor,
    sdlEmployerMinor: base.sdlEmployerMinor + opening.sdlEmployerMinor,
    netPayMinor: base.netPayMinor,
    periodsIncluded: base.periodsIncluded,
  }
}

export function differenceTotals(monthly: StatutoryMoneyTotals, certificates: StatutoryMoneyTotals): Emp501Difference {
  return {
    grossEarningsMinor: monthly.grossEarningsMinor - certificates.grossEarningsMinor,
    taxableEarningsMinor: monthly.taxableEarningsMinor - certificates.taxableEarningsMinor,
    payeMinor: monthly.payeMinor - certificates.payeMinor,
    uifEmployeeMinor: monthly.uifEmployeeMinor - certificates.uifEmployeeMinor,
    uifEmployerMinor: monthly.uifEmployerMinor - certificates.uifEmployerMinor,
    sdlEmployerMinor: monthly.sdlEmployerMinor - certificates.sdlEmployerMinor,
    netPayMinor: monthly.netPayMinor - certificates.netPayMinor,
  }
}

export function isFullyReconciled(difference: Emp501Difference): boolean {
  return Object.values(difference).every((value) => value === 0)
}

export function assertTaxYearMutable(taxYear: Pick<PayrollTaxYear, 'status' | 'immutable' | 'id'>, action: string): void {
  if (taxYear.immutable || taxYear.status === 'locked') {
    throw new FinanceValidationError(`Tax year ${taxYear.id} is locked and cannot ${action}`)
  }
}

export function assertTaxYearAcceptsStatutoryPrepare(taxYear: Pick<PayrollTaxYear, 'status' | 'id'>): void {
  if (taxYear.status === 'locked') {
    throw new FinanceValidationError(`Tax year ${taxYear.id} is locked; reopen is out of scope for this slice`)
  }
}

export function assertStatutoryReadyForApprove(status: string, label: string): void {
  if (status !== 'ready' && status !== 'draft') {
    throw new FinanceValidationError(`${label} must be draft/ready before approve/lock`)
  }
}

export function assertCanApproveStatutory(record: { status: string; createdBy: string }, actorId: string, label: string): void {
  if (record.status !== 'ready' && record.status !== 'draft') {
    throw new FinanceValidationError(`${label} must be draft/ready before approve/lock`)
  }
  if (record.createdBy === actorId) {
    throw new FinanceValidationError(`${label} creator cannot approve/lock the same record`)
  }
}

export function periodMatchesTaxMonth(period: Pick<PayPeriod, 'payDate' | 'periodEnd'>, taxMonth: string): boolean {
  const month = taxMonthFromDate(period.payDate || period.periodEnd)
  return month === taxMonth
}

export function buildStatutoryContentHash(kind: string, payload: Record<string, unknown>): string {
  return canonicalDigest({ kind, ...payload })
}

export function buildExportContentDigest(input: {
  kind: StatutoryExportKind
  taxYearId: string
  recordIds: string[]
  recordDigests: string[]
}): string {
  return canonicalDigest({
    kind: 'payroll_export_manifest',
    exportKind: input.kind,
    taxYearId: input.taxYearId,
    recordIds: [...input.recordIds].sort(),
    recordDigests: [...input.recordDigests].sort(),
  })
}

export function buildPayrollTaxSummaryEvidence(input: {
  taxYear: Pick<PayrollTaxYear, 'id' | 'taxYearLabel' | 'status' | 'startDate' | 'endDate'>
  certificates: Array<Pick<Irp5Record, 'id' | 'certificateKind' | 'totals' | 'contentHash'>>
  emp201s: Array<Pick<Emp201Snapshot, 'id' | 'taxMonth' | 'totals' | 'contentHash'>>
  emp501?: Pick<import('./types').Emp501Reconciliation, 'id' | 'reconciled' | 'difference' | 'contentHash'> | null
  taxTableReferences: TaxTableReference[]
}): Record<string, unknown> {
  const certificateTotals = input.certificates.reduce(
    (acc, row) => addStatutoryTotals(acc, row.totals),
    emptyStatutoryTotals(),
  )
  return {
    kind: 'payroll_tax_summary_v1',
    taxYearId: input.taxYear.id,
    taxYearLabel: input.taxYear.taxYearLabel,
    taxYearStatus: input.taxYear.status,
    window: { startDate: input.taxYear.startDate, endDate: input.taxYear.endDate },
    employeeCertificates: input.certificates.length,
    irp5Count: input.certificates.filter((c) => c.certificateKind === 'IRP5').length,
    it3aCount: input.certificates.filter((c) => c.certificateKind === 'IT3(a)').length,
    emp201Count: input.emp201s.length,
    emp501: input.emp501
      ? { id: input.emp501.id, reconciled: input.emp501.reconciled, difference: input.emp501.difference }
      : null,
    totals: certificateTotals,
    taxTableReferences: input.taxTableReferences,
    certificateDigests: input.certificates.map((c) => c.contentHash).sort(),
    emp201Digests: input.emp201s.map((e) => e.contentHash).sort(),
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
}

export function exportManifestIsInternalOnly(manifest: Pick<PayrollExportManifest, 'sarsSubmissionInitiated' | 'externalEgressAllowed' | 'externalPaymentInitiated'>): boolean {
  return (
    manifest.sarsSubmissionInitiated === false &&
    manifest.externalEgressAllowed === false &&
    manifest.externalPaymentInitiated === false
  )
}
