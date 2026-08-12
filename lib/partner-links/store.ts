import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import { ensureBusinessRelationship, updateBusinessRelationship } from '@/lib/business-relationships/store'
import type { BusinessRelationship } from '@/lib/business-relationships/types'
import { cleanString, normalizeEmail } from './identity'
import { ensureMirrorCompany, ensureMirrorContact } from './mirror'
import { revokeSharesForPartnerLink } from './shares'
import { revokeProjectAccessForPartnerLink } from './collaboration'
import { cancelOpenOrdersForPartnerLink } from './trade'
import {
  CROSS_ORG_SCHEMA_VERSION,
  PARTNER_LINKS_COLLECTION,
  PARTNER_SCOPE_AGREEMENTS_COLLECTION,
} from '@/lib/cross-org/types'
import {
  ensureIdentityLink,
  planIdentityLinksForAcceptance,
  revokeIdentityLinksForPartnerLink,
  resyncPointersForSource,
} from '@/lib/cross-org/identity'
import {
  DEFAULT_PARTNER_CAPABILITIES,
  DEFAULT_PARTNER_FIELD_SHARING,
  PARTNER_INVITE_COLLECTION,
  PARTNER_INVITE_TTL_MS,
  isPartnerInviteExpired,
  type AcceptPartnerInviteInput,
  type AcceptPartnerInviteResult,
  type CreatePartnerInviteInput,
  type PartnerInvite,
  type UnlinkPartnershipInput,
  type UnlinkPartnershipResult,
} from './types'

const RELATIONSHIP_COLLECTION = 'businessRelationships'

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

function toInvite(id: string, data: Record<string, unknown>): PartnerInvite {
  return { id, ...(data as Omit<PartnerInvite, 'id'>) }
}

export async function getPartnerInviteById(id: string): Promise<PartnerInvite | null> {
  const snap = await adminDb.collection(PARTNER_INVITE_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return toInvite(snap.id, snap.data() ?? {})
}

export async function getPartnerInviteByToken(token: string): Promise<PartnerInvite | null> {
  const clean = cleanString(token)
  if (clean.length < 12) return null
  const snap = await adminDb
    .collection(PARTNER_INVITE_COLLECTION)
    .where('inviteToken', '==', clean)
    .limit(1)
    .get()
  if (snap.empty) return null
  return toInvite(snap.docs[0].id, snap.docs[0].data() ?? {})
}

export async function listPartnerInvites(
  sourceOrgId: string,
  params: { status?: string; limit?: number } = {},
): Promise<PartnerInvite[]> {
  const snap = await adminDb
    .collection(PARTNER_INVITE_COLLECTION)
    .where('sourceOrgId', '==', sourceOrgId)
    .limit(500)
    .get()

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
  return snap.docs
    .map((doc) => toInvite(doc.id, doc.data() ?? {}))
    .filter((row) => (params.status ? row.status === params.status : true))
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .slice(0, limit)
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof ts.toMillis === 'function') return ts.toMillis()
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export interface PartnerLinkSummary {
  relationshipId: string
  partnerLinkId?: string
  status: string
  partnerOrgId?: string
  partnerOrgName?: string
  /** The company in THIS org's CRM that represents the partner. */
  companyId?: string
  companyName?: string
  contactId?: string
  sharedCapabilities: string[]
  fieldSharingPolicy?: Record<string, boolean>
  relationshipType?: string
  updatedAt: unknown
}

/**
 * Partner links owned by this org — the rows created by an accepted partner
 * invite, which is what the portal management surface lists.
 */
export async function listPartnerLinks(orgId: string): Promise<PartnerLinkSummary[]> {
  const snap = await adminDb
    .collection(RELATIONSHIP_COLLECTION)
    .where('sourceOrgId', '==', orgId)
    .limit(1000)
    .get()

  const rows = snap.docs
    .map((d) => ({ ...(d.data() as BusinessRelationship), id: d.id }))
    .filter((r) => r.deleted !== true && cleanString(r.partnerLinkId))

  const out: PartnerLinkSummary[] = []
  for (const row of rows) {
    let companyName = ''
    if (row.sourceCompanyId) {
      const c = await adminDb.collection('companies').doc(row.sourceCompanyId).get()
      companyName = cleanString((c.data() ?? {}).name)
    }
    out.push({
      relationshipId: row.id,
      partnerLinkId: row.partnerLinkId,
      status: row.status,
      partnerOrgId: row.targetOrgId,
      partnerOrgName: row.targetName,
      companyId: row.sourceCompanyId,
      companyName: companyName || row.targetName,
      contactId: row.sourceContactId,
      sharedCapabilities: row.sharedCapabilities ?? [],
      fieldSharingPolicy: (row.fieldSharingPolicy ?? {}) as Record<string, boolean>,
      relationshipType: row.relationshipType,
      updatedAt: row.updatedAt,
    })
  }

  return out.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))
}

