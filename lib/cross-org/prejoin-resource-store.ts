import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { hasBilateralAcceptance } from './lifecycle'
import {
  claimPrejoinResourceInvitation,
  createPrejoinResourceInvitation,
  expirePrejoinResourceInvitation,
  materializePrejoinResourceGrant,
  recordPrejoinOwnerApproval,
  recoverPrejoinResourceInvitation,
  revokePrejoinResourceInvitation,
  type PrejoinActivationEvidence,
  type PrejoinActorRef,
  type PrejoinResourceInvitation,
} from './prejoin-resource-adapter'
import type {
  CrossOrgPolicyStore,
  PartnerAuditEventInput,
} from './policy-service'
import { FirestoreCrossOrgPolicyStore, hashPartnerAuditEvent } from './policy-service'
import {
  PARTNER_AUDIT_EVENTS_COLLECTION,
  PARTNER_RESOURCE_GRANTS_COLLECTION,
  type PartnerResourceGrant,
  type PartnerResourceType,
} from './types'

export const PREJOIN_RESOURCE_INVITATIONS_COLLECTION = 'partnerPrejoinResourceInvitations'

interface ExactInvitationLookup {
  ownerOrgId: string
  recipientEmailHash: string
  resourceType: PartnerResourceType
  resourceId: string
  requestedActions: readonly string[]
  fields?: readonly string[]
  items?: readonly string[]
  now: Date
}

