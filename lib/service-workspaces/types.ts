import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Currency } from '@/lib/crm/types'

export type ServiceWorkspaceType =
  | 'seo'
  | 'geo_seo'
  | 'properties'
  | 'social'
  | 'ads'
  | 'email'
  | 'documents'
  | 'support'
  | 'custom'

export type ServiceWorkspaceStatus = 'planned' | 'active' | 'paused' | 'completed' | 'archived'
export type ServiceWorkspaceVisibility = 'internal' | 'relationship' | 'client_visible'
export type ServiceWorkspaceApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected'

export interface ServiceWorkspace {
  id: string
  orgId: string
  companyId: string
  contactId?: string
  relationshipId?: string
  projectId?: string
  dealId?: string
  orderId?: string
  name: string
  serviceType: ServiceWorkspaceType
  status: ServiceWorkspaceStatus
  visibility: ServiceWorkspaceVisibility
  approvalState: ServiceWorkspaceApprovalState
  linkedDocumentIds?: string[]
  linkedProjectIds?: string[]
  linkedReportIds?: string[]
  metrics?: Record<string, number>
  budget?: number
  currency?: Currency
  startsAt?: unknown
  endsAt?: unknown
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export type ServiceWorkspaceInput = Omit<ServiceWorkspace, 'id' | 'createdAt' | 'updatedAt'>

export interface ServiceWorkspaceListParams {
  companyId?: string
  relationshipId?: string
  projectId?: string
  serviceType?: ServiceWorkspaceType
  status?: ServiceWorkspaceStatus
  limit?: number
}
