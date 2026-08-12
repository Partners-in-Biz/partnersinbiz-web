import type { PartnerResourceGrant, PartnerResourceType } from './types'

/** A pre-join invitation is intent only. It can never authorize by token. */
export type PrejoinInvitationStatus = 'pending' | 'pending_owner_verification' | 'activated' | 'expired' | 'revoked' | 'replaced'
export type PrejoinAdapterKey = 'project' | 'invoice' | 'quote' | 'client-document' | 'conversation' | 'support-ticket' | 'research' | 'campaign' | 'property' | 'service-workspace' | 'partner-order'

export interface PrejoinActorRef {
  kind: 'user' | 'agent' | 'system'
  id: string
}

export interface PrejoinResourceAdapter {
  key: PrejoinAdapterKey
  resourceType: PartnerResourceType
  collection: string
  allowedActions: readonly string[]
  /** False until the owning routes enforce CrossOrgPolicyService decisions. */
  acceptsPrejoinClaims: boolean
}

/**
 * Registry is intentionally conservative. Conversation, support and service
 * work are visible here for planning but cannot be issued or materialised until
 * their route-level canonical policy enforcement is delivered.
 */
export const PREJOIN_RESOURCE_ADAPTERS: readonly PrejoinResourceAdapter[] = [
  // Only adapters whose owning main-tree routes load the immutable owner and ask
  // CrossOrgPolicyService.decide may accept pre-join claims. The rest stay
  // fail-closed until their route-level enforcement + denial tests land.
  { key: 'project', resourceType: 'project', collection: 'projects', allowedActions: ['view', 'comment'], acceptsPrejoinClaims: true },
  { key: 'invoice', resourceType: 'invoice', collection: 'invoices', allowedActions: ['view'], acceptsPrejoinClaims: false },
  { key: 'quote', resourceType: 'quote', collection: 'quotes', allowedActions: ['view'], acceptsPrejoinClaims: false },
  { key: 'client-document', resourceType: 'document', collection: 'client_documents', allowedActions: ['view', 'comment'], acceptsPrejoinClaims: true },
  { key: 'research', resourceType: 'research', collection: 'research_items', allowedActions: ['view', 'comment'], acceptsPrejoinClaims: false },
  { key: 'campaign', resourceType: 'campaign', collection: 'campaigns', allowedActions: ['view', 'review_draft'], acceptsPrejoinClaims: false },
  { key: 'property', resourceType: 'property', collection: 'properties', allowedActions: ['view', 'comment'], acceptsPrejoinClaims: false },
  { key: 'partner-order', resourceType: 'custom', collection: 'orders', allowedActions: ['view'], acceptsPrejoinClaims: false },
  { key: 'conversation', resourceType: 'conversation', collection: 'conversations', allowedActions: ['view'], acceptsPrejoinClaims: false },
  { key: 'support-ticket', resourceType: 'support', collection: 'support_tickets', allowedActions: ['view'], acceptsPrejoinClaims: false },
  { key: 'service-workspace', resourceType: 'service', collection: 'serviceWorkspaces', allowedActions: ['view'], acceptsPrejoinClaims: false },
] as const

export interface PrejoinResourceInvitation {
  id: string
  /** SHA-256 (or equivalent) of the opaque delivery token; raw token never persists. */
  tokenHash: string
  ownerOrgId: string
  recipientEmailHash: string
  resourceKey: PrejoinAdapterKey
  resourceType: PartnerResourceType
  resourceId: string
  requestedActions: string[]
  fields?: string[]
  items?: string[]
  issuedByRef: PrejoinActorRef
  claimedByRef?: PrejoinActorRef
  approvedByRef?: PrejoinActorRef
  ownerVerifiedByRef?: PrejoinActorRef
  recipientUserId?: string
  recipientIdentityMatched: boolean
  status: PrejoinInvitationStatus
  expiresAt: Date
  revokedAt?: Date
  revokedByRef?: PrejoinActorRef
  revokeReason?: string
  recoveryOfInvitationId?: string
  replacedByInvitationId?: string
  createdAt: Date
  updatedAt: Date
  schemaVersion: 1
}

