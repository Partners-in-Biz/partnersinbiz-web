import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import {
  normalizeProjectRole,
  canProjectRole,
  projectMemberDocId,
  projectOrganizationDocId,
  type ProjectMemberRole,
} from '@/lib/projects/collaboration'
import type { BusinessRelationship, SharedBusinessCapability } from '@/lib/business-relationships/types'
import { cleanString } from './identity'
import { loadLiveBilateralLink } from './link-evidence'
import {
  CROSS_ORG_SCHEMA_VERSION,
  PARTNER_RESOURCE_GRANTS_COLLECTION,
  PARTNER_SCOPE_AGREEMENTS_COLLECTION,
  type PartnerLink,
  type PartnerScopeAgreement,
} from '@/lib/cross-org/types'
import { hasBilateralAcceptance } from '@/lib/cross-org/lifecycle'

/**
 * Collaboration on top of an accepted partner link, beyond record sharing and
 * trading:
 *   - granting a partner org access to a whole project
 *   - a conversation thread scoped to the relationship itself
 *   - a per-partner overview
 *
 * Project access deliberately reuses `projectOrganizations`, the same table the
 * invoice/project claim flow writes, so partner-granted access is indis-
 * tinguishable to `resolveProjectAccess` and every existing permission check
 * keeps working untouched.
 */

export const PARTNER_THREAD_COLLECTION = 'partner_link_messages'
export const PROJECT_ORGS_COLLECTION = 'projectOrganizations'

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

function timeValue(value: unknown): number {
  if (!value) return 0
  const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  const seconds = ts.seconds ?? ts._seconds
  return typeof seconds === 'number' ? seconds * 1000 : 0
}

/**
 * Loads the caller's own side of an accepted partner link and proves the
 * counterpart row is live too (accepted bilateral Partner Link evidence).
 * A unilateral relationship row grants no resource access.
 */
async function loadActiveLink(relationshipId: string, ownerOrgId: string): Promise<BusinessRelationship> {
  const { link } = await loadLiveBilateralLink(relationshipId, ownerOrgId)
  return link
}

function requireCapability(link: BusinessRelationship, capability: SharedBusinessCapability): void {
  if (!link.sharedCapabilities?.includes(capability)) {
    throw new Error(`This partner link does not share "${capability}". Enable it on the Partners page first.`)
  }
}

function projectGrantActions(role: ProjectMemberRole): Array<'project.read' | 'project.write'> {
  return role === 'contributor' ? ['project.read', 'project.write'] : ['project.read']
}

function cleanUniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(cleanString).filter(Boolean))]
}

async function requireActiveProjectScope(input: {
  partnerLinkId: string
  ownerOrgId: string
  partnerOrgId: string
}): Promise<PartnerScopeAgreement> {
  const canonicalLinkSnap = await adminDb.collection('partnerLinks').doc(input.partnerLinkId).get()
  const canonicalLink = canonicalLinkSnap.data() as PartnerLink | undefined
  if (!canonicalLinkSnap.exists || canonicalLink?.status !== 'active'
    || ![canonicalLink.orgA, canonicalLink.orgB].includes(input.ownerOrgId)
    || ![canonicalLink.orgA, canonicalLink.orgB].includes(input.partnerOrgId)) {
    throw new Error('An active canonical Partner Link is required before sharing a project')
  }

  const scopes = await adminDb.collection(PARTNER_SCOPE_AGREEMENTS_COLLECTION)
    .where('partnerLinkId', '==', input.partnerLinkId)
    .limit(50)
    .get()
  const scope = scopes.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerScopeAgreement)
    .find((candidate) => candidate.status === 'active'
      && candidate.direction?.grantorOrgId === input.ownerOrgId
      && candidate.direction?.granteeOrgId === input.partnerOrgId
      && candidate.capabilities?.includes('projects')
      && hasBilateralAcceptance(candidate))
  if (!scope) {
    throw new Error('An active bilaterally accepted project scope agreement is required before sharing a project')
  }
  return scope
}

// ── Project access ───────────────────────────────────────────────────────────