export interface PrejoinResourceStore {
  findReusableInvitation(input: ExactInvitationLookup): Promise<PrejoinResourceInvitation | null>
  getInvitationById(id: string): Promise<PrejoinResourceInvitation | null>
  getInvitationByTokenHash(tokenHash: string): Promise<PrejoinResourceInvitation | null>
  getReplacementInvitation(sourceInvitationId: string): Promise<PrejoinResourceInvitation | null>
  getGrantBySourceInvitationId(invitationId: string): Promise<PartnerResourceGrant | null>
  saveInvitation(invitation: PrejoinResourceInvitation): Promise<void>
  recoverInvitation(source: PrejoinResourceInvitation, replacement: PrejoinResourceInvitation): Promise<void>
  activateInvitation(input: { invitation: PrejoinResourceInvitation; grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void>
  revokeGrant(input: { grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void>
  appendAuditEvent(event: PartnerAuditEventInput): Promise<string>
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => clean(value)).filter(Boolean))).sort()
}

function sameStringSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = uniqueStrings(a)
  const right = uniqueStrings(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isPendingInvitation(invitation: PrejoinResourceInvitation): boolean {
  return invitation.status === 'pending' || invitation.status === 'pending_owner_verification'
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T
}

function capabilityForInvitation(invitation: PrejoinResourceInvitation): SharedBusinessCapability {
  switch (invitation.resourceKey) {
    case 'project':
      return 'projects'
    case 'invoice':
    case 'quote':
      return 'invoices'
    case 'client-document':
      return 'documents'
    case 'research':
      return 'research'
    case 'campaign':
      return 'campaigns'
    case 'property':
      return 'properties'
    case 'support-ticket':
      return 'support'
    case 'service-workspace':
      return 'services'
    case 'partner-order':
      return 'orders'
    case 'conversation':
      return 'email'
    default:
      throw new Error(`unsupported pre-join capability mapping for ${invitation.resourceKey}`)
  }
}

function relationshipsAreLive(input: {
  relationships: Array<Record<string, unknown>>
  partnerLinkId: string
  ownerOrgId: string
  recipientOrgId: string
}): boolean {
  const isLive = (row: Record<string, unknown>, sourceOrgId: string, targetOrgId: string) =>
    clean(row.partnerLinkId) === input.partnerLinkId
    && clean(row.sourceOrgId) === sourceOrgId
    && clean(row.targetOrgId) === targetOrgId
    && clean(row.status) === 'active'
    && row.deleted !== true

  return input.relationships.some((row) => isLive(row, input.ownerOrgId, input.recipientOrgId))
    && input.relationships.some((row) => isLive(row, input.recipientOrgId, input.ownerOrgId))
}

function grantAuditEvent(input: {
  eventType: 'resource_grant.created' | 'resource_grant.revoked'
  actorOrgId: string
  actorRef: { uid: string; displayName: string; kind: 'human' | 'agent' | 'system' }
  grant: PartnerResourceGrant
  reason?: string
  now: Date
}): PartnerAuditEventInput {
  return {
    eventType: input.eventType,
    partnerLinkId: input.grant.partnerLinkId,
    scopeAgreementId: input.grant.scopeAgreementId,
    resourceGrantId: input.grant.id,
    actorRef: input.actorRef,
    actorOrgId: input.actorOrgId,
    resourceType: input.grant.resourceType,
    resourceId: input.grant.resourceId,
    decision: input.eventType === 'resource_grant.created' ? 'applied' : 'rejected',
    reason: input.reason,
    metadata: {
      sourceInviteId: input.grant.provenance?.sourceInviteId,
      actions: input.grant.actions,
      fields: input.grant.fields ?? null,
      items: input.grant.items ?? null,
      status: input.grant.status,
    },
    reconciliationKey: `${input.eventType}:${input.grant.id}:${input.now.toISOString()}`,
  }
}

export class InMemoryPrejoinResourceStore implements PrejoinResourceStore {
  invitations = new Map<string, PrejoinResourceInvitation>()
  grants = new Map<string, PartnerResourceGrant>()
  auditEvents: Array<PartnerAuditEventInput & { id: string; hash: string; createdAt: Date }> = []

  async findReusableInvitation(input: ExactInvitationLookup): Promise<PrejoinResourceInvitation | null> {
    for (const invitation of this.invitations.values()) {
      if (!isPendingInvitation(invitation)) continue
      if (invitation.ownerOrgId !== input.ownerOrgId) continue
      if (invitation.recipientEmailHash !== input.recipientEmailHash) continue
      if (invitation.resourceType !== input.resourceType || invitation.resourceId !== input.resourceId) continue
      const active = expirePrejoinResourceInvitation({ invitation, now: input.now })
      if (active !== invitation) this.invitations.set(active.id, active)
      if (!isPendingInvitation(active)) continue
      if (!sameStringSet(active.requestedActions, input.requestedActions)) continue
      if (!sameStringSet(active.fields, input.fields)) continue
      if (!sameStringSet(active.items, input.items)) continue
      return active
    }
    return null
  }

  async getInvitationById(id: string): Promise<PrejoinResourceInvitation | null> {
    return this.invitations.get(id) ?? null
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<PrejoinResourceInvitation | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.tokenHash === tokenHash) return invitation
    }
    return null
  }