export interface PrejoinActivationEvidence {
  /** Hydrated from the authoritative relationship/scope/membership records by the store. */
  ownerVerifierAuthorized: boolean
  linkActive: boolean
  linkOwnerOrgId: string
  linkRecipientOrgId: string
  scopeActive: boolean
  scopePartnerLinkId: string
  scopeGrantorOrgId: string
  scopeGranteeOrgId: string
  recipientMembershipActive: boolean
}

interface CreatePrejoinResourceInvitationInput {
  id: string
  tokenHash: string
  ownerOrgId: string
  recipientEmailHash: string
  resourceType: PartnerResourceType
  resourceId: string
  requestedActions: string[]
  fields?: string[]
  items?: string[]
  issuedByRef: PrejoinActorRef
  expiresAt: Date
  now: Date
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map(clean).filter(Boolean)))
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function requireValidNow(now: Date): void {
  if (!validDate(now)) throw new Error('valid current time is required')
}

function isExpired(invitation: PrejoinResourceInvitation, now: Date): boolean {
  return !validDate(invitation.expiresAt) || !validDate(now) || invitation.expiresAt.getTime() <= now.getTime()
}

function resourceKeyForType(resourceType: PartnerResourceType): PrejoinAdapterKey | null {
  return PREJOIN_RESOURCE_ADAPTERS.find((adapter) => adapter.resourceType === resourceType && adapter.acceptsPrejoinClaims)?.key ?? null
}

export function resolvePrejoinResourceAdapter(key: PrejoinAdapterKey, requestedActions: readonly string[]): PrejoinResourceAdapter | null {
  const adapter = PREJOIN_RESOURCE_ADAPTERS.find((candidate) => candidate.key === key)
  const actions = uniqueStrings(requestedActions)
  if (!adapter || !adapter.acceptsPrejoinClaims || actions.length === 0) return null
  return actions.some((action) => !adapter.allowedActions.includes(action)) ? null : adapter
}

export function createPrejoinResourceInvitation(input: CreatePrejoinResourceInvitationInput): PrejoinResourceInvitation {
  requireValidNow(input.now)
  if (!validDate(input.expiresAt)) throw new Error('valid expiry is required')
  const resourceKey = resourceKeyForType(input.resourceType)
  const ownerOrgId = clean(input.ownerOrgId)
  const recipientEmailHash = clean(input.recipientEmailHash)
  const tokenHash = clean(input.tokenHash)
  const resourceId = clean(input.resourceId)
  const actions = uniqueStrings(input.requestedActions)
  if (!tokenHash) throw new Error('pre-join invitation token hash is required')
  if (!resourceKey || !ownerOrgId || !recipientEmailHash || !resourceId || !resolvePrejoinResourceAdapter(resourceKey, actions)) {
    throw new Error('pre-join invitation must bind one supported resource and explicit allowed actions')
  }
  if (input.expiresAt.getTime() <= input.now.getTime()) throw new Error('pre-join invitation expiry must be in the future')
  return {
    id: clean(input.id), tokenHash, ownerOrgId, recipientEmailHash, resourceKey, resourceType: input.resourceType, resourceId,
    requestedActions: actions,
    ...(uniqueStrings(input.fields).length ? { fields: uniqueStrings(input.fields) } : {}),
    ...(uniqueStrings(input.items).length ? { items: uniqueStrings(input.items) } : {}),
    issuedByRef: input.issuedByRef, recipientIdentityMatched: false, status: 'pending', expiresAt: input.expiresAt,
    createdAt: input.now, updatedAt: input.now, schemaVersion: 1,
  }
}