export interface PartnerProjectAccess {
  id: string
  projectId: string
  projectName?: string
  orgId: string
  role: ProjectMemberRole
  status: string
  partnerLinkId?: string
  ownerOrgId?: string
  createdAt?: unknown
}

/**
 * Give the partner org access to one of your projects. Their members then see
 * it through the normal project permission path — no separate surface.
 */
export async function grantPartnerProjectAccess(input: {
  ownerOrgId: string
  relationshipId: string
  projectId: string
  role?: string
  grantee?: {
    includePartnerOrganization?: boolean
    userIds?: string[]
    teamIds?: string[]
  }
  actor: MemberRef
}): Promise<PartnerProjectAccess> {
  const link = await loadActiveLink(input.relationshipId, input.ownerOrgId)
  requireCapability(link, 'projects')
  const partnerOrgId = cleanString(link.targetOrgId)
  const partnerLinkId = cleanString(link.partnerLinkId)
  if (!partnerOrgId || !partnerLinkId) throw new Error('An accepted Partner Link is required before sharing a project')
  const scopeAgreement = await requireActiveProjectScope({
    partnerLinkId,
    ownerOrgId: input.ownerOrgId,
    partnerOrgId,
  })

  const projectSnap = await adminDb.collection('projects').doc(input.projectId).get()
  if (!projectSnap.exists) throw new Error('Project not found')
  const project = projectSnap.data() ?? {}
  const projectOwnerOrgId = cleanString(project.ownerOrgId) || cleanString(project.sourceOrgId) || cleanString(project.orgId)
  if (projectOwnerOrgId !== input.ownerOrgId || project.deleted === true) throw new Error('Project not found')
  const managerSnap = await adminDb.collection('projectMembers').doc(projectMemberDocId(input.projectId, input.actor.uid)).get()
  const manager = managerSnap.data() ?? {}
  if (!managerSnap.exists || manager.status !== 'active' || cleanString(manager.orgId) !== input.ownerOrgId
    || !canProjectRole(manager.role, 'manage_access')) {
    throw new Error('Active project manager access is required before sharing a project')
  }

  // Partners are never given owner/manager rights over someone else's project.
  const requested = normalizeProjectRole(input.role)
  const role: ProjectMemberRole = (requested === 'owner' || requested === 'manager') ? 'contributor' : requested
  const granteeUserIds = cleanUniqueIds(input.grantee?.userIds)
  const granteeTeamIds = cleanUniqueIds(input.grantee?.teamIds)
  const includePartnerOrganization = input.grantee?.includePartnerOrganization !== false
  if (!includePartnerOrganization && granteeUserIds.length === 0 && granteeTeamIds.length === 0) {
    throw new Error('A named user or team recipient is required when organisation-wide access is disabled')
  }

  const docId = projectOrganizationDocId(input.projectId, partnerOrgId)
  const grantId = `${input.projectId}_${partnerOrgId}`
  const now = FieldValue.serverTimestamp()
  const grantRef = adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(grantId)
  const projectionRef = adminDb.collection(PROJECT_ORGS_COLLECTION).doc(docId)
  const grantData = stripUndefined({
    ownerOrgId: input.ownerOrgId,
    resourceType: 'project',
    resourceId: input.projectId,
    partnerLinkId,
    scopeAgreementId: scopeAgreement.id,
    grantee: {
      orgIds: includePartnerOrganization ? [partnerOrgId] : [],
      userIds: granteeUserIds,
      teamIds: granteeTeamIds,
    },
    role,
    actions: projectGrantActions(role),
    status: 'active',
    provenance: { sourceShareId: docId },
    approvalBasis: { type: 'scope_agreement', refId: scopeAgreement.id },
    createdByRef: input.actor,
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  })
  const projectionData = stripUndefined({
    projectId: input.projectId,
    orgId: partnerOrgId,
    ownerOrgId: input.ownerOrgId,
    role,
    status: 'active',
    partnerLinkId,
    scopeAgreementId: scopeAgreement.id,
    relationshipId: input.relationshipId,
    projectName: cleanString(project.name) || undefined,
    grantedByRef: input.actor,
    updatedAt: now,
    createdAt: now,
  })
  // The grant and listing projection have one lifecycle. A transaction prevents
  // partial materialisation that could otherwise leave stale grant authority.
  await adminDb.runTransaction(async (tx) => {
    tx.set(grantRef, grantData, { merge: true })
    tx.set(projectionRef, projectionData, { merge: true })
  })

  await recordCrmAuditEvent({
    orgId: input.ownerOrgId,
    eventType: 'partner_project.granted',
    resourceType: 'project',
    resourceId: input.projectId,
    relationshipId: input.relationshipId,
    actorRef: input.actor,
    metadata: { partnerOrgId, role },
    notification: {
      type: 'partner_project.granted',
      title: 'A partner shared a project with you',
      body: `You now have ${role} access to "${cleanString(project.name) || 'a project'}".`,
      targetOrgIds: [partnerOrgId],
    },
  })

  return {
    id: docId,
    projectId: input.projectId,
    projectName: cleanString(project.name) || undefined,
    orgId: partnerOrgId,
    role,
    status: 'active',
    partnerLinkId,
    ownerOrgId: input.ownerOrgId,
  }
}

