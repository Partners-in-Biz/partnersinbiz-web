// lib/cross-org/types.ts
//
// Canonical cross-organisation contracts (ADR:
// docs/architecture/cross-org-access-model.md, task RBa6Ykx9AbBFrkrX5sAg).
//
// These types are the single source of truth for the five contracts:
//   1. PartnerLink (bilateral reciprocal link)
//   2. PartnerScopeAgreement (directional capability/field policy)
//   3. PartnerResourceGrant (resource access grant)
//   4. PartnerIdentityLink (many-to-many company/contact <-> org/user)
//   5. PartnerAuditEvent (append-only)
//
// Access authority comes ONLY from these canonical contracts (plus the active
// membership predicate). Legacy CRM convenience pointers (linkedOrgId /
// linkedUserId / allowedOrgIds / allowedUserIds) are compatibility inputs and
// never grant access by themselves.

import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type {
  FieldSharingPolicy,
  SharedBusinessCapability,
} from '@/lib/business-relationships/types'

// ── Collections ──────────────────────────────────────────────────────────────

export const PARTNER_LINKS_COLLECTION = 'partnerLinks'
export const PARTNER_SCOPE_AGREEMENTS_COLLECTION = 'partnerScopeAgreements'
export const PARTNER_RESOURCE_GRANTS_COLLECTION = 'partnerResourceGrants'
export const PARTNER_IDENTITY_LINKS_COLLECTION = 'partnerIdentityLinks'
export const PARTNER_AUDIT_EVENTS_COLLECTION = 'partnerAuditEvents'

/** Canonical schema version for every contract; bump on breaking shape changes. */
export const CROSS_ORG_SCHEMA_VERSION = 1

// ── 1. PartnerLink (bilateral) ───────────────────────────────────────────────

export type PartnerLinkStatus = 'active' | 'paused' | 'revoked' | 'archived'

export interface PartnerLink {
  id: string
  /** Canonical shared id stamped on both businessRelationships rows. */
  partnerLinkId: string
  orgA: string
  orgB: string
  /** The two per-tenant businessRelationships row ids. */
  relationshipIdA: string
  relationshipIdB: string
  /** Capability families the pair may negotiate; actual grants come from scope agreements. */
  negotiableCapabilities: SharedBusinessCapability[]
  status: PartnerLinkStatus
  schemaVersion: number
  createdAt: unknown
  updatedAt: unknown
  revokedAt?: unknown
  revokedByRef?: MemberRef
  revokeReason?: string
}

export interface PartnerLinkPair {
  link: PartnerLink
  /** Mirrored businessRelationships rows, one per tenant. */
  relationshipA: Record<string, unknown>
  relationshipB: Record<string, unknown>
}

// ── 2. PartnerScopeAgreement (directional) ───────────────────────────────────

export type PartnerScopeAgreementStatus =
  | 'draft'
  | 'proposed'
  | 'active'
  | 'paused'
  | 'revoked'
  | 'expired'

export interface PartnerScopeAgreement {
  id: string
  partnerLinkId: string
  /** Direction is explicit: grantor -> grantee. A→B and B→A are separate docs. */
  direction: {
    grantorOrgId: string
    granteeOrgId: string
  }
  capabilities: SharedBusinessCapability[]
  fieldSharingPolicy: FieldSharingPolicy
  status: PartnerScopeAgreementStatus
  version: number
  schemaVersion: number
  proposedByRef?: MemberRef
  acceptedByRef?: MemberRef
  effectiveAt?: unknown
  expiresAt?: unknown
  createdAt: unknown
  updatedAt: unknown
  revokedAt?: unknown
  revokeReason?: string
}

// ── 3. PartnerResourceGrant ──────────────────────────────────────────────────

export type PartnerResourceGrantStatus = 'active' | 'paused' | 'revoked' | 'expired'

export type PartnerResourceType =
  | 'project'
  | 'document'
  | 'invoice'
  | 'quote'
  | 'conversation'
  | 'deal'
  | 'campaign'
  | 'social_post'
  | 'email'
  | 'seo'
  | 'ads'
  | 'support'
  | 'service'
  | 'research'
  | 'property'
  | 'custom'

export interface PartnerResourceGrant {
  id: string
  partnerLinkId?: string
  scopeAgreementId?: string
  ownerOrgId: string
  resourceType: PartnerResourceType
  resourceId: string
  grantee: {
    orgIds: string[]
    userIds: string[]
    teamIds: string[]
  }
  /** Module role string, e.g. project member role, org role, or module action set. */
  role?: string
  /** Empty/omitted = all actions on the resource; otherwise allowlist. */
  actions: string[]
  /** Field-level allowlist when set; empty = all fields. */
  fields?: string[]
  /** Item-level allowlist when set; empty = all items. */
  items?: string[]
  status: PartnerResourceGrantStatus
  expiresAt?: unknown
  provenance: {
    sourceDocumentId?: string
    sourceDocumentSectionId?: string
    approvalGateTaskId?: string
    sourceResearchItemId?: string
    sourceShareId?: string
  }
  approvalBasis:
    | { type: 'partner_link'; refId: string }
    | { type: 'scope_agreement'; refId: string }
    | { type: 'approval_task'; refId: string }
    | { type: 'system' }
  createdByRef?: MemberRef
  createdAt: unknown
  updatedAt: unknown
  revokedAt?: unknown
  revokedByRef?: MemberRef
  revokeReason?: string
  schemaVersion: number
}

