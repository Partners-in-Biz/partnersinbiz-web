import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Currency, DealLineItem } from '@/lib/crm/types'

export type OrderStatus = 'draft' | 'confirmed' | 'in_progress' | 'fulfilled' | 'cancelled' | 'archived'
export type FulfillmentStatus = 'not_started' | 'picking' | 'packed' | 'in_transit' | 'delivered' | 'blocked'
export type ShipmentStatus = 'pending' | 'ready' | 'in_transit' | 'delivered' | 'failed' | 'cancelled'
export type InventoryStatus = 'active' | 'low_stock' | 'out_of_stock' | 'archived'

export interface CommerceAuditFields {
  visibility?: 'internal' | 'relationship' | 'client_visible'
  allowedOrgIds?: string[]
  allowedUserIds?: string[]
  approvalState?: 'draft' | 'pending_approval' | 'approved' | 'rejected'
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export interface Order extends CommerceAuditFields {
  id: string
  orgId: string
  companyId: string
  contactId?: string
  relationshipId?: string
  serviceWorkspaceId?: string
  dealId?: string
  quoteId?: string
  invoiceId?: string
  projectId?: string
  title: string
  status: OrderStatus
  fulfillmentStatus: FulfillmentStatus
  lineItems: DealLineItem[]
  subtotal: number
  taxAmount: number
  total: number
  currency: Currency
  expectedDeliveryDate?: unknown
  deliveredAt?: unknown
  notes?: string
}

export interface Shipment extends CommerceAuditFields {
  id: string
  orgId: string
  companyId: string
  orderId?: string
  serviceWorkspaceId?: string
  projectId?: string
  status: ShipmentStatus
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  origin?: string
  destination?: string
  expectedDeliveryDate?: unknown
  deliveredAt?: unknown
  notes?: string
}

export interface InventoryItem extends CommerceAuditFields {
  id: string
  orgId: string
  companyId?: string
  productId?: string
  serviceWorkspaceId?: string
  name: string
  sku?: string
  status: InventoryStatus
  quantityAvailable: number
  quantityReserved: number
  lowStockThreshold?: number
  unit?: string
  location?: string
  notes?: string
}

export interface CommerceListParams {
  companyId?: string
  orderId?: string
  serviceWorkspaceId?: string
  projectId?: string
  status?: string
  limit?: number
}