export function claimPrejoinResourceInvitation(input: {
  invitation: PrejoinResourceInvitation
  actor: PrejoinActorRef & { emailHash: string; identityVerified: boolean; mayApproveOnBehalf?: boolean }
  now: Date
  /** Never trusted; resource/owner/actions always come from the persisted invitation. */
  untrustedRequest?: Record<string, unknown>
}): { kind: 'claimed' | 'identity_mismatch' | 'unavailable'; invitation: PrejoinResourceInvitation } {
  const { invitation } = input
  if (invitation.status === 'revoked' || invitation.status === 'replaced' || invitation.status === 'activated' || isExpired(invitation, input.now)) {
    return { kind: 'unavailable', invitation: invitation.status === 'pending' || invitation.status === 'pending_owner_verification' ? expirePrejoinResourceInvitation({ invitation, now: input.now }) : invitation }
  }
  if (invitation.status !== 'pending') return { kind: 'unavailable', invitation }
  if (!input.actor.identityVerified || clean(input.actor.emailHash) !== invitation.recipientEmailHash) {
    // Mismatched holders must not consume, lock, or annotate a token-backed invitation.
    return { kind: 'identity_mismatch', invitation }
  }
  return {
    kind: 'claimed',
    invitation: {
      ...invitation, claimedByRef: { kind: input.actor.kind, id: input.actor.id }, recipientUserId: input.actor.id,
      recipientIdentityMatched: true, status: 'pending_owner_verification', updatedAt: input.now,
    },
  }
}

/** This is called only by the authenticated owner-authority workflow, never the public token route. */
export function recordPrejoinOwnerApproval(input: {
  invitation: PrejoinResourceInvitation
  approvedByRef: PrejoinActorRef
  ownerAuthorized: boolean
  now: Date
}): PrejoinResourceInvitation {
  requireValidNow(input.now)
  if (!input.ownerAuthorized || !clean(input.approvedByRef.id)) throw new Error('authorized owner is required')
  if (input.invitation.status !== 'pending' && input.invitation.status !== 'pending_owner_verification') {
    throw new Error('only pending invitations can record owner approval')
  }
  if (isExpired(input.invitation, input.now)) return expirePrejoinResourceInvitation({ invitation: input.invitation, now: input.now })
  return { ...input.invitation, approvedByRef: input.approvedByRef, updatedAt: input.now }
}

function hasAuthoritativeActivationEvidence(input: {
  invitation: PrejoinResourceInvitation
  partnerLinkId: string
  recipientOrgId: string
  ownerVerifiedByRef: PrejoinActorRef
  evidence: PrejoinActivationEvidence
}): boolean {
  const { invitation, partnerLinkId, recipientOrgId, ownerVerifiedByRef, evidence } = input
  return Boolean(
    clean(ownerVerifiedByRef.id) && evidence.ownerVerifierAuthorized && evidence.linkActive && evidence.scopeActive && evidence.recipientMembershipActive &&
    clean(evidence.linkOwnerOrgId) === invitation.ownerOrgId && clean(evidence.linkRecipientOrgId) === recipientOrgId &&
    clean(evidence.scopePartnerLinkId) === partnerLinkId && clean(evidence.scopeGrantorOrgId) === invitation.ownerOrgId && clean(evidence.scopeGranteeOrgId) === recipientOrgId,
  )
}

