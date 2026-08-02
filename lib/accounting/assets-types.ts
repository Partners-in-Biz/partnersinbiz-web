import type { FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'

export type AssetDepreciationMethod = 'straight_line'

export type FixedAssetStatus = 'draft' | 'active' | 'fully_depreciated' | 'disposed'

export type DepreciationRunStatus = 'draft' | 'calculated' | 'approved_posted'

export type AssetDisposalStatus = 'draft' | 'posted'

export type AssetScope = Required<FinanceScope>

export interface AssetClass extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  depreciationMethod: AssetDepreciationMethod
  /** Whole months of economic life used for straight-line schedule. */
  usefulLifeMonths: number
  /** Default residual as minor units when residualPolicy is absolute; 0 for none. */
  defaultResidualMinor: number
  assetAccountId: string
  accumulatedDepAccountId: string
  expenseAccountId: string
  active: boolean
}

export interface FixedAsset extends VersionedFinanceRecord {
  bookId: string
  assetNumber: string
  name: string
  description?: string
  assetClassId: string
  currency: string
  costMinor: number
  residualValueMinor: number
  usefulLifeMonths: number
  depreciationMethod: AssetDepreciationMethod
  acquisitionDate: string
  inServiceDate: string
  status: FixedAssetStatus
  accumulatedDepreciationMinor: number
  netBookValueMinor: number
  /** Last posted depreciation period key YYYY-MM. */
  lastDepreciationPeriodKey?: string
  disposalId?: string
  disposedAt?: string
  assetAccountId: string
  accumulatedDepAccountId: string
  expenseAccountId: string
  /** Hard gates — always false in this module. */
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface DepreciationScheduleLine {
  periodIndex: number
  periodKey?: string
  amountMinor: number
  cumulativeMinor: number
  closingNbvMinor: number
}

export interface DepreciationRunItem {
  id: string
  depreciationRunId: string
  assetId: string
  assetNumber: string
  assetName: string
  periodIndex: number
  amountMinor: number
  openingAccumulatedMinor: number
  closingAccumulatedMinor: number
  openingNbvMinor: number
  closingNbvMinor: number
  expenseAccountId: string
  accumulatedDepAccountId: string
}

export interface DepreciationRun extends VersionedFinanceRecord {
  bookId: string
  /** Canonical month key YYYY-MM for the run. */
  periodKey: string
  periodId?: string
  postingDate: string
  status: DepreciationRunStatus
  description: string
  itemCount: number
  totalDepreciationMinor: number
  items: DepreciationRunItem[]
  journalEntryId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  calculatedAt?: string
  calculatedBy?: string
  postedAt?: string
  postedBy?: string
  inputDigest: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface AssetDisposal extends VersionedFinanceRecord {
  bookId: string
  assetId: string
  assetNumber: string
  disposedAt: string
  proceedsMinor: number
  costMinor: number
  accumulatedDepreciationMinor: number
  nbvAtDisposalMinor: number
  /** proceeds - NBV; negative is a loss. */
  gainLossMinor: number
  status: AssetDisposalStatus
  proceedsAccountId: string
  gainLossAccountId: string
  description?: string
  journalEntryId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  postedAt?: string
  postedBy?: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FixedAssetRegisterLine {
  assetId: string
  assetNumber: string
  name: string
  assetClassId: string
  status: FixedAssetStatus
  costMinor: number
  residualValueMinor: number
  accumulatedDepreciationMinor: number
  netBookValueMinor: number
  inServiceDate: string
  usefulLifeMonths: number
  lastDepreciationPeriodKey?: string
  disposedAt?: string
}

export interface FixedAssetRegisterReport {
  orgId: string
  legalEntityId: string
  bookId: string
  asOfDate: string
  currency: string
  generatedAt: string
  assetCount: number
  totalCostMinor: number
  totalAccumulatedMinor: number
  totalNbvMinor: number
  lines: FixedAssetRegisterLine[]
}

export interface DepreciationRunReport {
  orgId: string
  legalEntityId: string
  bookId: string
  periodKey: string
  runId: string
  status: DepreciationRunStatus
  totalDepreciationMinor: number
  itemCount: number
  journalEntryId?: string
  items: Array<{
    assetId: string
    assetNumber: string
    assetName: string
    amountMinor: number
    closingNbvMinor: number
  }>
}