/**
 * Idempotent on (sourceOrgId, kind, sourceCompanyId, recipientEmail) while a
 * pending invite exists — re-inviting resends the same token rather than
 * minting a second one.
 */
export async function createPartnerInvite(
  input: CreatePartnerInviteInput,
): Promise<{ invite: PartnerInvite; created: boolean }> {
  const sourceOrgId = cleanString(input.sourceOrgId)
  const sourceCompanyId = cleanString(input.sourceCompanyId)
  const recipientEmail = normalizeEmail(input.recipientEmail)
  if (!sourceOrgId) throw new Error('sourceOrgId is required')
  if (!sourceCompanyId) throw new Error('sourceCompanyId is required')
  if (!recipientEmail) throw new Error('recipientEmail is required')

  const existingSnap = await adminDb
    .collection(PARTNER_INVITE_COLLECTION)
    .where('sourceOrgId', '==', sourceOrgId)
    .where('sourceCompanyId', '==', sourceCompanyId)
    .where('recipientEmail', '==', recipientEmail)
    .limit(10)
    .get()

  const reusable = existingSnap.docs
    .map((doc) => toInvite(doc.id, doc.data() ?? {}))
    .find((row) => row.status === 'pending' && row.kind === input.kind && !isPartnerInviteExpired(row))

  if (reusable) return { invite: reusable, created: false }

  const now = FieldValue.serverTimestamp()
  const doc = stripUndefined({
    kind: input.kind,
    sourceOrgId,
    sourceCompanyId,
    sourceContactId: cleanString(input.sourceContactId) || undefined,
    recipientEmail,
    recipientName: cleanString(input.recipientName) || undefined,
    recipientCompanyName: cleanString(input.recipientCompanyName) || undefined,
    message: cleanString(input.message) || undefined,
    proposedCapabilities: input.capabilities?.length ? input.capabilities : DEFAULT_PARTNER_CAPABILITIES,
    proposedFieldSharingPolicy: input.fieldSharingPolicy ?? DEFAULT_PARTNER_FIELD_SHARING,
    inviteToken: crypto.randomBytes(24).toString('hex'),
    status: 'pending',
    expiresAt: new Date(Date.now() + PARTNER_INVITE_TTL_MS).toISOString(),
    inviterUserId: cleanString(input.inviterUserId) || undefined,
    inviterEmail: normalizeEmail(input.inviterEmail) || undefined,
    inviterName: cleanString(input.inviterName) || undefined,
    createdByRef: input.actor,
    updatedByRef: input.actor,
    createdAt: now,
    updatedAt: now,
  })

  const ref = await adminDb.collection(PARTNER_INVITE_COLLECTION).add(doc)
  const snap = await ref.get()
  const invite = toInvite(ref.id, snap.data() ?? {})

  await recordCrmAuditEvent({
    orgId: sourceOrgId,
    eventType: 'partner_link.invited',
    resourceType: 'partnerInvite',
    resourceId: ref.id,
    companyId: sourceCompanyId,
    actorRef: input.actor,
    metadata: { kind: input.kind, recipientEmail },
  })

  return { invite, created: true }
}

export async function revokePartnerInvite(input: {
  invite: PartnerInvite
  actor: MemberRef
}): Promise<void> {
  const now = FieldValue.serverTimestamp()
  await adminDb.collection(PARTNER_INVITE_COLLECTION).doc(input.invite.id).set({
    status: 'revoked',
    revokedAt: now,
    updatedByRef: input.actor,
    updatedAt: now,
  }, { merge: true })

  await recordCrmAuditEvent({
    orgId: input.invite.sourceOrgId,
    eventType: 'partner_link.revoked',
    resourceType: 'partnerInvite',
    resourceId: input.invite.id,
    companyId: input.invite.sourceCompanyId,
    actorRef: input.actor,
    metadata: { recipientEmail: input.invite.recipientEmail },
  })
}