export async function revokePartnerProjectAccess(input: {
  ownerOrgId: string
  projectId: string
  partnerOrgId: string
  actor: MemberRef
}): Promise<void> {
  const docId = projectOrganizationDocId(input.projectId, input.partnerOrgId)
  const ref = adminDb.collection(PROJECT_ORGS_COLLECTION).doc(docId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Project access not found')
  const row = snap.data() ?? {}
  const projectSnap = await adminDb.collection('projects').doc(input.projectId).get()
  const project = projectSnap.data() ?? {}
  const projectOwnerOrgId = cleanString(project.ownerOrgId) || cleanString(project.sourceOrgId) || cleanString(project.orgId)
  if (!projectSnap.exists || projectOwnerOrgId !== input.ownerOrgId || cleanString(row.ownerOrgId) !== input.ownerOrgId) {
    throw new Error('Project access not found')
  }
  const managerSnap = await adminDb.collection('projectMembers').doc(projectMemberDocId(input.projectId, input.actor.uid)).get()
  const manager = managerSnap.data() ?? {}
  if (!managerSnap.exists || manager.status !== 'active' || cleanString(manager.orgId) !== input.ownerOrgId
    || !canProjectRole(manager.role, 'manage_access')) {
    throw new Error('Active project manager access is required before revoking project sharing')
  }

  const now = FieldValue.serverTimestamp()
  const grantRef = adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(`${input.projectId}_${input.partnerOrgId}`)
  const revocation = { status: 'revoked', revokedAt: now, revokedByRef: input.actor, updatedAt: now }
  await adminDb.runTransaction(async (tx) => {
    tx.set(ref, revocation, { merge: true })
    tx.set(grantRef, revocation, { merge: true })
  })

  await recordCrmAuditEvent({
    orgId: input.ownerOrgId,
    eventType: 'partner_project.revoked',
    resourceType: 'project',
    resourceId: input.projectId,
    actorRef: input.actor,
    metadata: { partnerOrgId: input.partnerOrgId },
    notification: {
      type: 'partner_project.revoked',
      title: 'Project access removed',
      body: 'A partner removed your access to one of their projects.',
      targetOrgIds: [input.partnerOrgId],
    },
  })
}

/** Projects this org has shared out, and projects partners shared with it. */
export async function listPartnerProjects(orgId: string): Promise<{
  sharedOut: PartnerProjectAccess[]
  sharedWithMe: PartnerProjectAccess[]
}> {
  const [outSnap, inSnap] = await Promise.all([
    adminDb.collection(PROJECT_ORGS_COLLECTION).where('ownerOrgId', '==', orgId).limit(1000).get(),
    adminDb.collection(PROJECT_ORGS_COLLECTION).where('orgId', '==', orgId).limit(1000).get(),
  ])

  const map = (docs: FirebaseFirestore.QueryDocumentSnapshot[]): PartnerProjectAccess[] => docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerProjectAccess, 'id'>) }))
    .filter((r) => r.status === 'active' && cleanString(r.partnerLinkId))

  return {
    sharedOut: map(outSnap.docs),
    // Exclude our own grants showing up as inbound when both fields match.
    sharedWithMe: map(inSnap.docs).filter((r) => cleanString(r.ownerOrgId) !== orgId),
  }
}

