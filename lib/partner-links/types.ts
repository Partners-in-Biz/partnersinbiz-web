import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type {
  FieldSharingPolicy,
  SharedBusinessCapability,
} from '@/lib/business-relationships/types'

/**
 * A partner invite is relationship-first: unlike `claimable_relationships`
 * (which hangs off an invoice or project), it exists purely to establish a
 * mutual link between two organisations.
 *
 * `kind: 'company'` invites a CRM company; `kind: 'contact'` invites a specific
 * person, but still links that person's parent company — the difference is only
 * which contact record gets stamped with the accepting user's uid.
 */
export type PartnerInviteKind = 'company' | 'contact'

export type PartnerInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired'

export const PARTNER_INVITE_COLLECTION = 'partner_invites'

/** 30 days, matching the signature-request TTL used elsewhere. */
export const PARTNER_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const DEFAULT_PARTNER_CAPABILITIES: SharedBusinessCapability[] = [
  'crm',
  'projects',
  'documents',
  'services',
]

export const DEFAULT_PARTNER_FIELD_SHARING: FieldSharingPolicy = {
  companyProfile: true,
  contacts: true,
  projects: true,
  documents: true,
  commerce: false,
  analytics: false,
}

export interface PartnerInvite {
  id: string
  kind: PartnerInviteKind

  // Inviting side — always the org that owns the CRM records below.
  sourceOrgId: string
  sourceCompanyId: string
  sourceContactId?: string

  // Recipient identity. `recipientEmail` is normalised lowercase and binds the
  // token: acceptance requires either that email's own session, or an
  // owner/admin of an org that email already belongs to.
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  message?: string

  // Sharing proposed by the inviter, confirmable at accept time.
  proposedCapabilities: SharedBusinessCapability[]
  proposedFieldSharingPolicy: FieldSharingPolicy

  // Resolved on accept.
  targetOrgId?: string
  targetUserId?: string
  targetCompanyId?: string
  targetContactId?: string
  partnerLinkId?: string
  sourceRelationshipId?: string
  targetRelationshipId?: string

  inviteToken: string
  status: PartnerInviteStatus
  expiresAt: string

  acceptedAt?: unknown
  declinedAt?: unknown
  revokedAt?: unknown
  acceptedByUserId?: string

  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  /** uid + email of the inviting human, mirrored into the acceptor's CRM. */
  inviterUserId?: string
  inviterEmail?: string
  inviterName?: string

  createdAt?: unknown
  updatedAt?: unknown
}

export interface CreatePartnerInviteInput {
  kind: PartnerInviteKind
  sourceOrgId: string
  sourceCompanyId: string
  sourceContactId?: string
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  message?: string
  capabilities?: SharedBusinessCapability[]
  fieldSharingPolicy?: FieldSharingPolicy
  actor: MemberRef
  inviterUserId?: string
  inviterEmail?: string
  inviterName?: string
}

export interface AcceptPartnerInviteInput {
  invite: PartnerInvite
  targetOrgId: string
  targetUserId: string
  /**
   * Company in the acceptor's CRM that should represent the inviting org. When
   * omitted a mirror company is matched by domain/name or created.
   */
  preferTargetCompanyId?: string
  capabilities?: SharedBusinessCapability[]
  fieldSharingPolicy?: FieldSharingPolicy
  actor: MemberRef
}

export interface AcceptPartnerInviteResult {
  partnerLinkId: string
  sourceRelationshipId: string
  targetRelationshipId: string
  targetOrgId: string
  targetUserId: string
  targetCompanyId: string
  targetContactId?: string
  sourceContactId?: string
}

export interface UnlinkPartnershipInput {
  relationshipId: string
  actingOrgId: string
  actor: MemberRef
}

export interface UnlinkPartnershipResult {
  partnerLinkId?: string
  revokedRelationshipIds: string[]
  /** Per-record shares torn down because the link they rode on was severed. */
  revokedShareIds: string[]
  /** Partner project grants torn down for the same reason. */
  revokedProjectAccessIds: string[]
  clearedCompanyIds: string[]
  clearedContactIds: string[]
}

export function isPartnerInviteExpired(invite: Pick<PartnerInvite, 'expiresAt'>, now = new Date()): boolean {
  if (!invite.expiresAt) return false
  const parsed = Date.parse(invite.expiresAt)
  if (Number.isNaN(parsed)) return false
  return parsed < now.getTime()
}