export function materializePrejoinResourceGrant(input: {
  invitation: PrejoinResourceInvitation
  partnerLinkId: string
  scopeAgreementId: string
  recipientOrgId: string
  recipientUserId: string
  ownerVerifiedByRef: PrejoinActorRef
  evidence: PrejoinActivationEvidence
  now: Date
}): { invitation: PrejoinResourceInvitation; grant: PartnerResourceGrant } {
  requireValidNow(input.now)
  const { invitation } = input
  if (invitation.status !== 'pending_owner_verification') throw new Error('pre-join invitation is not ready for owner verification')
  if (!invitation.recipientIdentityMatched || invitation.recipientUserId !== input.recipientUserId) throw new Error('verified recipient identity is required before grant materialization')
  if (isExpired(invitation, input.now)) throw new Error('pre-join invitation has expired')
  if (!resolvePrejoinResourceAdapter(invitation.resourceKey, invitation.requestedActions)) throw new Error('pre-join invitation actions are no longer allowed')
  const partnerLinkId = clean(input.partnerLinkId)
  const scopeAgreementId = clean(input.scopeAgreementId)
  const recipientOrgId = clean(input.recipientOrgId)
  if (!partnerLinkId || !scopeAgreementId || !recipientOrgId || !hasAuthoritativeActivationEvidence({ invitation, partnerLinkId, recipientOrgId, ownerVerifiedByRef: input.ownerVerifiedByRef, evidence: input.evidence })) {
    throw new Error('live bilateral link, directional scope, owner verification, and recipient membership are required')
  }
  const grant: PartnerResourceGrant = {
    id: `prejoin:${invitation.id}`, partnerLinkId, scopeAgreementId, ownerOrgId: invitation.ownerOrgId,
    resourceType: invitation.resourceType, resourceId: invitation.resourceId,
    grantee: { orgIds: [recipientOrgId], userIds: [input.recipientUserId], teamIds: [] }, actions: [...invitation.requestedActions],
    ...(invitation.fields?.length ? { fields: [...invitation.fields] } : {}), ...(invitation.items?.length ? { items: [...invitation.items] } : {}),
    status: 'active', expiresAt: invitation.expiresAt, provenance: { sourceInviteId: invitation.id },
    approvalBasis: { type: 'scope_agreement', refId: scopeAgreementId }, createdAt: input.now, updatedAt: input.now, schemaVersion: 1,
  }
  return { grant, invitation: { ...invitation, ownerVerifiedByRef: input.ownerVerifiedByRef, status: 'activated', updatedAt: input.now } }
}

export function expirePrejoinResourceInvitation(input: { invitation: PrejoinResourceInvitation; now: Date }): PrejoinResourceInvitation {
  if (input.invitation.status !== 'pending' && input.invitation.status !== 'pending_owner_verification') return input.invitation
  if (!isExpired(input.invitation, input.now)) return input.invitation
  return { ...input.invitation, status: 'expired', updatedAt: input.now }
}

export function revokePrejoinResourceInvitation(input: { invitation: PrejoinResourceInvitation; revokedByRef: PrejoinActorRef; reason: string; now: Date }): PrejoinResourceInvitation {
  requireValidNow(input.now)
  if (input.invitation.status === 'activated') throw new Error('activated invitations are revoked through the canonical grant lifecycle')
  if (input.invitation.status === 'revoked') return input.invitation
  return { ...input.invitation, status: 'revoked', revokedAt: input.now, revokedByRef: input.revokedByRef, revokeReason: clean(input.reason), updatedAt: input.now }
}

export function recoverPrejoinResourceInvitation(input: {
  invitation: PrejoinResourceInvitation
  id: string
  tokenHash: string
  issuedByRef: PrejoinActorRef
  expiresAt: Date
  now: Date
}): { source: PrejoinResourceInvitation; replacement: PrejoinResourceInvitation } {
  if (input.invitation.status !== 'expired' && input.invitation.status !== 'revoked') throw new Error('only expired or revoked invitations can be recovered')
  const replacement = createPrejoinResourceInvitation({
    id: input.id, tokenHash: clean(input.tokenHash), ownerOrgId: input.invitation.ownerOrgId, recipientEmailHash: input.invitation.recipientEmailHash,
    resourceType: input.invitation.resourceType, resourceId: input.invitation.resourceId, requestedActions: input.invitation.requestedActions,
    fields: input.invitation.fields, items: input.invitation.items, issuedByRef: input.issuedByRef, expiresAt: input.expiresAt, now: input.now,
  })
  return {
    source: { ...input.invitation, status: 'replaced', replacedByInvitationId: replacement.id, updatedAt: input.now },
    replacement: { ...replacement, recoveryOfInvitationId: input.invitation.id },
  }
}