export async function declinePartnerInvite(input: {
  invite: PartnerInvite
  actor: MemberRef
  declinedByUserId?: string
}): Promise<void> {
  const now = FieldValue.serverTimestamp()
  await adminDb.collection(PARTNER_INVITE_COLLECTION).doc(input.invite.id).set(stripUndefined({
    status: 'declined',
    declinedAt: now,
    acceptedByUserId: undefined,
    declinedByUserId: cleanString(input.declinedByUserId) || undefined,
    updatedByRef: input.actor,
    updatedAt: now,
  }), { merge: true })

  await recordCrmAuditEvent({
    orgId: input.invite.sourceOrgId,
    eventType: 'partner_link.declined',
    resourceType: 'partnerInvite',
    resourceId: input.invite.id,
    companyId: input.invite.sourceCompanyId,
    actorRef: input.actor,
    metadata: { recipientEmail: input.invite.recipientEmail },
    notification: {
      type: 'partner_link.declined',
      title: 'Partner invitation declined',
      body: `${input.invite.recipientCompanyName || input.invite.recipientEmail} declined your invitation to link workspaces.`,
      targetOrgIds: [input.invite.sourceOrgId],
    },
  })
}

/**
 * Materialize the canonical authority at the same acceptance boundary that
 * creates CRM mirrors. The mirrors remain compatibility projections only;
 * finance and cross-org policy read these records as the source of authority.
 */
async function materializeCanonicalPartnerAuthority(input: {
  partnerLinkId: string
  sourceOrgId: string
  targetOrgId: string
  sourceRelationshipId: string
  targetRelationshipId: string
  capabilities: NonNullable<CreatePartnerInviteInput['capabilities']>
  fieldSharingPolicy: NonNullable<CreatePartnerInviteInput['fieldSharingPolicy']>
  sourceAcceptedBy: MemberRef
  targetAcceptedBy: MemberRef
}): Promise<void> {
  const now = FieldValue.serverTimestamp()
  const scopeId = (grantorOrgId: string, granteeOrgId: string) =>
    `${input.partnerLinkId}:${grantorOrgId}:${granteeOrgId}`
  const scopeData = (grantorOrgId: string, granteeOrgId: string, grantorAcceptedBy: MemberRef, granteeAcceptedBy: MemberRef) => ({
    partnerLinkId: input.partnerLinkId,
    direction: { grantorOrgId, granteeOrgId },
    capabilities: input.capabilities,
    fieldSharingPolicy: input.fieldSharingPolicy,
    status: 'active',
    version: 1,
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    proposedByRef: grantorAcceptedBy,
    acceptedByRef: granteeAcceptedBy,
    acceptance: {
      grantor: { byRef: grantorAcceptedBy, at: now },
      grantee: { byRef: granteeAcceptedBy, at: now },
    },
    effectiveAt: now,
    createdAt: now,
    updatedAt: now,
  })

  await adminDb.runTransaction(async (tx) => {
    tx.set(adminDb.collection(PARTNER_LINKS_COLLECTION).doc(input.partnerLinkId), {
      partnerLinkId: input.partnerLinkId,
      orgA: input.sourceOrgId,
      orgB: input.targetOrgId,
      relationshipIdA: input.sourceRelationshipId,
      relationshipIdB: input.targetRelationshipId,
      negotiableCapabilities: input.capabilities,
      status: 'active',
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    }, { merge: true })
    tx.set(
      adminDb.collection(PARTNER_SCOPE_AGREEMENTS_COLLECTION).doc(scopeId(input.sourceOrgId, input.targetOrgId)),
      scopeData(input.sourceOrgId, input.targetOrgId, input.sourceAcceptedBy, input.targetAcceptedBy),
      { merge: true },
    )
    tx.set(
      adminDb.collection(PARTNER_SCOPE_AGREEMENTS_COLLECTION).doc(scopeId(input.targetOrgId, input.sourceOrgId)),
      scopeData(input.targetOrgId, input.sourceOrgId, input.targetAcceptedBy, input.sourceAcceptedBy),
      { merge: true },
    )
  })
}

