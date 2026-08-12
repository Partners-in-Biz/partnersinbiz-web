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
  research: false,
  properties: false,
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
  /** The invited recipient's user id when the recipient identity matched the
   * accepting session. Absent when an owner/admin accepted on the recipient's
   * behalf — the approver is recorded separately and never becomes the
   * invited contact's linked user. */
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
  /** uid of the person who actually accepted (the approver — the recipient
   * themselves OR an owner/admin who accepted on their behalf). */
  acceptedByUserId?: string
  /** Recipient's uid when the accepting session matched the invite email. */
  recipientUserId?: string
  /** True when the recipient identity itself accepted (session email matched). */
  recipientIdentityMatched?: boolean
  /** MemberRef of the approver (whoever clicked accept). */
  approvedByRef?: MemberRef

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
  /**
   * The invited recipient's user id — present ONLY when the recipient identity
   * itself accepted (session email matched the invite email). An owner/admin
   * accepting on the recipient's behalf must NOT pass this: the approver is
   * recorded via approvedByRef/acceptedByUserId and never becomes the invited
   * contact's linked user.
   */
  targetUserId?: string
  /**
   * The person who actually accepted (recipient or an owner/admin on their
   * behalf). Recorded separately from the recipient identity.
   */
  approvedByUserId?: string
  /** True when the accepting session's email matched the invite email. */
  recipientIdentityMatched?: boolean
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
  /** Recipient uid when identity matched; otherwise undefined. */
  targetUserId?: string
  /** The approver's uid (whoever clicked accept). */
  approvedByUserId?: string
  /** True when the recipient identity itself accepted. */
  recipientIdentityMatched: boolean
  /** Canonical identity link ids created for this acceptance. */
  identityLinkIds: string[]
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
  /** Canonical identity links revoked by the unlink cascade. */
  revokedIdentityLinkIds: string[]
  /** Open orders cancelled so their reserved stock is not stranded. */
  cancelledOrderIds: string[]
  /** Inventory rows whose reservations were returned to available. */
  releasedInventoryIds: string[]
  clearedCompanyIds: string[]
  clearedContactIds: string[]
}

export function isPartnerInviteExpired(invite: Pick<PartnerInvite, 'expiresAt'>, now = new Date()): boolean {
  if (!invite.expiresAt) return false
  const parsed = Date.parse(invite.expiresAt)
  if (Number.isNaN(parsed)) return false
  return parsed < now.getTime()
}
