// lib/quotes/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { Currency, LineItem, InvoiceFromDetails, InvoiceClientDetails } from '@/lib/invoices/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted'

export interface Quote {
  id?: string
  orgId: string
  quoteNumber: string
  status: QuoteStatus
  issueDate: Timestamp | null
  validUntil: Timestamp | null
  lineItems: LineItem[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  currency: Currency
  notes: string
  fromDetails?: InvoiceFromDetails
  clientDetails?: InvoiceClientDetails
  /** If converted, the resulting invoice ID */
  convertedInvoiceId?: string
  /** CRM contact linked to this quote (optional) */
  contactId?: string
  sentAt: Timestamp | null
  acceptedAt: Timestamp | null
  createdBy: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  companyId?: string
  companyName?: string
  deleted?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}