// ── 4. PartnerIdentityLink (many-to-many) ────────────────────────────────────

export type PartnerIdentityLinkType =
  | 'company_org'
  | 'contact_user'
  | 'company_user'
  | 'contact_org'

export type PartnerIdentityLinkStatus = 'verified' | 'unverified' | 'revoked'

export interface PartnerIdentityLink {
  id: string
  linkType: PartnerIdentityLinkType
  sourceRef: { kind: 'company' | 'contact'; id: string }
  targetRef: { kind: 'org' | 'user'; id: string }
  status: PartnerIdentityLinkStatus
  /** The admin who accepted/verified — never the recipient identity itself. */
  verifiedByRef?: MemberRef
  verifiedAt?: unknown
  revokedByRef?: MemberRef
  revokedAt?: unknown
  provenance: {
    sourceInviteId?: string
    sourceDocumentId?: string
    approvalGateTaskId?: string
  }
  schemaVersion: number
  createdAt: unknown
  updatedAt: unknown
}

// ── 5. PartnerAuditEvent (append-only) ───────────────────────────────────────

export type PartnerAuditEventType =
  | 'partner_link.invited'
  | 'partner_link.accepted'
  | 'partner_link.unlinked'
  | 'scope_agreement.proposed'
  | 'scope_agreement.accepted'
  | 'scope_agreement.revoked'
  | 'resource_grant.created'
  | 'resource_grant.revoked'
  | 'resource_grant.expired'
  | 'access.decided'
  | 'identity_link.created'
  | 'identity_link.verified'
  | 'identity_link.revoked'
  | 'capability.reduced'
  | 'settlement.approved'
  | 'reconciliation.ran'

export type PartnerAuditDecision = 'allowed' | 'denied' | 'applied' | 'rejected'

export interface PartnerAuditEvent {
  id: string
  eventType: PartnerAuditEventType
  partnerLinkId?: string
  scopeAgreementId?: string
  resourceGrantId?: string
  identityLinkId?: string
  actorRef?: MemberRef
  actorOrgId: string
  resourceType?: string
  resourceId?: string
  decision?: PartnerAuditDecision
  reason?: string
  metadata?: Record<string, unknown>
  reconciliationKey?: string
  hash?: string
  createdAt: unknown
}

// ── Decision evaluation input/output ─────────────────────────────────────────

export type PartnerAccessContext =
  | 'within_org'
  | 'cross_org_link'
  | 'cross_org_grant'
  | 'public'

export interface DecisionStep {
  step:
    | 'actor'
    | 'active_membership'
    | 'reciprocal_link'
    | 'capability'
    | 'resource_grant'
    | 'user_role'
    | 'action_field'
    | 'lifecycle'
  passed: boolean
  detail?: string
}

export interface PartnerAccessDecision {
  allowed: boolean
  reason?: string
  chain: DecisionStep[]
}

export interface PartnerAccessInput {
  actor: {
    userId: string
    orgId: string
    /** True when the caller is a platform super admin / AI with global authority. */
    platformAdmin?: boolean
  }
  /** Access surface: within-org (own tenant) vs cross-org link/grant vs public. */
  context?: PartnerAccessContext
  resourceType: PartnerResourceType | 'custom'
  resourceId: string
  action: string
  field?: string
  item?: string
  /** Required when the resource crosses org boundaries. */
  partnerLinkId?: string
  /** Required capability family when the action is capability-gated. */
  requiredCapability?: SharedBusinessCapability
  /** Directional scope agreement to evaluate capability/field policy against. */
  scopeAgreement?: PartnerScopeAgreement
  /** Active resource grant when one is claimed. */
  grant?: PartnerResourceGrant
  /** Mirrored relationship rows for the link (both sides). */
  relationships?: Array<Record<string, unknown>>
  /** Actor's role on the resource (project member role / module role / team). */
  actorRole?: string
  /** Team ids the actor belongs to on the resource. */
  actorTeamIds?: string[]
  /** Role rank comparator: higher-or-equal rank passes. */
  roleRank?: (actorRole: string | undefined, requiredRole: string) => boolean
  /** True when membership was already checked by the caller. */
  membershipActive?: boolean
  /** True when an explicit identity link verified the actor's identity. */
  identityVerified?: boolean
  /**
   * Set false for capability-only checks (evaluatePartnerCapability) where a
   * resource grant is not yet in scope; defaults to true (cross-org access
   * requires an explicit grant).
   */
  requireGrant?: boolean
  now?: Date
}
