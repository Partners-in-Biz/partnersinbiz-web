import type { ContextReference } from '@/lib/context-references/types'

export const SUPPORT_CATEGORIES = ['bug', 'question', 'content_change', 'billing', 'urgent'] as const
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const SUPPORT_STATUSES = ['new', 'waiting_on_us', 'waiting_on_client', 'resolved'] as const
export const SUPPORT_AUTHOR_ROLES = ['client', 'admin', 'agent'] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]
export type SupportAuthorRole = (typeof SUPPORT_AUTHOR_ROLES)[number]
export type SupportMessageKind = 'comment' | 'internal_note' | 'system'
export type SupportParticipantRole = 'observer' | 'requester' | 'provider_agent' | 'provider_manager' | 'provider_owner'
export type SupportParticipantStatus = 'invited' | 'active' | 'revoked'

export interface SupportParticipant {
  id: string
  userId: string
  orgId: string
  role: SupportParticipantRole
  status: SupportParticipantStatus
  invitedByRef?: { uid: string; displayName?: string; kind?: 'human' | 'agent' }
  acceptedAt?: unknown
  revokedAt?: unknown
  revokedByRef?: { uid: string; displayName?: string; kind?: 'human' | 'agent' }
}

export interface SupportSla {
  policyId?: string
  visibility: 'requester' | 'provider' | 'shared'
  dueAt?: unknown
  breachedAt?: unknown
}

export interface SupportTicket {
  id: string
  /** Legacy owner alias. Cross-org authority is requester/provider plus a canonical resource grant. */
  orgId: string
  requesterOrgId?: string
  providerOrgId?: string
  partnerLinkId?: string
  scopeAgreementId?: string
  participants?: SupportParticipant[]
  assignment?: { assigneeUserId?: string | null; assigneeAgentId?: string | null; assignedByRef?: { uid: string; displayName?: string; kind?: 'human' | 'agent' }; claimedAt?: unknown }
  sla?: SupportSla
  orgName?: string
  createdBy: string
  requesterName: string
  requesterEmail: string
  category: SupportCategory
  subject: string
  description: string
  status: SupportStatus
  priority: SupportPriority
  sourceUrl?: string
  sourcePath?: string
  contextRefs?: ContextReference[]
  companyId?: string | null
  contactId?: string | null
  clientOrgId?: string | null
  projectId?: string | null
  dealId?: string | null
  companyIds?: string[]
  contactIds?: string[]
  clientOrgIds?: string[]
  projectIds?: string[]
  dealIds?: string[]
  researchItemIds?: string[]
  socialPostIds?: string[]
  emailThreadIds?: string[]
  assignedToType?: 'user' | 'agent' | null
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  hermesStatus?: 'not_started' | 'suggested' | 'in_progress' | 'done' | 'failed'
  hermesSummary?: string | null
  messageCount: number
  lastMessagePreview?: string
  lastMessageAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  resolvedAt?: unknown
  deleted?: boolean
}

export interface SupportMessage {
  id: string
  ticketId: string
  orgId: string
  authorId: string
  authorRole: SupportAuthorRole
  authorName: string
  body: string
  kind?: SupportMessageKind
  visibility?: 'requester' | 'provider' | 'shared'
  attachments: Array<{ name: string; url: string; contentType?: string }>
  contextRefs?: ContextReference[]
  createdAt?: unknown
}