/** Called on unlink — partner project access must not outlive the link. */
export async function revokeProjectAccessForPartnerLink(input: {
  partnerLinkId: string
  actor: MemberRef
}): Promise<string[]> {
  if (!input.partnerLinkId) return []
  const [projectionSnap, grantSnap] = await Promise.all([
    adminDb.collection(PROJECT_ORGS_COLLECTION).where('partnerLinkId', '==', input.partnerLinkId).limit(1000).get(),
    adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).where('partnerLinkId', '==', input.partnerLinkId).limit(1000).get(),
  ])

  const now = FieldValue.serverTimestamp()
  const revoked = new Set<string>()
  await Promise.all([
    ...projectionSnap.docs.map(async (doc) => {
      if ((doc.data() ?? {}).status !== 'active') return
      await doc.ref.set({ status: 'revoked', revokedAt: now, revokedByRef: input.actor, updatedAt: now }, { merge: true })
      revoked.add(doc.id)
    }),
    ...grantSnap.docs.map(async (doc) => {
      const data = doc.data() ?? {}
      if (data.resourceType !== 'project' || data.status !== 'active') return
      await doc.ref.set({ status: 'revoked', revokedAt: now, revokedByRef: input.actor, updatedAt: now }, { merge: true })
      revoked.add(doc.id)
    }),
  ])
  return Array.from(revoked)
}

// ── Relationship conversation ────────────────────────────────────────────────

export interface PartnerMessage {
  id: string
  partnerLinkId: string
  authorOrgId: string
  authorRef?: MemberRef
  body: string
  createdAt?: unknown
  deleted?: boolean
}

/**
 * A thread on the relationship itself, distinct from the per-record comments in
 * shares.ts. Readable and writable by either side while the link is active.
 */
async function resolveLinkAccess(relationshipId: string, orgId: string): Promise<BusinessRelationship> {
  return loadActiveLink(relationshipId, orgId)
}

export async function listPartnerMessages(input: {
  relationshipId: string
  orgId: string
}): Promise<{ messages: PartnerMessage[]; partnerLinkId: string }> {
  const link = await resolveLinkAccess(input.relationshipId, input.orgId)
  const partnerLinkId = cleanString(link.partnerLinkId)

  const snap = await adminDb
    .collection(PARTNER_THREAD_COLLECTION)
    .where('partnerLinkId', '==', partnerLinkId)
    .limit(500)
    .get()

  const messages = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerMessage, 'id'>) }))
    .filter((m) => m.deleted !== true)
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))

  return { messages, partnerLinkId }
}

export async function postPartnerMessage(input: {
  relationshipId: string
  orgId: string
  body: string
  actor: MemberRef
}): Promise<PartnerMessage> {
  const link = await resolveLinkAccess(input.relationshipId, input.orgId)
  const body = input.body.trim()
  if (!body) throw new Error('Message cannot be empty')
  if (body.length > 5000) throw new Error('Message is too long (max 5000 characters)')

  const partnerLinkId = cleanString(link.partnerLinkId)
  const partnerOrgId = cleanString(link.targetOrgId)
  const now = FieldValue.serverTimestamp()

  const ref = await adminDb.collection(PARTNER_THREAD_COLLECTION).add(stripUndefined({
    partnerLinkId,
    authorOrgId: input.orgId,
    authorRef: input.actor,
    body,
    createdAt: now,
    deleted: false,
  }))

  await recordCrmAuditEvent({
    orgId: input.orgId,
    eventType: 'partner_link.message',
    resourceType: 'businessRelationship',
    resourceId: input.relationshipId,
    relationshipId: input.relationshipId,
    actorRef: input.actor,
    metadata: { partnerLinkId, messageId: ref.id },
    notification: {
      type: 'partner_link.message',
      title: 'New message from a partner',
      body: `${input.actor.displayName}: ${body.slice(0, 140)}${body.length > 140 ? '…' : ''}`,
      targetOrgIds: [partnerOrgId],
    },
  })

  const saved = await ref.get()
  return { id: ref.id, ...(saved.data() as Omit<PartnerMessage, 'id'>) }
}

