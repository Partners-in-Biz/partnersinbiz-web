export type SenderMode = 'esp_domain' | 'connected_mailbox'
export type SenderPurpose = 'marketing_bulk' | 'lifecycle' | 'sales_1to1' | 'transactional'
export type SenderVerificationStatus = 'pending' | 'verified' | 'failed'
export type SenderHealthStatus = 'healthy' | 'warning' | 'blocked'
export type SenderStrategy =
  | 'organisation_default'
  | 'fixed_identity'
  | 'campaign_creator'
  | 'contact_owner'
  | 'company_account_manager'
  | 'deal_owner'
  | 'round_robin_pool'
export type NoOwnerBehavior = 'exclude' | 'fallback' | 'block'

export interface SenderQuota {
  dailyLimit: number
  sentToday: number
  resetAt?: unknown
}

export interface EmailSenderIdentity {
  id: string
  orgId: string
  displayName: string
  emailAddress: string
  localPart: string
  replyTo?: string | null
  ownerUid: string | null
  domainId: string | null
  mailboxAccountId: string | null
  mode: SenderMode
  purposes: SenderPurpose[]
  verificationStatus: SenderVerificationStatus
  enabled: boolean
  isDefault: boolean
  delegatedActorUids: string[]
  signatureTemplateId?: string | null
  healthStatus: SenderHealthStatus
  quota: SenderQuota | null
  lastCheckedAt?: unknown
  createdBy?: string
  updatedBy?: string
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface EmailSenderPolicy {
  id: string
  orgId: string
  name: string
  strategy: SenderStrategy
  purpose: SenderPurpose
  defaultIdentityId: string | null
  fixedIdentityId: string | null
  fallbackIdentityId: string | null
  roundRobinIdentityIds: string[]
  noOwnerBehavior: NoOwnerBehavior
  allowConnectedMailbox: boolean
  connectedMailboxMaxRecipients: number
  enabled: boolean
  createdBy?: string
  updatedBy?: string
  createdAt: unknown
  updatedAt: unknown
  deleted?: boolean
}

export interface SenderRecipientContext {
  contactId: string
  contactOwnerUid?: string | null
  companyId?: string | null
  companyAccountManagerUid?: string | null
  dealId?: string | null
  dealOwnerUid?: string | null
}

export interface SenderResolutionInput {
  orgId: string
  actorUid: string
  campaignCreatorUid?: string | null
  policy: EmailSenderPolicy
  recipient: SenderRecipientContext
  batchSize: number
}

export type SenderResolutionReason =
  | 'no_contact_owner'
  | 'no_company_account_manager'
  | 'no_deal_owner'
  | 'no_campaign_creator'
  | 'owner_identity_unavailable'
  | 'identity_not_found'
  | 'identity_cross_org'
  | 'identity_disabled'
  | 'identity_unverified'
  | 'identity_unhealthy'
  | 'identity_over_quota'
  | 'identity_purpose_not_allowed'
  | 'identity_mode_not_allowed'
  | 'identity_domain_unverified'
  | 'identity_mailbox_unauthorised'
  | 'identity_owner_not_member'
  | 'identity_not_delegated'
  | 'policy_disabled'
  | 'fallback_identity_unavailable'
  | 'round_robin_pool_empty'

export interface SenderIdentitySnapshot {
  id: string
  ownerUid: string | null
  displayName: string
  emailAddress: string
  replyTo: string | null
  mode: SenderMode
  domainId: string | null
  mailboxAccountId: string | null
}

export interface SenderResolution {
  status: 'resolved' | 'excluded' | 'blocked'
  identity: SenderIdentitySnapshot | null
  policyId: string
  purpose: SenderPurpose
  resolutionSource: SenderStrategy | 'fallback'
  ownerUid: string | null
  reason: SenderResolutionReason | null
  fallbackReason: SenderResolutionReason | null
}

export interface SenderDomainRecord {
  orgId: string
  status?: string
  deleted?: boolean
  name?: string
}

export interface SenderMailboxRecord {
  orgId: string
  uid: string
  status?: string
  emailAddress?: string
  deletedAt?: unknown
}

export interface SenderMemberRecord {
  orgId?: string
  role?: string
  status?: string
  disabled?: boolean
  deletedAt?: unknown
}

export interface SenderResolutionDependencies {
  listIdentities(orgId: string): Promise<EmailSenderIdentity[]>
  getDomain(id: string): Promise<SenderDomainRecord | null>
  getMailbox(id: string): Promise<SenderMailboxRecord | null>
  getMember(uid: string, orgId?: string): Promise<SenderMemberRecord | null>
}

export interface SenderPreviewSummary {
  total: number
  resolved: number
  excluded: number
  blocked: number
  byIdentity: Record<string, number>
  byOwner: Record<string, number>
  byReason: Record<string, number>
  fallbackReasons: Record<string, number>
  results: Array<{ contactId: string; resolution: SenderResolution }>
}
