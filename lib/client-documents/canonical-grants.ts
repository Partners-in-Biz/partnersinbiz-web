import * as crypto from 'node:crypto'

import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { resolveMemberRef, type MemberRef } from '@/lib/orgMembers/memberRef'
import { PARTNER_RESOURCE_GRANTS_COLLECTION, type PartnerLink, type PartnerResourceGrant, type PartnerScopeAgreement } from '@/lib/cross-org/types'
import type { ClientDocument, DocumentUserShare } from './types'
import { allowedRecipientOrgIds } from './grants'

const DOCUMENT_PUBLISH_SOURCE_PREFIX = 'document-publish:'
const DOCUMENT_USER_SHARE_SOURCE_PREFIX = 'document-user-share:'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nowIso() {
  return new Date().toISOString()
}

function stableGrantId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)
  return `${prefix}:${hash}`
}

function linkedRecipientOrgIds(document: Pick<ClientDocument, 'orgId' | 'linked'>): string[] {
  const ids = new Set<string>()
  const holderOrgId = cleanString(document.orgId)
  const clientOrgId = cleanString(document.linked?.clientOrgId)
  if (clientOrgId && clientOrgId !== holderOrgId) ids.add(clientOrgId)
  for (const candidate of document.linked?.clientOrgIds ?? []) {
    const orgId = cleanString(candidate)
    if (orgId && orgId !== holderOrgId) ids.add(orgId)
  }
  return Array.from(ids)
}

function isActiveShare(share: DocumentUserShare, document: Pick<ClientDocument, 'orgId' | 'linked' | 'userShares'>): boolean {
  if (!share || share.status !== 'active') return false
  if (share.expiresAt) {
    const expiry = Date.parse(share.expiresAt)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return false
  }
  const recipientOrgId = cleanString(share.recipientOrgId)
  if (!recipientOrgId) return false
  return allowedRecipientOrgIds(document).includes(recipientOrgId)
}

async function activePartnerLinkBetweenOrgs(ownerOrgId: string, recipientOrgId: string): Promise<PartnerLink | null> {
  if (!ownerOrgId || !recipientOrgId || ownerOrgId === recipientOrgId) return null
  const [asA, asB] = await Promise.all([
    adminDb.collection('partnerLinks').where('orgA', '==', ownerOrgId).limit(50).get(),
    adminDb.collection('partnerLinks').where('orgB', '==', ownerOrgId).limit(50).get(),
  ])
  const links = [...asA.docs, ...asB.docs]
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerLink)
    .filter((link) => link.status === 'active')
  return links.find((link) => {
    return (link.orgA === ownerOrgId && link.orgB === recipientOrgId)
      || (link.orgA === recipientOrgId && link.orgB === ownerOrgId)
  }) ?? null
}

async function activeDocumentScopeAgreement(partnerLinkId: string, recipientOrgId: string): Promise<PartnerScopeAgreement | null> {
  const snap = await adminDb
    .collection('partnerScopeAgreements')
    .where('partnerLinkId', '==', partnerLinkId)
    .limit(50)
    .get()
  const matches = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerScopeAgreement)
    .filter((agreement) => (
      agreement.status === 'active'
      && agreement.direction?.granteeOrgId === recipientOrgId
      && Array.isArray(agreement.capabilities)
      && agreement.capabilities.includes('documents')
    ))
    .sort((left, right) => (right.version ?? 0) - (left.version ?? 0))
  return matches[0] ?? null
}

async function actorRefFor(ownerOrgId: string, user: ApiUser): Promise<MemberRef> {
  try {
    return await resolveMemberRef(ownerOrgId, user.uid)
  } catch {
    return { uid: user.uid, displayName: user.uid, kind: 'human' }
  }
}

function orgGrantSourceId(documentId: string, recipientOrgId: string): string {
  return `${DOCUMENT_PUBLISH_SOURCE_PREFIX}${documentId}:${recipientOrgId}`
}