// ── Per-partner overview ─────────────────────────────────────────────────────

export interface PartnerOverview {
  relationshipId: string
  partnerOrgId: string
  partnerOrgName: string
  companyId?: string
  companyName?: string
  sharedCapabilities: string[]
  status: string
  counts: {
    sharedOut: number
    sharedWithMe: number
    projectsSharedOut: number
    projectsSharedWithMe: number
    catalogItems: number
    ordersPlaced: number
    ordersReceived: number
    openOrders: number
    messages: number
  }
  tradeValue: { placed: number; received: number; currency: string }
  recentMessages: PartnerMessage[]
}

/**
 * Everything about one relationship on a single page. All reads are scoped to
 * the caller's own tenant — the counterpart's private totals never appear.
 */
export async function loadPartnerOverview(input: {
  orgId: string
  relationshipId: string
}): Promise<PartnerOverview> {
  const link = await loadActiveLink(input.relationshipId, input.orgId)
  const partnerOrgId = cleanString(link.targetOrgId)
  const partnerLinkId = cleanString(link.partnerLinkId)

  const [orgSnap, sharesSnap, projects, catalogSnap, ordersSnap, thread] = await Promise.all([
    adminDb.collection('organizations').doc(partnerOrgId).get(),
    adminDb.collection('partner_record_shares').where('partnerLinkId', '==', partnerLinkId).limit(1000).get(),
    listPartnerProjects(input.orgId),
    adminDb.collection('partner_catalog_items')
      .where('supplierOrgId', '==', input.orgId)
      .where('buyerOrgId', '==', partnerOrgId)
      .limit(1000).get(),
    adminDb.collection('orders').where('orgId', '==', input.orgId).limit(1000).get(),
    listPartnerMessages({ relationshipId: input.relationshipId, orgId: input.orgId }),
  ])

  const shares = sharesSnap.docs.map((d) => d.data() ?? {}).filter((s) => s.status === 'active')
  const orders = ordersSnap.docs
    .map((d) => d.data() ?? {})
    .filter((o) => o.deleted !== true && cleanString(o.partnerLinkId) === partnerLinkId)

  const placed = orders.filter((o) => o.direction === 'purchase')
  const received = orders.filter((o) => o.direction === 'sales')
  const sum = (rows: Array<Record<string, unknown>>) =>
    rows.filter((o) => o.partnerOrderStatus === 'confirmed')
      .reduce((s, o) => s + (Number(o.total) || 0), 0)

  return {
    relationshipId: input.relationshipId,
    partnerOrgId,
    partnerOrgName: cleanString((orgSnap.data() ?? {}).name) || partnerOrgId,
    companyId: cleanString(link.sourceCompanyId) || undefined,
    companyName: cleanString(link.targetName) || undefined,
    sharedCapabilities: link.sharedCapabilities ?? [],
    status: link.status,
    counts: {
      sharedOut: shares.filter((s) => s.ownerOrgId === input.orgId).length,
      sharedWithMe: shares.filter((s) => s.partnerOrgId === input.orgId).length,
      projectsSharedOut: projects.sharedOut.filter((p) => p.orgId === partnerOrgId).length,
      projectsSharedWithMe: projects.sharedWithMe.filter((p) => cleanString(p.ownerOrgId) === partnerOrgId).length,
      catalogItems: catalogSnap.docs.filter((d) => (d.data() ?? {}).deleted !== true).length,
      ordersPlaced: placed.length,
      ordersReceived: received.length,
      openOrders: orders.filter((o) => o.partnerOrderStatus === 'pending').length,
      messages: thread.messages.length,
    },
    tradeValue: {
      placed: sum(placed),
      received: sum(received),
      currency: cleanString(orders[0]?.currency) || 'ZAR',
    },
    recentMessages: thread.messages.slice(-5),
  }
}
