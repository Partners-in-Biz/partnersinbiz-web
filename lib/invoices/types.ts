import type { Timestamp } from 'firebase-admin/firestore'

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'payment_pending_verification'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'cancelled'
export type Currency = 'USD' | 'EUR' | 'ZAR'
export type PaymentMethod = 'eft' | 'paypal' | 'cash' | 'card' | 'other'

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface InvoiceAddress {
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
}

export interface InvoiceBankingDetails {
  bankName: string
  accountHolder: string
  accountNumber: string
  branchCode?: string
  swiftCode?: string
  iban?: string
}

/** Snapshot of the sender's details at invoice creation time */
export interface InvoiceFromDetails {
  companyName: string
  address?: InvoiceAddress
  email?: string
  phone?: string
  vatNumber?: string
  registrationNumber?: string
  website?: string
  logoUrl?: string
  bankingDetails?: InvoiceBankingDetails
}

/** Snapshot of the client's details at invoice creation time */
export interface InvoiceClientDetails {
  name: string
  address?: InvoiceAddress
  email?: string
  phone?: string
  vatNumber?: string
}

/**
 * Banking details as returned in payment instructions.
 *
 * Uses neutral field names (does not assume SA-specific shape) so PayPal
 * helpers / international invoices don't need to translate the schema.
 * The platform owner's `billingDetails.bankingDetails` (see
 * `InvoiceBankingDetails` above) is mapped into this shape in
 * `lib/payments/eft.ts` → `buildPaymentInstructions`.
 */
export interface BankingDetails {
  bankName?: string
  accountName?: string
  accountNumber?: string
  branchCode?: string
  swift?: string
  iban?: string
}

/**
 * Payload returned by `GET /api/v1/invoices/[id]/payment-instructions`.
 * Drives the public invoice view (EFT + optional PayPal).
 */
export interface PaymentInstructions {
  invoiceNumber: string
  total: number
  currency: string
  dueDate: string | null
  eft: {
    bankingDetails: BankingDetails
    reference: string
    proofOfPaymentEmail: string
  }
  paypal: {
    available: boolean
    url: string | null
  }
  publicViewUrl: string
}

export interface Invoice {
  id?: string
  orgId: string
  sourceOrgId?: string
  issuerOrgId?: string
  billingOrgId?: string | null
  recipientOrgId?: string
  recipientUserId?: string
  targetOrgId?: string
  targetUserId?: string
  sourceCompanyId?: string
  sourceContactId?: string
  companyId?: string
  contactId?: string
  recipientEmail?: string
  recipientName?: string
  recipientCompanyName?: string
  claimableRelationshipId?: string
  claimToken?: string
  claimStatus?: 'pending' | 'claimed' | 'revoked'
  invoiceNumber: string
  status: InvoiceStatus
  issueDate: Timestamp | null
  dueDate: Timestamp | null
  lineItems: LineItem[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  currency: Currency
  notes: string
  paidAt: Timestamp | null
  sentAt: Timestamp | null
  createdBy: string
  /** Snapshot of sender details — frozen at creation */
  fromDetails?: InvoiceFromDetails
  /** Snapshot of client details — frozen at creation */
  clientDetails?: InvoiceClientDetails

  // --- Payment / public-view fields (optional, populated on status transitions)
  /** 32-char hex token granting anonymous access to the invoice view page */
  publicToken?: string
  /** Dedicated revocable token granting anonymous access to the invoice PDF HTML route */
  pdfShareToken?: string
  /** Timestamp of first public view (set once) */
  firstViewedAt?: Timestamp | null
  /** Timestamp of most recent public view */
  lastViewedAt?: Timestamp | null
  /** Count of public views */
  viewCount?: number
  /** Chosen payment method, once a payment is recorded */
  paymentMethod?: PaymentMethod
  /** Provider-supplied reference (EFT ref / PayPal capture id / etc) */
  paymentReference?: string
  /** Amount actually paid — may differ from total on partial payments */
  paidAmount?: number
  /** ID of uploaded proof-of-payment file (in `uploads` collection) */
  paymentProofFileId?: string
  paymentProofUploadedAt?: Timestamp | null
  paymentProofNote?: string
  paymentProofConfirmedBy?: string
  paymentProofRejectedReason?: string
  paymentProofRejectedAt?: Timestamp | null
  /** PayPal order id, stored after `POST /paypal-order` */
  paypalOrderId?: string
  /** Timestamp when status flipped to `overdue` via cron */
  markedOverdueAt?: Timestamp | null

  createdAt?: unknown
  updatedAt?: unknown
}

export type InvoiceInput = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>