function userShareGrantSourceId(documentId: string, recipientOrgId: string, userId: string): string {
  return `${DOCUMENT_USER_SHARE_SOURCE_PREFIX}${documentId}:${recipientOrgId}:${userId}`
}

function publishedGrantActions(document: Pick<ClientDocument, 'approvalMode' | 'clientPermissions'>): string[] {
  const actions = new Set<string>(['document.read', 'document.version.read', 'document.download'])
  if (document.clientPermissions?.canComment) actions.add('document.comment')
  if (document.clientPermissions?.canSuggest) actions.add('document.suggest')
  if (document.clientPermissions?.canApprove) {
    actions.add('document.approve')
    if (document.approvalMode === 'formal_acceptance') actions.add('document.accept')
  }
  return Array.from(actions)
}

function userShareGrantActions(share: DocumentUserShare): string[] {
  const permissions = share.permissions ?? {
    canView: true,
    canComment: false,
    canSuggest: false,
    canViewVersions: true,
    canViewAttachments: true,
    canApprove: false,
  }
  const actions = new Set<string>()
  if (permissions.canView !== false) actions.add('document.read')
  if (permissions.canViewVersions !== false) actions.add('document.version.read')
  if (permissions.canViewAttachments !== false) actions.add('document.download')
  if (permissions.canComment === true) actions.add('document.comment')
  if (permissions.canSuggest === true) actions.add('document.suggest')
  if (permissions.canApprove === true) {
    actions.add('document.approve')
    actions.add('document.accept')
  }
  return Array.from(actions)
}

async function revokeGrant(grant: PartnerResourceGrant, actorRef: MemberRef, reason: string) {
  await adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(grant.id).set({
    status: 'revoked',
    revokedAt: nowIso(),
    revokedByRef: actorRef,
    revokeReason: reason,
    updatedAt: nowIso(),
    schemaVersion: 1,
  }, { merge: true })
}

async function existingDocumentGrants(documentId: string): Promise<PartnerResourceGrant[]> {
  const snap = await adminDb
    .collection(PARTNER_RESOURCE_GRANTS_COLLECTION)
    .where('resourceId', '==', documentId)
    .limit(100)
    .get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerResourceGrant)
    .filter((grant) => grant.resourceType === 'document')
}

export async function syncPublishedDocumentGrants(document: ClientDocument, user: ApiUser): Promise<void> {
  const ownerOrgId = cleanString(document.orgId)
  if (!ownerOrgId) return
  const recipientOrgIds = linkedRecipientOrgIds(document)
  if (recipientOrgIds.length === 0) return

  const actorRef = await actorRefFor(ownerOrgId, user)
  const existing = await existingDocumentGrants(document.id)
  const existingPublishGrants = existing.filter((grant) => cleanString(grant.provenance?.sourceShareId).startsWith(DOCUMENT_PUBLISH_SOURCE_PREFIX))
  const desiredSourceIds = new Set<string>()

  for (const recipientOrgId of recipientOrgIds) {
    const partnerLink = await activePartnerLinkBetweenOrgs(ownerOrgId, recipientOrgId)
    if (!partnerLink) {
      throw new Error(`Active partner link required before publishing to ${recipientOrgId}`)
    }
    const scopeAgreement = await activeDocumentScopeAgreement(partnerLink.partnerLinkId, recipientOrgId)
    if (!scopeAgreement) {
      throw new Error(`Active documents scope agreement required before publishing to ${recipientOrgId}`)
    }
    const sourceShareId = orgGrantSourceId(document.id, recipientOrgId)
    desiredSourceIds.add(sourceShareId)
    const grantId = stableGrantId('doc-org', [document.id, recipientOrgId])
    await adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(grantId).set({
      id: grantId,
      partnerLinkId: partnerLink.partnerLinkId,
      scopeAgreementId: scopeAgreement.id,
      ownerOrgId,
      resourceType: 'document',
      resourceId: document.id,
      grantee: { orgIds: [recipientOrgId], userIds: [], teamIds: [] },
      role: document.clientPermissions?.canApprove ? 'approver' : document.clientPermissions?.canSuggest ? 'reviewer' : 'viewer',
      actions: publishedGrantActions(document),
      status: 'active',
      provenance: { sourceShareId },
      approvalBasis: { type: 'scope_agreement', refId: scopeAgreement.id },
      createdByRef: actorRef,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 1,
    }, { merge: true })
  }

  for (const grant of existingPublishGrants) {
    const sourceShareId = cleanString(grant.provenance?.sourceShareId)
    if (sourceShareId && !desiredSourceIds.has(sourceShareId) && grant.status !== 'revoked') {
      await revokeGrant(grant, actorRef, 'document recipient relationship removed')
    }
  }
}

