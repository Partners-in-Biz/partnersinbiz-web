/** Phase-6 expense claims for SA bookkeepers. Post to books/payable only; never initiate payment. */

export type ExpenseClaimStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'posted'
  | 'payment_instruction_exported'

export type ExpenseClaimPostTarget = 'journal_proposal' | 'payable'

export type ExpenseClaimTaxRateCode = 'za_std_15' | 'za_zero' | 'za_exempt' | 'out_of_scope'

export interface ExpenseClaimLine {
  id: string
  description: string
  /** Expense / category GL account (coding). */
  expenseAccountId: string
  /** Net of VAT, minor currency units (ZAR cents). */
  netMinor: number
  taxRateCode: ExpenseClaimTaxRateCode
  /** VAT portion minor units. */
  vatMinor: number
  /** Gross = net + vat. */
  grossMinor: number
  /** Optional project/cost dim. */
  projectId?: string
  category?: string
}

export interface ExpenseClaimReceipt {
  id: string
  claimId: string
  orgId: string
  fileName: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'image/heic'
  /** Storage object id / Drive file id — never inline bytes in Firestore. */
  storageRefId: string
  byteSize?: number
  uploadedBy: string
  uploadedAt: string
  schemaVersion: 1
}

/** OCR assist suggestion — never auto-applied; human must confirm into claim lines. */
export interface ExpenseClaimOcrAssist {
  id: string
  claimId: string
  orgId: string
  receiptId: string
  status: 'suggested' | 'confirmed' | 'dismissed'
  vendorGuess?: string
  dateGuess?: string
  totalGrossMinorGuess?: number
  currencyGuess?: string
  lineGuesses: Array<{
    description: string
    netMinor: number
    taxRateCode: ExpenseClaimTaxRateCode
    vatMinor: number
    grossMinor: number
  }>
  confidence: number
  rawTextSnippet?: string
  createdAt: string
  createdBy: string
  resolvedAt?: string
  resolvedBy?: string
  /** Hard gates */
  autoPosted: false
  autoApplied: false
  externalPaymentInitiated: false
  schemaVersion: 1
}

export interface ExpenseClaim {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  status: ExpenseClaimStatus
  /** Claimant employee / staff link (payroll employee id or user id). */
  employeeId?: string
  employeeLinkedUserId?: string
  /** Payee for reimbursement (may differ from employee). */
  payeeName: string
  payeeUserId?: string
  claimDate: string
  currency: string
  vendor?: string
  policyNotes?: string
  lines: ExpenseClaimLine[]
  netTotalMinor: number
  vatTotalMinor: number
  grossTotalMinor: number
  receiptIds: string[]
  submittedAt?: string
  submittedBy?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
  /** Set when posted to books. */
  postedAt?: string
  postedBy?: string
  postTarget?: ExpenseClaimPostTarget
  /** Journal proposal id or payable/open-item marker — internal only. */
  postRefId?: string
  /** Balanced journal lines proposed on post (not auto-posted to foundation without journal service). */
  journalProposal?: {
    purpose: 'expense_claim.post'
    balanced: true
    lines: Array<{ accountId: string; debitMinor: number; creditMinor: number; description: string }>
  }
  /** Observe-only payment instruction export (reuses packaging hard gates). */
  paymentInstructionExport?: {
    packId: string
    format: 'eft_csv' | 'payroll_net_observe'
    exportedAt: string
    exportedBy: string
    externalPaymentInitiated: false
    externalEgressAllowed: false
  }
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalPaymentInitiated: false
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  autoPosted: false
}

export interface ExpenseClaimAuditEvent {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  claimId: string
  eventType:
    | 'claim.created'
    | 'claim.updated'
    | 'claim.submitted'
    | 'claim.approved'
    | 'claim.rejected'
    | 'claim.posted'
    | 'claim.bulk_approved'
    | 'receipt.attached'
    | 'ocr.suggested'
    | 'ocr.confirmed'
    | 'ocr.dismissed'
    | 'payment_instruction.exported'
  actorId: string
  at: string
  detail: string
  schemaVersion: 1
  externalEgressAllowed: false
  externalPaymentInitiated: false
  autoPosted: false
}

export type ExpenseClaimFinanceAction =
  | 'expense_claim.create'
  | 'expense_claim.update'
  | 'expense_claim.submit'
  | 'expense_claim.approve'
  | 'expense_claim.reject'
  | 'expense_claim.bulk_approve'
  | 'expense_claim.post'
  | 'expense_claim.receipt.attach'
  | 'expense_claim.ocr.assist'
  | 'expense_claim.ocr.confirm'
  | 'expense_claim.ocr.dismiss'
  | 'expense_claim.payment_instruction.export'
  | 'expense_claim.read'