/**
 * The accept transaction. Order matters: the mirror company must exist before
 * either relationship row is written so both carry targetCompanyId.
 *
 * These are sequential awaits rather than a Firestore transaction — the writes
 * span several collections and two tenants, matching how
 * ensurePlatformCompanyForOrg already sequences the same work.
 */
export async function acceptPartnerInvite(
  input: AcceptPartnerInviteInput,
): Promise<AcceptPartnerInviteResult> {
  const { invite, actor } = input
  const sourceOrgId = invite.sourceOrgId
  const targetOrgId = cleanString(input.targetOrgId)
  // Recipient identity is valid only when the caller explicitly confirms the
  // session matched the invite recipient. Do not trust a supplied targetUserId
  // by itself: an owner/admin approver must never become the recipient's
  // linked user merely because a caller populated that convenience field.
  const suppliedTargetUserId = cleanString(input.targetUserId)
  const recipientIdentityMatched = input.recipientIdentityMatched ?? Boolean(suppliedTargetUserId)
  const targetUserId = recipientIdentityMatched ? suppliedTargetUserId : ''
  // The approver is whoever clicked accept (recipient or an owner/admin who
  // accepted on the recipient's behalf). Recorded SEPARATELY from the
  // recipient identity: the approver never becomes the invited contact's
  // linked user unless identities match.
  const approvedByUserId = cleanString(input.approvedByUserId) || targetUserId || ''
  if (!targetOrgId) throw new Error('targetOrgId is required')
  if (targetOrgId === sourceOrgId) throw new Error('An organisation cannot link to itself')

  const partnerLinkId = invite.partnerLinkId || crypto.randomUUID()
  const capabilities = input.capabilities?.length
    ? input.capabilities
    : (invite.proposedCapabilities?.length ? invite.proposedCapabilities : DEFAULT_PARTNER_CAPABILITIES)
  const fieldSharingPolicy = input.fieldSharingPolicy
    ?? invite.proposedFieldSharingPolicy
    ?? DEFAULT_PARTNER_FIELD_SHARING
  const now = Timestamp.now()

  // --- Preflight -----------------------------------------------------------
  // Validate everything that can reject BEFORE mutating either side, so a bad
  // company pick can't leave the inviter half-linked.
  const sourceCompanySnap = await adminDb.collection('companies').doc(invite.sourceCompanyId).get()
  if (!sourceCompanySnap.exists) throw new Error('Inviting company no longer exists')
  const sourceCompanyData = sourceCompanySnap.data() ?? {}
  if (sourceCompanyData.orgId !== sourceOrgId) throw new Error('Inviting company no longer exists')
  const sourceCompanyName = cleanString(sourceCompanyData.name) || invite.recipientCompanyName || 'Partner'

  if (input.preferTargetCompanyId) {
    const preferSnap = await adminDb.collection('companies').doc(input.preferTargetCompanyId).get()
    const preferData = preferSnap.exists ? preferSnap.data() ?? {} : null
    if (!preferData || preferData.orgId !== targetOrgId || preferData.deleted === true) {
      throw new Error('Selected company not found')
    }
    const preferLink = cleanString(preferData.linkedOrgId)
    if (preferLink && preferLink !== sourceOrgId) {
      throw new Error('That company is already linked to a different organisation')
    }
  }

  // --- Inviting side -------------------------------------------------------

  await sourceCompanySnap.ref.set({
    linkedOrgId: targetOrgId,
    allowedOrgIds: [sourceOrgId, targetOrgId],
    updatedByRef: actor,
    updatedAt: now,
  }, { merge: true })

  // Stamp the contact that represents the accepting person. A contact-kind
  // invite names the record explicitly; otherwise match on email and create
  // one against the invited company when nothing matches. linkedUserId is
  // ONLY stamped when the recipient identity itself accepted — an
  // owner/admin approving on their behalf never becomes the linked user.
  let sourceContactId = cleanString(invite.sourceContactId)
  if (sourceContactId) {
    const contactSnap = await adminDb.collection('contacts').doc(sourceContactId).get()
    if (contactSnap.exists && (contactSnap.data() ?? {}).orgId === sourceOrgId) {
      const patch: Record<string, unknown> = {
        linkedOrgId: targetOrgId,
        companyId: invite.sourceCompanyId,
        companyName: sourceCompanyName,
        updatedByRef: actor,
        updatedAt: now,
      }
      if (targetUserId) patch.linkedUserId = targetUserId
      await contactSnap.ref.set(patch, { merge: true })
    } else {
      sourceContactId = ''
    }
  }
  if (!sourceContactId) {
    const mirrored = await ensureMirrorContact({
      ownerOrgId: sourceOrgId,
      companyId: invite.sourceCompanyId,
      companyName: sourceCompanyName,
      linkedUserId: targetUserId || undefined,
      linkedOrgId: targetOrgId,
      email: invite.recipientEmail,
      displayName: invite.recipientName || invite.recipientEmail,
      actor,
      tags: ['partner-contact'],
    })
    sourceContactId = mirrored?.contactId ?? ''
  }

  // --- Accepting side ------------------------------------------------------
  const mirrorCompany = await ensureMirrorCompany({
    ownerOrgId: targetOrgId,
    representsOrgId: sourceOrgId,
    preferCompanyId: input.preferTargetCompanyId,
    actor,
  })
  if (!mirrorCompany) throw new Error('Could not create the partner company in your CRM')

  let targetContactId: string | undefined
  if (invite.inviterEmail || invite.inviterUserId) {
    const mirrorContact = await ensureMirrorContact({
      ownerOrgId: targetOrgId,
      companyId: mirrorCompany.companyId,
      companyName: mirrorCompany.companyName,
      linkedUserId: invite.inviterUserId,
      linkedOrgId: sourceOrgId,
      email: invite.inviterEmail ?? '',
      displayName: invite.inviterName || invite.inviterEmail || 'Partner contact',
      actor,
      tags: ['partner-contact'],
    })
    targetContactId = mirrorContact?.contactId
  }

  // --- Relationship rows, one per side, sharing a partnerLinkId ------------
  const targetOrgSnap = await adminDb.collection('organizations').doc(targetOrgId).get()
  const targetOrgName = cleanString((targetOrgSnap.data() ?? {}).name) || invite.recipientCompanyName || targetOrgId

  const sourceRelationship = await ensureBusinessRelationship(sourceOrgId, {
    sourceCompanyId: invite.sourceCompanyId,
    sourceContactId: sourceContactId || undefined,
    targetOrgId,
    targetCompanyId: mirrorCompany.companyId,
    targetContactId,
    targetName: targetOrgName,
    relationshipType: 'partner',
    status: 'active',
    sharedCapabilities: capabilities,
    fieldSharingPolicy,
    visibility: 'relationship',
    approvalState: 'approved',
    portalVisible: true,
    allowedOrgIds: [sourceOrgId, targetOrgId],
    partnerLinkId,
    notes: 'Mutually accepted partner link.',
  }, actor, { bilateral: true })

  const targetRelationship = await ensureBusinessRelationship(targetOrgId, {
    sourceCompanyId: mirrorCompany.companyId,
    sourceContactId: targetContactId,
    targetOrgId: sourceOrgId,
    targetCompanyId: invite.sourceCompanyId,
    targetContactId: sourceContactId || undefined,
    targetName: mirrorCompany.companyName,
    relationshipType: 'partner',
    status: 'active',
    sharedCapabilities: capabilities,
    fieldSharingPolicy,
    visibility: 'relationship',
    approvalState: 'approved',
    portalVisible: true,
    allowedOrgIds: [targetOrgId, sourceOrgId],
    partnerLinkId,
    notes: 'Mutually accepted partner link.',
  }, actor, { bilateral: true })

  await materializeCanonicalPartnerAuthority({
    partnerLinkId,
    sourceOrgId,
    targetOrgId,
    sourceRelationshipId: sourceRelationship.id,
    targetRelationshipId: targetRelationship.id,
    capabilities,
    fieldSharingPolicy,
    sourceAcceptedBy: invite.createdByRef ?? actor,
    targetAcceptedBy: actor,
  })

  // --- Canonical identity links (many-to-many join rows) --------------------
  // The acceptor verifies org-level affiliation on both sides; a contact_user
  // link is created only when the recipient identity itself accepted.
  const identityPlan = planIdentityLinksForAcceptance({
    partnerLinkId,
    sourceInviteId: invite.id,
    sourceOrgId,
    sourceCompanyId: invite.sourceCompanyId,
    sourceContactId: sourceContactId || undefined,
    targetUserId: targetUserId || undefined,
    targetOrgId,
    targetCompanyId: mirrorCompany.companyId,
    targetContactId,
    inviterUserId: cleanString(invite.inviterUserId) || undefined,
    actorRef: actor,
  })
  const identityLinkIds: string[] = []
  for (const candidate of identityPlan) {
    const created = await ensureIdentityLink({
      linkType: candidate.linkType,
      sourceRef: candidate.sourceRef,
      targetRef: candidate.targetRef,
      status: candidate.status,
      partnerLinkId: candidate.partnerLinkId,
      verifiedByRef: candidate.verifiedByRef,
      verifiedAt: candidate.verifiedAt,
      provenance: candidate.provenance,
      actor,
    })
    identityLinkIds.push(created.link.id)
  }

  // --- Close out the invite ------------------------------------------------
  await adminDb.collection(PARTNER_INVITE_COLLECTION).doc(invite.id).set(stripUndefined({
    status: 'accepted',
    acceptedAt: FieldValue.serverTimestamp(),
    acceptedByUserId: approvedByUserId || undefined,
    recipientUserId: targetUserId || undefined,
    recipientIdentityMatched,
    approvedByRef: actor,
    targetOrgId,
    targetUserId: targetUserId || undefined,
    targetCompanyId: mirrorCompany.companyId,
    targetContactId,
    partnerLinkId,
    sourceRelationshipId: sourceRelationship.id,
    targetRelationshipId: targetRelationship.id,
    identityLinkIds,
    updatedByRef: actor,
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true })

  const notification = {
    type: 'partner_link.accepted',
    title: 'Partner link established',
    body: `${sourceCompanyName} and ${targetOrgName} are now linked.`,
    targetOrgIds: [sourceOrgId, targetOrgId],
  }

  await recordCrmAuditEvent({
    orgId: sourceOrgId,
    eventType: 'partner_link.accepted',
    resourceType: 'partnerInvite',
    resourceId: invite.id,
    companyId: invite.sourceCompanyId,
    relationshipId: sourceRelationship.id,
    actorRef: actor,
    metadata: {
      partnerLinkId,
      targetOrgId,
      targetUserId: targetUserId || undefined,
      approvedByUserId: approvedByUserId || undefined,
      recipientIdentityMatched,
      identityLinkIds,
    },
    notification,
  })
  await recordCrmAuditEvent({
    orgId: targetOrgId,
    eventType: 'partner_link.accepted',
    resourceType: 'partnerInvite',
    resourceId: invite.id,
    companyId: mirrorCompany.companyId,
    relationshipId: targetRelationship.id,
    actorRef: actor,
    metadata: {
      partnerLinkId,
      sourceOrgId,
      recipientIdentityMatched,
      identityLinkIds,
    },
    notification,
  })

  return {
    partnerLinkId,
    sourceRelationshipId: sourceRelationship.id,
    targetRelationshipId: targetRelationship.id,
    targetOrgId,
    targetUserId: targetUserId || undefined,
    approvedByUserId: approvedByUserId || undefined,
    recipientIdentityMatched,
    identityLinkIds,
    targetCompanyId: mirrorCompany.companyId,
    targetContactId,
    sourceContactId: sourceContactId || undefined,
  }
}

/**
 * Either side may sever the link. Both relationship rows go `revoked`, both
 * companies lose linkedOrgId, and contacts pointing across the boundary lose
 * their user/org links. The CRM records themselves survive.
 */
export async function unlinkPartnership(
  input: UnlinkPartnershipInput,
): Promise<UnlinkPartnershipResult> {
  const ref = adminDb.collection(RELATIONSHIP_COLLECTION).doc(input.relationshipId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Relationship not found')
  const relationship: BusinessRelationship = { ...(snap.data() as BusinessRelationship), id: snap.id }
  if (relationship.sourceOrgId !== input.actingOrgId) throw new Error('Relationship not found')

  const partnerLinkId = cleanString(relationship.partnerLinkId)
  const counterparts: BusinessRelationship[] = []
  if (partnerLinkId) {
    const linked = await adminDb
      .collection(RELATIONSHIP_COLLECTION)
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(10)
      .get()
    for (const doc of linked.docs) {
      if (doc.id === relationship.id) continue
      counterparts.push({ ...(doc.data() as BusinessRelationship), id: doc.id })
    }
  }

  const all = [relationship, ...counterparts]

  // Tear down active commerce while the bilateral link is still valid. Order
  // cancellation itself performs the transaction/liveness checks and releases
  // confirmed stock reservations; revoking first would strand that inventory.
  const { cancelledOrderIds, releasedInventoryIds } = await cancelOpenOrdersForPartnerLink({
    partnerLinkId,
    actor: input.actor,
  })

  const revokedRelationshipIds: string[] = []
  for (const row of all) {
    await updateBusinessRelationship(row.sourceOrgId, row.id, { status: 'revoked' }, input.actor)
    revokedRelationshipIds.push(row.id)
  }

  // Per-record shares and partner project access both ride on the link;
  // severing it must kill them too, or access outlives the relationship.
  const revokedShareIds = await revokeSharesForPartnerLink({
    partnerLinkId,
    actor: input.actor,
  })
  const revokedProjectAccessIds = await revokeProjectAccessForPartnerLink({
    partnerLinkId,
    actor: input.actor,
  })

  // Canonical identity links derived from this partner link are revoked too.
  const identityRevoked = await revokeIdentityLinksForPartnerLink(partnerLinkId, input.actor)
  const revokedIdentityLinkIds = identityRevoked.revokedIds

  const otherOrgId = cleanString(relationship.targetOrgId)
  const orgPairs: Array<{ orgId: string; partnerOrgId: string }> = []
  if (otherOrgId) {
    orgPairs.push({ orgId: input.actingOrgId, partnerOrgId: otherOrgId })
    orgPairs.push({ orgId: otherOrgId, partnerOrgId: input.actingOrgId })
  }

  const now = Timestamp.now()
  const clearedCompanyIds: string[] = []
  const clearedContactIds: string[] = []

  for (const pair of orgPairs) {
    const companies = await adminDb.collection('companies')
      .where('orgId', '==', pair.orgId)
      .limit(1000)
      .get()
    for (const doc of companies.docs) {
      if (cleanString((doc.data() ?? {}).linkedOrgId) !== pair.partnerOrgId) continue
      await doc.ref.set({
        linkedOrgId: FieldValue.delete(),
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      clearedCompanyIds.push(doc.id)
    }

    const contacts = await adminDb.collection('contacts')
      .where('orgId', '==', pair.orgId)
      .limit(1000)
      .get()
    for (const doc of contacts.docs) {
      if (cleanString((doc.data() ?? {}).linkedOrgId) !== pair.partnerOrgId) continue
      await doc.ref.set({
        linkedOrgId: FieldValue.delete(),
        linkedUserId: FieldValue.delete(),
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      clearedContactIds.push(doc.id)
    }
  }

  // After the legacy pointer sweep, recompute primary convenience pointers for
  // every CRM row whose canonical identity links were just revoked, so a
  // remaining many-to-many link (holding company / multi-client contact)
  // becomes the new primary instead of leaving a stale pointer.
  for (const companyId of identityRevoked.affectedCompanyIds) {
    await resyncPointersForSource({ kind: 'company', id: companyId })
  }
  for (const contactId of identityRevoked.affectedContactIds) {
    await resyncPointersForSource({ kind: 'contact', id: contactId })
  }

  const notification = {
    type: 'partner_link.unlinked',
    title: 'Partner link removed',
    body: 'A partner workspace link was removed. Shared records are no longer visible across the two workspaces.',
    targetOrgIds: [input.actingOrgId, otherOrgId].filter(Boolean),
  }
  for (const row of all) {
    await recordCrmAuditEvent({
      orgId: row.sourceOrgId,
      eventType: 'partner_link.unlinked',
      resourceType: 'businessRelationship',
      resourceId: row.id,
      companyId: row.sourceCompanyId,
      relationshipId: row.id,
      actorRef: input.actor,
      metadata: { partnerLinkId, unlinkedBy: input.actingOrgId, revokedIdentityLinkIds },
      notification,
    })
  }

  return {
    partnerLinkId: partnerLinkId || undefined,
    revokedRelationshipIds,
    revokedShareIds,
    revokedProjectAccessIds,
    revokedIdentityLinkIds,
    cancelledOrderIds,
    releasedInventoryIds,
    clearedCompanyIds,
    clearedContactIds,
  }
}
