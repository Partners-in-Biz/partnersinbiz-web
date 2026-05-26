export type ClaimableResourceType = 'invoice' | 'project'
export type ClaimableRelationshipStatus = 'pending' | 'claimed' | 'revoked'

export interface ClaimableRelationship {
  id?: string
  sourceOrgId: string
  sourceCompanyId?: string
  sourceContactId?: string
  targetOrgId?: string
  targetUserId?: string
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  resourceType: ClaimableResourceType
  resourceId: string
  claimToken: string
  status: ClaimableRelationshipStatus
  claimedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export interface EnsureClaimableRelationshipInput {
  sourceOrgId: string
  sourceCompanyId?: string
  sourceContactId?: string
  recipientOrgId?: string
  recipientUserId?: string
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  resourceType: ClaimableResourceType
  resourceId: string
}

export interface EnsureClaimableRelationshipResult {
  id: string
  claimToken: string
  targetOrgId?: string
  targetUserId?: string
  status: ClaimableRelationshipStatus
}

export interface ApplyClaimLinksInput {
  relationshipId: string
  sourceOrgId: string
  sourceCompanyId?: string
  sourceContactId?: string
  targetOrgId: string
  targetUserId: string
  resourceType: ClaimableResourceType
  resourceId: string
}