  async getReplacementInvitation(sourceInvitationId: string): Promise<PrejoinResourceInvitation | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.recoveryOfInvitationId === sourceInvitationId) return invitation
    }
    return null
  }

  async getGrantBySourceInvitationId(invitationId: string): Promise<PartnerResourceGrant | null> {
    for (const grant of this.grants.values()) {
      if (grant.provenance?.sourceInviteId === invitationId) return grant
    }
    return null
  }

  async saveInvitation(invitation: PrejoinResourceInvitation): Promise<void> {
    this.invitations.set(invitation.id, invitation)
  }

  async recoverInvitation(source: PrejoinResourceInvitation, replacement: PrejoinResourceInvitation): Promise<void> {
    this.invitations.set(source.id, source)
    this.invitations.set(replacement.id, replacement)
  }

  async activateInvitation(input: { invitation: PrejoinResourceInvitation; grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void> {
    this.invitations.set(input.invitation.id, input.invitation)
    this.grants.set(input.grant.id, input.grant)
    if (input.auditEvent) {
      await this.appendAuditEvent(input.auditEvent)
    }
  }

  async revokeGrant(input: { grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void> {
    this.grants.set(input.grant.id, input.grant)
    if (input.auditEvent) {
      await this.appendAuditEvent(input.auditEvent)
    }
  }

  async appendAuditEvent(event: PartnerAuditEventInput): Promise<string> {
    const id = `audit-${this.auditEvents.length + 1}`
    this.auditEvents.push({ id, ...event, hash: hashPartnerAuditEvent(event), createdAt: new Date() })
    return id
  }
}

export class FirestorePrejoinResourceStore implements PrejoinResourceStore {
  async findReusableInvitation(input: ExactInvitationLookup): Promise<PrejoinResourceInvitation | null> {
    const snap = await adminDb
      .collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION)
      .where('resourceId', '==', input.resourceId)
      .limit(100)
      .get()

    for (const doc of snap.docs) {
      const invitation = { id: doc.id, ...(doc.data() as Omit<PrejoinResourceInvitation, 'id'>) }
      if (!isPendingInvitation(invitation)) continue
      if (invitation.ownerOrgId !== input.ownerOrgId) continue
      if (invitation.recipientEmailHash !== input.recipientEmailHash) continue
      if (invitation.resourceType !== input.resourceType) continue
      const active = expirePrejoinResourceInvitation({ invitation, now: input.now })
      if (active !== invitation) {
        await this.saveInvitation(active)
      }
      if (!isPendingInvitation(active)) continue
      if (!sameStringSet(active.requestedActions, input.requestedActions)) continue
      if (!sameStringSet(active.fields, input.fields)) continue
      if (!sameStringSet(active.items, input.items)) continue
      return active
    }
    return null
  }

  async getInvitationById(id: string): Promise<PrejoinResourceInvitation | null> {
    const snap = await adminDb.collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION).doc(id).get()
    return snap.exists ? { id: snap.id, ...(snap.data() as Omit<PrejoinResourceInvitation, 'id'>) } : null
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<PrejoinResourceInvitation | null> {
    const snap = await adminDb
      .collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION)
      .where('tokenHash', '==', tokenHash)
      .limit(1)
      .get()
    if (snap.empty) return null
    const doc = snap.docs[0]
    return { id: doc.id, ...(doc.data() as Omit<PrejoinResourceInvitation, 'id'>) }
  }

  async getReplacementInvitation(sourceInvitationId: string): Promise<PrejoinResourceInvitation | null> {
    const snap = await adminDb
      .collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION)
      .where('recoveryOfInvitationId', '==', sourceInvitationId)
      .limit(1)
      .get()
    if (snap.empty) return null
    const doc = snap.docs[0]
    return { id: doc.id, ...(doc.data() as Omit<PrejoinResourceInvitation, 'id'>) }
  }

  async getGrantBySourceInvitationId(invitationId: string): Promise<PartnerResourceGrant | null> {
    const snap = await adminDb
      .collection(PARTNER_RESOURCE_GRANTS_COLLECTION)
      .where('provenance.sourceInviteId', '==', invitationId)
      .limit(1)
      .get()
    if (snap.empty) return null
    const doc = snap.docs[0]
    return { id: doc.id, ...(doc.data() as Omit<PartnerResourceGrant, 'id'>) }
  }

  async saveInvitation(invitation: PrejoinResourceInvitation): Promise<void> {
    const { id, ...rest } = invitation
    await adminDb.collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION).doc(id).set(stripUndefined(rest), { merge: true })
  }

  async recoverInvitation(source: PrejoinResourceInvitation, replacement: PrejoinResourceInvitation): Promise<void> {
    await adminDb.runTransaction(async (tx) => {
      const { id: sourceId, ...sourceRest } = source
      const { id: replacementId, ...replacementRest } = replacement
      tx.set(adminDb.collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION).doc(sourceId), stripUndefined(sourceRest), { merge: true })
      tx.set(adminDb.collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION).doc(replacementId), stripUndefined(replacementRest), { merge: true })
    })
  }

  async activateInvitation(input: { invitation: PrejoinResourceInvitation; grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void> {
    await adminDb.runTransaction(async (tx) => {
      const invitationRef = adminDb.collection(PREJOIN_RESOURCE_INVITATIONS_COLLECTION).doc(input.invitation.id)
      const grantRef = adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(input.grant.id)
      const { id: invitationId, ...invitationRest } = input.invitation
      const { id: grantId, ...grantRest } = input.grant
      tx.set(invitationRef, stripUndefined(invitationRest), { merge: true })
      tx.set(grantRef, stripUndefined(grantRest), { merge: true })
      if (input.auditEvent) {
        const auditRef = adminDb.collection(PARTNER_AUDIT_EVENTS_COLLECTION).doc()
        tx.set(auditRef, {
          ...input.auditEvent,
          hash: hashPartnerAuditEvent(input.auditEvent),
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      void invitationId
      void grantId
    })
  }

  async revokeGrant(input: { grant: PartnerResourceGrant; auditEvent?: PartnerAuditEventInput }): Promise<void> {
    await adminDb.runTransaction(async (tx) => {
      const { id, ...grantRest } = input.grant
      tx.set(adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(id), stripUndefined(grantRest), { merge: true })
      if (input.auditEvent) {
        const auditRef = adminDb.collection(PARTNER_AUDIT_EVENTS_COLLECTION).doc()
        tx.set(auditRef, {
          ...input.auditEvent,
          hash: hashPartnerAuditEvent(input.auditEvent),
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    })
  }

  async appendAuditEvent(event: PartnerAuditEventInput): Promise<string> {
    const ref = await adminDb.collection(PARTNER_AUDIT_EVENTS_COLLECTION).add({
      ...event,
      hash: hashPartnerAuditEvent(event),
      createdAt: FieldValue.serverTimestamp(),
    })
    return ref.id
  }
}

export class PrejoinResourceService {
  constructor(
    private readonly deps: {
      invitationStore: PrejoinResourceStore
      policyStore: Pick<CrossOrgPolicyStore, 'loadActiveOrgMember' | 'loadPartnerLink' | 'loadRelationships' | 'loadScopeAgreement'>
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueInvitation(input: {
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
    now?: Date
  }): Promise<PrejoinResourceInvitation> {
    const now = input.now ?? this.now()
    const existing = await this.deps.invitationStore.findReusableInvitation({
      ownerOrgId: input.ownerOrgId,
      recipientEmailHash: input.recipientEmailHash,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestedActions: input.requestedActions,
      fields: input.fields,
      items: input.items,
      now,
    })
    if (existing) return existing

    const invitation = createPrejoinResourceInvitation({
      id: input.id,
      tokenHash: input.tokenHash,
      ownerOrgId: input.ownerOrgId,
      recipientEmailHash: input.recipientEmailHash,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestedActions: input.requestedActions,
      fields: input.fields,
      items: input.items,
      issuedByRef: input.issuedByRef,
      expiresAt: input.expiresAt,
      now,
    })
    await this.deps.invitationStore.saveInvitation(invitation)
    return invitation
  }

  async claimInvitationByTokenHash(input: {
    tokenHash: string
    actor: PrejoinActorRef & { emailHash: string; identityVerified: boolean; mayApproveOnBehalf?: boolean }
    now?: Date
  }): Promise<{ kind: 'claimed' | 'identity_mismatch' | 'unavailable'; invitation: PrejoinResourceInvitation }> {
    const now = input.now ?? this.now()
    const invitation = await this.deps.invitationStore.getInvitationByTokenHash(clean(input.tokenHash))
    if (!invitation) throw new Error('pre-join invitation not found')
    const result = claimPrejoinResourceInvitation({ invitation, actor: input.actor, now })
    if (result.invitation !== invitation) {
      await this.deps.invitationStore.saveInvitation(result.invitation)
    }
    return result
  }

  async recordOwnerApproval(input: {
    invitationId: string
    approvedByRef: PrejoinActorRef
    ownerAuthorized: boolean
    now?: Date
  }): Promise<PrejoinResourceInvitation> {
    const invitation = await this.requireInvitation(input.invitationId)
    const next = recordPrejoinOwnerApproval({
      invitation,
      approvedByRef: input.approvedByRef,
      ownerAuthorized: input.ownerAuthorized,
      now: input.now ?? this.now(),
    })
    if (next !== invitation) await this.deps.invitationStore.saveInvitation(next)
    return next
  }

  async activateInvitation(input: {
    invitationId: string
    partnerLinkId: string
    recipientOrgId: string
    recipientUserId: string
    ownerVerifiedByRef: PrejoinActorRef
    ownerVerifierAuthorized: boolean
    now?: Date
  }): Promise<{ invitation: PrejoinResourceInvitation; grant: PartnerResourceGrant }> {
    const now = input.now ?? this.now()
    const invitation = await this.requireInvitation(input.invitationId)
    const existingGrant = await this.deps.invitationStore.getGrantBySourceInvitationId(invitation.id)
    if (existingGrant) return { invitation, grant: existingGrant }
    if (!invitation.approvedByRef) throw new Error('owner approval is required before grant materialization')

    const link = await this.deps.policyStore.loadPartnerLink(input.partnerLinkId)
    const relationships = await this.deps.policyStore.loadRelationships(input.partnerLinkId)
    const scopeAgreement = await this.deps.policyStore.loadScopeAgreement(input.partnerLinkId, input.recipientOrgId)
    const recipientMembership = await this.deps.policyStore.loadActiveOrgMember(input.recipientOrgId, input.recipientUserId)
    const requiredCapability = capabilityForInvitation(invitation)

    const evidence: PrejoinActivationEvidence = {
      ownerVerifierAuthorized: input.ownerVerifierAuthorized,
      linkActive: Boolean(
        link
        && clean(link.status) === 'active'
        && [clean(link.orgA), clean(link.orgB)].includes(invitation.ownerOrgId)
        && [clean(link.orgA), clean(link.orgB)].includes(clean(input.recipientOrgId))
        && relationshipsAreLive({
          relationships,
          partnerLinkId: clean(input.partnerLinkId),
          ownerOrgId: invitation.ownerOrgId,
          recipientOrgId: clean(input.recipientOrgId),
        }),
      ),
      linkOwnerOrgId: invitation.ownerOrgId,
      linkRecipientOrgId: clean(input.recipientOrgId),
      scopeActive: Boolean(
        scopeAgreement
        && clean(scopeAgreement.status) === 'active'
        && scopeAgreement.direction?.grantorOrgId === invitation.ownerOrgId
        && scopeAgreement.direction?.granteeOrgId === clean(input.recipientOrgId)
        && scopeAgreement.capabilities?.includes(requiredCapability)
        && hasBilateralAcceptance(scopeAgreement),
      ),
      scopePartnerLinkId: clean(input.partnerLinkId),
      scopeGrantorOrgId: invitation.ownerOrgId,
      scopeGranteeOrgId: clean(input.recipientOrgId),
      recipientMembershipActive: recipientMembership !== null,
    }

    const result = materializePrejoinResourceGrant({
      invitation,
      partnerLinkId: clean(input.partnerLinkId),
      scopeAgreementId: clean(scopeAgreement?.id),
      recipientOrgId: clean(input.recipientOrgId),
      recipientUserId: clean(input.recipientUserId),
      ownerVerifiedByRef: input.ownerVerifiedByRef,
      evidence,
      now,
    })
    await this.deps.invitationStore.activateInvitation({
      invitation: result.invitation,
      grant: result.grant,
      auditEvent: grantAuditEvent({
        eventType: 'resource_grant.created',
        actorOrgId: invitation.ownerOrgId,
        actorRef: {
          uid: clean(input.ownerVerifiedByRef.id) || 'system:unknown',
          displayName: clean(input.ownerVerifiedByRef.id) || 'Unknown',
          kind: input.ownerVerifiedByRef.kind === 'agent' ? 'agent' : input.ownerVerifiedByRef.kind === 'system' ? 'system' : 'human',
        },
        grant: result.grant,
        now,
      }),
    })
    return result
  }

  async revokeInvitation(input: {
    invitationId: string
    revokedByRef: PrejoinActorRef
    reason: string
    now?: Date
  }): Promise<PrejoinResourceInvitation> {
    const invitation = await this.requireInvitation(input.invitationId)
    const next = revokePrejoinResourceInvitation({
      invitation,
      revokedByRef: input.revokedByRef,
      reason: input.reason,
      now: input.now ?? this.now(),
    })
    if (next !== invitation) await this.deps.invitationStore.saveInvitation(next)
    return next
  }

  async recoverInvitation(input: {
    invitationId: string
    replacementId: string
    replacementTokenHash: string
    issuedByRef: PrejoinActorRef
    expiresAt: Date
    now?: Date
  }): Promise<{ source: PrejoinResourceInvitation; replacement: PrejoinResourceInvitation }> {
    const invitation = await this.requireInvitation(input.invitationId)
    const replacement = await this.deps.invitationStore.getReplacementInvitation(invitation.id)
    if (invitation.status === 'replaced' && replacement) {
      return { source: invitation, replacement }
    }
    const result = recoverPrejoinResourceInvitation({
      invitation,
      id: input.replacementId,
      tokenHash: input.replacementTokenHash,
      issuedByRef: input.issuedByRef,
      expiresAt: input.expiresAt,
      now: input.now ?? this.now(),
    })
    await this.deps.invitationStore.recoverInvitation(result.source, result.replacement)
    return result
  }

  async revokeGrantByInvitationId(input: {
    invitationId: string
    revokedByRef: { uid: string; displayName: string; kind: 'human' | 'agent' | 'system' }
    actorOrgId: string
    reason: string
    now?: Date
  }): Promise<PartnerResourceGrant | null> {
    const grant = await this.deps.invitationStore.getGrantBySourceInvitationId(input.invitationId)
    if (!grant) return null
    if (grant.status === 'revoked') return grant
    const now = input.now ?? this.now()
    const next: PartnerResourceGrant = {
      ...grant,
      status: 'revoked',
      revokedAt: now,
      revokedByRef: input.revokedByRef,
      revokeReason: clean(input.reason),
      updatedAt: now,
    }
    await this.deps.invitationStore.revokeGrant({
      grant: next,
      auditEvent: grantAuditEvent({
        eventType: 'resource_grant.revoked',
        actorOrgId: input.actorOrgId,
        actorRef: input.revokedByRef,
        grant: next,
        reason: clean(input.reason),
        now,
      }),
    })
    return next
  }

  private async requireInvitation(invitationId: string): Promise<PrejoinResourceInvitation> {
    const invitation = await this.deps.invitationStore.getInvitationById(clean(invitationId))
    if (!invitation) throw new Error('pre-join invitation not found')
    return invitation
  }
}

export function createPrejoinResourceService(
  invitationStore?: PrejoinResourceStore,
  policyStore?: Pick<CrossOrgPolicyStore, 'loadActiveOrgMember' | 'loadPartnerLink' | 'loadRelationships' | 'loadScopeAgreement'>,
  now?: () => Date,
): PrejoinResourceService {
  return new PrejoinResourceService({
    invitationStore: invitationStore ?? new FirestorePrejoinResourceStore(),
    policyStore: policyStore ?? new FirestoreCrossOrgPolicyStore(),
  }, now)
}

export async function getPrejoinInvitationById(invitationId: string): Promise<PrejoinResourceInvitation | null> {
  return new FirestorePrejoinResourceStore().getInvitationById(invitationId)
}
