import type { AccountingBasis, FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

export type TaxCategory =
  | 'output_vat'
  | 'input_vat'
  | 'zero_rated'
  | 'exempt'
  | 'out_of_scope'
  | 'withholding'

export type TaxRecoverability = 'full' | 'partial' | 'none' | 'not_applicable'

export interface TaxCode extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  jurisdictionCode: string
  category: TaxCategory
  recoverability: TaxRecoverability
  outputAccountId?: string
  inputAccountId?: string
  active: boolean
}

export interface TaxRuleVersion extends VersionedFinanceRecord {
  bookId: string
  taxCodeId: string
  jurisdictionCode: string
  versionNumber: number
  /** Integer basis points: 1500 = 15.00% */
  rateBasisPoints: number
  /** Exact rational components for traceability. */
  rateNumerator: number
  rateDenominator: number
  roundingMode: 'half_up' | 'half_even' | 'floor' | 'ceil'
  taxPointPolicyId: string
  effectiveFrom: string
  effectiveTo?: string
  status: 'draft' | 'approved'
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  sourceCitation: string
  sourceChecksum: string
  immutable: boolean
  contentHash: string
}

export interface TaxCalculationTrace {
  taxCodeId: string
  taxRuleVersionId: string
  jurisdictionCode: string
  category: TaxCategory
  rateBasisPoints: number
  rateNumerator: number
  rateDenominator: number
  roundingMode: TaxRuleVersion['roundingMode']
  taxPointPolicyId: string
  taxIncluded: boolean
  documentDate: string
  sourceCitation: string
  sourceChecksum: string
}

export interface TaxAmountResult {
  taxableMinor: number
  taxMinor: number
  grossMinor: number
  trace: TaxCalculationTrace
}

export type TaxPeriodStatus = 'open' | 'prepared' | 'approved_locked' | 'adjusted'

export interface TaxPeriod extends VersionedFinanceRecord {
  bookId: string
  jurisdictionCode: string
  label: string
  startsAt: string
  endsAt: string
  status: TaxPeriodStatus
  sourceCutoffAt?: string
  prepareApprovalId?: string
  lockApprovalId?: string
}

export interface TaxReturnLine {
  id: string
  taxReturnId: string
  taxCodeId: string
  taxRuleVersionId: string
  category: TaxCategory
  label: string
  taxableMinor: number
  taxMinor: number
  sourceJournalEntryIds: string[]
}

export interface TaxReturnSnapshot extends VersionedFinanceRecord {
  bookId: string
  taxPeriodId: string
  jurisdictionCode: string
  status: 'prepared' | 'approved_locked'
  sourceCutoffAt: string
  accountingBasis: AccountingBasis
  taxableOutputMinor: number
  outputTaxMinor: number
  taxableInputMinor: number
  inputTaxMinor: number
  netTaxMinor: number
  lines: TaxReturnLine[]
  sourceJournalEntryIds: string[]
  ruleVersionIds: string[]
  preparerActorId: string
  preparedAt: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  immutable: boolean
  contentHash: string
  inputDigest: string
}

export type TaxScope = Required<FinanceScope>
