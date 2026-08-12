import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type BusinessRelationshipType =
  | 'supplier'
  | 'customer'
  | 'partner'
  | 'vendor'
  | 'affiliate'
  | 'internal'
  | 'other'

export type BusinessRelationshipStatus = 'pending' | 'active' | 'paused' | 'revoked' | 'archived'

export type SharedBusinessCapability =
  | 'crm'
  | 'projects'
  | 'documents'
  | 'orders'
  | 'shipments'
  | 'inventory'
  | 'invoices'
  | 'campaigns'
  | 'social'
  | 'email'
  | 'seo'
  | 'ads'
  | 'analytics'
  | 'research'
  | 'properties'
  | 'support'
  | 'messages'
  | 'services'

export type RelationshipVisibility = 'private' | 'relationship' | 'client_visible'
export type RelationshipApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected'

export interface FieldSharingPolicy {
  companyProfile?: boolean
  contacts?: boolean
  projects?: boolean
  documents?: boolean
  commerce?: boolean
  analytics?: boolean
  research?: boolean
  properties?: boolean
}

export interface BusinessRelationship {
  id: string
  sourceOrgId: string
  sourceCompanyId?: string
  sourceContactId?: string
  targetOrgId?: string
  targetCompanyId?: string
  targetContactId?: string
  targetName?: string
  relationshipType: BusinessRelationshipType
  status: BusinessRelationshipStatus
  sharedCapabilities: SharedBusinessCapability[]
  portalVisible?: boolean
  fieldSharingPolicy?: FieldSharingPolicy
  visibility?: RelationshipVisibility
  allowedOrgIds?: string[]
  allowedUserIds?: string[]
  approvalState?: RelationshipApprovalState
  /**
   * Shared id stamped on BOTH sides of a mutually-accepted partner link, so
   * either org can find its counterpart row without guessing by org id pair.
   * SERVER-SET-ONLY: only the partner-invite accept flow
   * (lib/partner-links) may write it, and only rows carrying it can carry
   * active/approved/portal-visible collaboration state. Generic CRM
   * relationship metadata never sets it.
   */
  partnerLinkId?: string
  notes?: string
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export type BusinessRelationshipInput = Omit<BusinessRelationship, 'id' | 'createdAt' | 'updatedAt'>

export interface BusinessRelationshipListParams {
  companyId?: string
  targetOrgId?: string
  status?: BusinessRelationshipStatus
  capability?: SharedBusinessCapability
  limit?: number
}
