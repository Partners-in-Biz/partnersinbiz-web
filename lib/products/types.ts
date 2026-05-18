// lib/products/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Currency } from '@/lib/crm/types'

export interface Product {
  id: string
  orgId: string
  name: string
  description?: string
  unitPrice: number
  currency: Currency
  unit?: string           // e.g. "hr", "item", "month"
  sku?: string
  taxRate?: number        // percentage 0–100
  active?: boolean
  deleted?: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'currency'> & {
  /** Stored and validated as a Currency code; typed as string for API-layer flexibility. */
  currency: Currency | string
}