export async function syncUserShareDocumentGrants(document: ClientDocument, user: ApiUser): Promise<void> {
  const ownerOrgId = cleanString(document.orgId)
  if (!ownerOrgId) return
  const actorRef = await actorRefFor(ownerOrgId, user)
  const existing = await existingDocumentGrants(document.id)
  const existingUserShareGrants = existing.filter((grant) => cleanString(grant.provenance?.sourceShareId).startsWith(DOCUMENT_USER_SHARE_SOURCE_PREFIX))
  const desiredSourceIds = new Set<string>()
  const shares = Array.isArray(document.userShares) ? document.userShares : []

  for (const share of shares) {
    if (!isActiveShare(share, document)) continue
    const recipientOrgId = cleanString(share.recipientOrgId)
    if (!recipientOrgId || recipientOrgId === ownerOrgId) continue
    const partnerLink = await activePartnerLinkBetweenOrgs(ownerOrgId, recipientOrgId)
    if (!partnerLink) {
      throw new Error(`Active partner link required before sharing this document with ${recipientOrgId}`)
    }
    const scopeAgreement = await activeDocumentScopeAgreement(partnerLink.partnerLinkId, recipientOrgId)
    if (!scopeAgreement) {
      throw new Error(`Active documents scope agreement required before sharing this document with ${recipientOrgId}`)
    }
    const sourceShareId = userShareGrantSourceId(document.id, recipientOrgId, share.userId)
    desiredSourceIds.add(sourceShareId)
    const grantId = stableGrantId('doc-user', [document.id, recipientOrgId, share.userId])
    await adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(grantId).set({
      id: grantId,
      partnerLinkId: partnerLink.partnerLinkId,
      scopeAgreementId: scopeAgreement.id,
      ownerOrgId,
      resourceType: 'document',
      resourceId: document.id,
      grantee: { orgIds: [], userIds: [share.userId], teamIds: [] },
      role: share.permissions?.canApprove ? 'approver' : share.permissions?.canSuggest ? 'reviewer' : 'viewer',
      actions: userShareGrantActions(share),
      status: 'active',
      ...(share.expiresAt ? { expiresAt: share.expiresAt } : {}),
      provenance: { sourceShareId },
      approvalBasis: { type: 'scope_agreement', refId: scopeAgreement.id },
      createdByRef: actorRef,
      createdAt: share.grantedAt || nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 1,
    }, { merge: true })
  }

  for (const grant of existingUserShareGrants) {
    const sourceShareId = cleanString(grant.provenance?.sourceShareId)
    if (sourceShareId && !desiredSourceIds.has(sourceShareId) && grant.status !== 'revoked') {
      await revokeGrant(grant, actorRef, 'document named-user share revoked or no longer eligible')
    }
  }
}

export async function findDocumentPartnerLinkId(ownerOrgId: string, recipientOrgId: string): Promise<string | null> {
  const link = await activePartnerLinkBetweenOrgs(ownerOrgId, recipientOrgId)
  return link?.partnerLinkId ?? null
}
