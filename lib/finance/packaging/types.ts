/** Phase-3 download packaging: SARS-ready, payment instructions, accountant packs. No submit / no pay initiate. */

export type PackagingFamily = 'sars' | 'payment' | 'accountant'

export type PackagingKind =
  | 'sars.emp201'
  | 'sars.emp501'
  | 'sars.irp5_it3a'
  | 'sars.vat_return'
  | 'payment.eft_instructions'
  | 'payment.payroll_net'
  | 'accountant.trial_balance'
  | 'accountant.general_ledger'
  | 'accountant.open_items'
  | 'accountant.audit_extract'
  | 'accountant.cutover_evidence'

export type PackagingPackStatus = 'ready' | 'downloaded' | 'archived'

export interface PackagingFileArtifact {
  name: string
  contentType: string
  encoding: 'utf8'
  content: string
  sha256: string
  byteLength: number
}

export interface PackagingManifest {
  schemaVersion: 1
  packId: string
  kind: PackagingKind
  family: PackagingFamily
  generatedAt: string
  fileCount: number
  contentDigest: string
  /** Hard gates — always false for this module. */
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FinanceExportPack {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  kind: PackagingKind
  family: PackagingFamily
  status: PackagingPackStatus
  title: string
  currency: string
  periodFrom?: string
  periodTo?: string
  description: string
  sourceRefs: string[]
  files: PackagingFileArtifact[]
  manifest: PackagingManifest
  rowCount: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  downloadedAt?: string
  downloadedBy?: string
  schemaVersion: 1
  version: number
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export type PackagingFinanceAction =
  | 'packaging.pack.create'
  | 'packaging.pack.mark_downloaded'
  | 'packaging.pack.archive'
  | 'packaging.read'
