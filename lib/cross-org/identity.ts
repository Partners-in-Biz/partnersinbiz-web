// lib/cross-org/identity.ts
//
// Canonical many-to-many identity link service (task ouJ9IpOFkBPKuaxseu7S,
// project JZ7TSJjnGYjv87h6OAst, spec 9EllFp0EYw7MVkn89jbB).
//
// `partnerIdentityLinks` is the canonical join table between CRM companies /
// contacts and organisations / users. The legacy convenience pointers
// (companies.linkedOrgId, contacts.linkedUserId / linkedOrgId) are DERIVED,
// read-only compatibility views: this service is the only writer and
// recomputes them (primary = earliest verified link) after every change.
//
// Design rules:
//   - Many-to-many: one company may link to many orgs (holding companies,
//     agencies, subsidiaries), one contact may link to many orgs/users
//     (multi-client contacts). The join rows hold the full set; the primary
//     convenience pointer is just the first verified link for the CRM row.
//   - Revoked is permanent: revokeIdentityLink never resurrects; a later
//     relink creates a FRESH row (the revoked row stays as audit history).
//   - Acceptance records the APPROVER (verifiedByRef), never the recipient
//     identity. A contact_user link is only created/verified when the
//     accepting session's email matches the invite recipient email.
//   - Identity links assert identity/org affiliation only; they never grant
//     resource access by themselves (that is the policy service's job).

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { extractLegacyPointers, type LegacyPointerInput } from './migration'
import type {
  PartnerIdentityLink,
  PartnerIdentityLinkStatus,
  PartnerIdentityLinkType,
} from './types'
import { CROSS_ORG_SCHEMA_VERSION, PARTNER_IDENTITY_LINKS_COLLECTION } from './types'

// ── Pure helpers (unit-testable without Firestore) ───────────────────────────

/** Stable dedupe key for a (linkType, sourceRef, targetRef) triple. */
export function identityLinkKey(input: {
  linkType: PartnerIdentityLinkType
  sourceRef: { kind: 'company' | 'contact'; id: string }
  targetRef: { kind: 'org' | 'user'; id: string }
}): string {
  return `${input.linkType}:${input.sourceRef.kind}:${input.sourceRef.id}:${input.targetRef.kind}:${input.targetRef.id}`
}

export type IdentityRef = { kind: 'company' | 'contact'; id: string }
export type IdentityTargetRef = { kind: 'org' | 'user'; id: string }

const LINK_TYPE_SHAPES: Record<PartnerIdentityLinkType, [IdentityRef['kind'], IdentityTargetRef['kind']]> = {
  company_org: ['company', 'org'],
  contact_user: ['contact', 'user'],
  company_user: ['company', 'user'],
  contact_org: ['contact', 'org'],
}

/**
 * Validate that the refs match the linkType shape (company_org, contact_user,
 * company_user, contact_org). Returns an error string when invalid.
 */
export function validateIdentityLinkShape(input: {
  linkType: PartnerIdentityLinkType
  sourceRef: IdentityRef
  targetRef: IdentityTargetRef
}): string | null {
  const shape = LINK_TYPE_SHAPES[input.linkType]
  if (!shape) return `unknown linkType ${input.linkType}`
  if (input.sourceRef.kind !== shape[0]) {
    return `${input.linkType} sourceRef.kind must be ${shape[0]}`
  }
  if (input.targetRef.kind !== shape[1]) {
    return `${input.linkType} targetRef.kind must be ${shape[1]}`
  }
  if (!input.sourceRef.id || !input.targetRef.id) return 'sourceRef.id and targetRef.id are required'
  return null
}

// ── Acceptance plan (pure) ───────────────────────────────────────────────────

export interface IdentityLinkCandidate {
  linkType: PartnerIdentityLinkType
  sourceRef: IdentityRef
  targetRef: IdentityTargetRef
  status: PartnerIdentityLinkStatus
  partnerLinkId?: string
  verifiedByRef?: MemberRef
  verifiedAt?: unknown
  provenance: { sourceInviteId?: string }
  schemaVersion: number
}

export interface AcceptanceIdentityPlanInput {
  partnerLinkId: string
  sourceInviteId?: string
  sourceOrgId: string
  sourceCompanyId: string
  sourceContactId?: string
  /**
   * Recipient identity. Present ONLY when the accepting session's email
   * matches the invite recipient email (identity match). An owner/admin who
   * accepts on the recipient's behalf must NOT pass this — the approver is
   * recorded separately and never becomes the invited contact's linked user.
   */
  targetUserId?: string
  targetOrgId: string
  /** Mirror company created in the acceptor's CRM for the source org. */
  targetCompanyId: string
  /** Mirror contact created in the acceptor's CRM for the inviter. */
  targetContactId?: string
  /** The inviter's user identity (recorded on the invite). */
  inviterUserId?: string
  actorRef: MemberRef
  now?: Date
}

/**
 * Plan the identity links an accepted partner invite must create. The acceptor
 * (actorRef) VERIFIES org-level affiliation on both sides; a contact_user link
 * is only created/verified when the recipient identity is present (matched).
 * The inviter-side contact_user is recorded UNVERIFIED — the acceptor approved
 * the org, not the inviter's user identity.
 */
export function planIdentityLinksForAcceptance(
  input: AcceptanceIdentityPlanInput,
): IdentityLinkCandidate[] {
  const now = input.now ?? new Date()
  const verifiedAt = Timestamp.fromDate(now)
  const verifiedByRef = input.actorRef
  const provenance = { sourceInviteId: input.sourceInviteId }
  const out: IdentityLinkCandidate[] = []

  // Source side (inviter's CRM row represents the acceptor's org).
  out.push({
    linkType: 'company_org',
    sourceRef: { kind: 'company', id: input.sourceCompanyId },
    targetRef: { kind: 'org', id: input.targetOrgId },
    status: 'verified',
    partnerLinkId: input.partnerLinkId,
    verifiedByRef,
    verifiedAt,
    provenance,
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
  })

  if (input.sourceContactId) {
    out.push({
      linkType: 'contact_org',
      sourceRef: { kind: 'contact', id: input.sourceContactId },
      targetRef: { kind: 'org', id: input.targetOrgId },
      status: 'verified',
      partnerLinkId: input.partnerLinkId,
      verifiedByRef,
      verifiedAt,
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }

  // Only a matching recipient identity may become the contact's linked user.
  if (input.sourceContactId && input.targetUserId) {
    out.push({
      linkType: 'contact_user',
      sourceRef: { kind: 'contact', id: input.sourceContactId },
      targetRef: { kind: 'user', id: input.targetUserId },
      status: 'verified',
      partnerLinkId: input.partnerLinkId,
      verifiedByRef,
      verifiedAt,
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }

  // Target side (acceptor's CRM mirror represents the source org + inviter).
  out.push({
    linkType: 'company_org',
    sourceRef: { kind: 'company', id: input.targetCompanyId },
    targetRef: { kind: 'org', id: input.sourceOrgId },
    status: 'verified',
    partnerLinkId: input.partnerLinkId,
    verifiedByRef,
    verifiedAt,
    provenance,
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
  })

  if (input.targetContactId) {
    out.push({
      linkType: 'contact_org',
      sourceRef: { kind: 'contact', id: input.targetContactId },
      targetRef: { kind: 'org', id: input.sourceOrgId },
      status: 'verified',
      partnerLinkId: input.partnerLinkId,
      verifiedByRef,
      verifiedAt,
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }

  if (input.targetContactId && input.inviterUserId) {
    out.push({
      linkType: 'contact_user',
      sourceRef: { kind: 'contact', id: input.targetContactId },
      targetRef: { kind: 'user', id: input.inviterUserId },
      status: 'unverified',
      partnerLinkId: input.partnerLinkId,
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }

  return out
}

// ── Primary convenience pointer derivation (pure) ────────────────────────────

export interface PointerSourceLink {
  linkType: PartnerIdentityLinkType
  status: PartnerIdentityLinkStatus
  targetRef: IdentityTargetRef
  verifiedAt?: unknown
  createdAt?: unknown
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

/**
 * Pick the PRIMARY target from a set of identity links: verified links win
 * over unverified, revoked are excluded; within the winning set the earliest
 * verified/created link is primary (the original relationship stays the
 * convenience pointer until it is revoked, then the next one takes over).
 */
export function pickPrimaryTarget(
  links: PointerSourceLink[],
  linkType: PartnerIdentityLinkType,
): string | undefined {
  const active = links.filter((link) => link.status !== 'revoked' && link.linkType === linkType)
  if (active.length === 0) return undefined
  const verified = active.filter((link) => link.status === 'verified')
  const pool = verified.length > 0 ? verified : active
  const sorted = [...pool].sort(
    (a, b) => (timeValue(a.verifiedAt) || timeValue(a.createdAt)) - (timeValue(b.verifiedAt) || timeValue(b.createdAt)),
  )
  return sorted[0]?.targetRef.id
}

/**
 * Compute the primary convenience pointers for a CRM company row from its
 * identity links. `linkedOrgId` comes from the primary company_org link.
 * Returns null when no pointer should be written (nothing active).
 */
export function planPointerSyncForCompany(links: PointerSourceLink[]): { linkedOrgId: string | null } {
  return { linkedOrgId: pickPrimaryTarget(links, 'company_org') ?? null }
}

/**
 * Compute the primary convenience pointers for a CRM contact row: `linkedOrgId`
 * from the primary contact_org link, `linkedUserId` from the primary
 * contact_user link. Each is null when no active link supplies it.
 */
export function planPointerSyncForContact(links: PointerSourceLink[]): {
  linkedOrgId: string | null
  linkedUserId: string | null
} {
  return {
    linkedOrgId: pickPrimaryTarget(links, 'contact_org') ?? null,
    linkedUserId: pickPrimaryTarget(links, 'contact_user') ?? null,
  }
}

// ── Backfill merge (pure) ────────────────────────────────────────────────────

export interface IdentityBackfillInput {
  companyId?: string
  contactId?: string
  pointers: LegacyPointerInput
  existing: PartnerIdentityLink[]
  sourceInviteId?: string
}

/**
 * Plan canonical identity links for a legacy CRM row WITHOUT duplicating rows
 * that already exist (any status — a revoked row is intentional and is never
 * re-created by backfill). New candidates are always `unverified`: verification
 * requires a later, explicit consent step. Mirrors seedIdentityLinksFromPointers
 * but is idempotent against the canonical collection.
 */
export function planIdentityBackfill(input: IdentityBackfillInput): IdentityLinkCandidate[] {
  const { linkedOrgId, linkedUserId } = extractLegacyPointers(input.pointers)
  const existingKeys = new Set(input.existing.map((link) =>
    identityLinkKey({ linkType: link.linkType, sourceRef: link.sourceRef, targetRef: link.targetRef })))
  const out: IdentityLinkCandidate[] = []
  const provenance = { sourceInviteId: input.sourceInviteId }

  const push = (candidate: IdentityLinkCandidate) => {
    const key = identityLinkKey({
      linkType: candidate.linkType,
      sourceRef: candidate.sourceRef,
      targetRef: candidate.targetRef,
    })
    if (existingKeys.has(key)) return
    out.push(candidate)
  }

  if (input.companyId && linkedOrgId) {
    push({
      linkType: 'company_org',
      sourceRef: { kind: 'company', id: input.companyId },
      targetRef: { kind: 'org', id: linkedOrgId },
      status: 'unverified',
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }
  if (input.contactId && linkedUserId) {
    push({
      linkType: 'contact_user',
      sourceRef: { kind: 'contact', id: input.contactId },
      targetRef: { kind: 'user', id: linkedUserId },
      status: 'unverified',
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }
  if (input.contactId && linkedOrgId) {
    push({
      linkType: 'contact_org',
      sourceRef: { kind: 'contact', id: input.contactId },
      targetRef: { kind: 'org', id: linkedOrgId },
      status: 'unverified',
      provenance,
      schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    })
  }

  return out
}

// ── Firestore-backed service ─────────────────────────────────────────────────

export interface EnsureIdentityLinkInput {
  linkType: PartnerIdentityLinkType
  sourceRef: IdentityRef
  targetRef: IdentityTargetRef
  status?: PartnerIdentityLinkStatus
  partnerLinkId?: string
  verifiedByRef?: MemberRef
  verifiedAt?: unknown
  provenance?: { sourceInviteId?: string; sourceDocumentId?: string; approvalGateTaskId?: string }
  actor?: MemberRef
  now?: Date
}

function toLink(id: string, data: Record<string, unknown>): PartnerIdentityLink {
  return { id, ...(data as Omit<PartnerIdentityLink, 'id'>) }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function findLinkByKey(key: string, sourceId: string): Promise<PartnerIdentityLink | null> {
  const snap = await adminDb
    .collection(PARTNER_IDENTITY_LINKS_COLLECTION)
    .where('sourceRef.id', '==', sourceId)
    .limit(200)
    .get()
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    if (identityLinkKey({
      linkType: data.linkType,
      sourceRef: data.sourceRef,
      targetRef: data.targetRef,
    }) === key) {
      return toLink(doc.id, data)
    }
  }
  return null
}

/**
 * Idempotent many-to-many create. Returns the existing NON-revoked link when
 * one already exists; creates a fresh row otherwise (a revoked row with the
 * same key stays as audit history and is never resurrected). After a write,
 * the CRM convenience pointers for the source company/contact are resynced so
 * they always reflect the canonical rows.
 */
export async function ensureIdentityLink(input: EnsureIdentityLinkInput): Promise<{
  link: PartnerIdentityLink
  created: boolean
}> {
  const shapeError = validateIdentityLinkShape(input)
  if (shapeError) throw new Error(shapeError)

  const key = identityLinkKey({ linkType: input.linkType, sourceRef: input.sourceRef, targetRef: input.targetRef })
  const existing = await findLinkByKey(key, input.sourceRef.id)
  if (existing && existing.status !== 'revoked') {
    return { link: existing, created: false }
  }

  const now = input.now ?? new Date()
  const verifiedAt = input.verifiedAt ?? Timestamp.fromDate(now)
  const created = now instanceof Date ? Timestamp.fromDate(now) : Timestamp.now()

  const data: Record<string, unknown> = {
    linkType: input.linkType,
    sourceRef: { kind: input.sourceRef.kind, id: input.sourceRef.id },
    targetRef: { kind: input.targetRef.kind, id: input.targetRef.id },
    status: input.status ?? 'unverified',
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    provenance: {
      ...(input.provenance ?? {}),
    },
    createdAt: created,
    updatedAt: created,
  }
  if (input.partnerLinkId) data.partnerLinkId = clean(input.partnerLinkId)
  if (input.status === 'verified' && input.verifiedByRef) {
    data.verifiedByRef = input.verifiedByRef
    data.verifiedAt = verifiedAt
  }

  const ref = await adminDb.collection(PARTNER_IDENTITY_LINKS_COLLECTION).add(data)
  const snap = await ref.get()
  const link = toLink(ref.id, snap.data() ?? {})

  await resyncPointersForSource(input.sourceRef)
  return { link, created: true }
}

/** Flip an unverified link to verified; no-op when already verified. */
export async function verifyIdentityLink(input: {
  id: string
  actor: MemberRef
  now?: Date
}): Promise<PartnerIdentityLink | null> {
  const ref = adminDb.collection(PARTNER_IDENTITY_LINKS_COLLECTION).doc(input.id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const existing = toLink(snap.id, snap.data() ?? {})
  if (existing.status === 'revoked') throw new Error('A revoked identity link cannot be verified')
  if (existing.status !== 'verified') {
    await ref.set({
      status: 'verified',
      verifiedByRef: input.actor,
      verifiedAt: Timestamp.fromDate(input.now ?? new Date()),
      updatedAt: Timestamp.now(),
    }, { merge: true })
  }
  const after = await ref.get()
  const link = toLink(after.id, after.data() ?? {})
  await resyncPointersForSource(link.sourceRef)
  return link
}

/** Revoke a link permanently; resyncs the affected CRM convenience pointers. */
export async function revokeIdentityLink(input: {
  id: string
  actor: MemberRef
  reason?: string
  now?: Date
}): Promise<PartnerIdentityLink | null> {
  const ref = adminDb.collection(PARTNER_IDENTITY_LINKS_COLLECTION).doc(input.id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const existing = toLink(snap.id, snap.data() ?? {})
  if (existing.status === 'revoked') return existing
  await ref.set({
    status: 'revoked',
    revokedByRef: input.actor,
    revokedAt: Timestamp.fromDate(input.now ?? new Date()),
    updatedAt: Timestamp.now(),
  }, { merge: true })
  const after = await ref.get()
  const link = toLink(after.id, after.data() ?? {})
  await resyncPointersForSource(link.sourceRef)
  return link
}

export interface RevokeForPartnerLinkResult {
  revokedIds: string[]
  affectedCompanyIds: string[]
  affectedContactIds: string[]
}

/**
 * Revoke every identity link derived from a partner link (unlink cascade).
 * Returns the revoked ids plus the CRM company/contact ids whose convenience
 * pointers must be resynced so the next-verified link becomes primary.
 */
export async function revokeIdentityLinksForPartnerLink(
  partnerLinkId: string,
  actor: MemberRef,
): Promise<RevokeForPartnerLinkResult> {
  const id = clean(partnerLinkId)
  if (!id) return { revokedIds: [], affectedCompanyIds: [], affectedContactIds: [] }
  const snap = await adminDb
    .collection(PARTNER_IDENTITY_LINKS_COLLECTION)
    .where('partnerLinkId', '==', id)
    .limit(200)
    .get()

  const revokedIds: string[] = []
  const affectedCompanyIds = new Set<string>()
  const affectedContactIds = new Set<string>()
  const now = Timestamp.now()

  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    if (data.status === 'revoked') continue
    await doc.ref.set({
      status: 'revoked',
      revokedByRef: actor,
      revokedAt: now,
      updatedAt: now,
    }, { merge: true })
    revokedIds.push(doc.id)
    const source = data.sourceRef as { kind?: string; id?: string } | undefined
    if (source?.kind === 'company' && source.id) affectedCompanyIds.add(source.id)
    if (source?.kind === 'contact' && source.id) affectedContactIds.add(source.id)
  }

  return {
    revokedIds,
    affectedCompanyIds: Array.from(affectedCompanyIds),
    affectedContactIds: Array.from(affectedContactIds),
  }
}

export interface IdentityLinkListParams {
  companyId?: string
  contactId?: string
  orgId?: string
  userId?: string
  status?: PartnerIdentityLinkStatus
  limit?: number
}

/**
 * List identity links for a CRM company/contact or org/user. Single-field
 * queries keep this composite-index-safe; the bounded candidate set is
 * filtered in memory for the remaining predicates.
 */
export async function listIdentityLinks(params: IdentityLinkListParams): Promise<PartnerIdentityLink[]> {
  const companyId = clean(params.companyId)
  const contactId = clean(params.contactId)
  const orgId = clean(params.orgId)
  const userId = clean(params.userId)
  const sourceId = companyId || contactId
  const targetId = orgId || userId

  let snapshot
  if (sourceId) {
    snapshot = await adminDb
      .collection(PARTNER_IDENTITY_LINKS_COLLECTION)
      .where('sourceRef.id', '==', sourceId)
      .limit(200)
      .get()
  } else if (targetId) {
    snapshot = await adminDb
      .collection(PARTNER_IDENTITY_LINKS_COLLECTION)
      .where('targetRef.id', '==', targetId)
      .limit(200)
      .get()
  } else {
    snapshot = await adminDb
      .collection(PARTNER_IDENTITY_LINKS_COLLECTION)
      .limit(200)
      .get()
  }

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200)
  const rows = snapshot.docs.map((doc) => toLink(doc.id, doc.data() ?? {}))
  return rows
    .filter((link) => {
      if (companyId && !(link.sourceRef.kind === 'company' && link.sourceRef.id === companyId)) return false
      if (contactId && !(link.sourceRef.kind === 'contact' && link.sourceRef.id === contactId)) return false
      if (orgId && !(link.targetRef.kind === 'org' && link.targetRef.id === orgId)) return false
      if (userId && !(link.targetRef.kind === 'user' && link.targetRef.id === userId)) return false
      if (params.status && link.status !== params.status) return false
      return true
    })
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))
    .slice(0, limit)
}

/**
 * Recompute the primary convenience pointers on a CRM company or contact from
 * its canonical identity links. This is the ONLY writer of those pointers;
 * callers must never stamp linkedOrgId/linkedUserId directly.
 *
 * Migration-safe posture: when a canonical primary exists it is written;
 * when NO canonical link supplies a pointer the existing value is PRESERVED
 * (legacy pointers are read-only compatibility inputs and are never destroyed
 * by this service). The unlink cascade clears cross-boundary pointers
 * explicitly via its own scan, and a subsequent resync then re-derives the
 * primary from the remaining canonical links.
 */
export async function resyncPointersForSource(
  sourceRef: IdentityRef,
): Promise<{ linkedOrgId: string | null; linkedUserId: string | null }> {
  const links = await listIdentityLinks(
    sourceRef.kind === 'company'
      ? { companyId: sourceRef.id }
      : { contactId: sourceRef.id },
  )
  const pointerLinks = links.map((link) => ({
    linkType: link.linkType,
    status: link.status,
    targetRef: link.targetRef,
    verifiedAt: link.verifiedAt,
    createdAt: link.createdAt,
  }))

  const ref = adminDb.collection(sourceRef.kind === 'company' ? 'companies' : 'contacts').doc(sourceRef.id)
  const snap = await ref.get()
  if (!snap.exists) {
    return { linkedOrgId: null, linkedUserId: null }
  }

  const patch: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
  }
  let linkedOrgId: string | null = null
  let linkedUserId: string | null = null

  if (sourceRef.kind === 'company') {
    const plan = planPointerSyncForCompany(pointerLinks)
    linkedOrgId = plan.linkedOrgId
    if (plan.linkedOrgId) patch.linkedOrgId = plan.linkedOrgId
  } else {
    const plan = planPointerSyncForContact(pointerLinks)
    linkedOrgId = plan.linkedOrgId
    linkedUserId = plan.linkedUserId
    if (plan.linkedOrgId) patch.linkedOrgId = plan.linkedOrgId
    if (plan.linkedUserId) patch.linkedUserId = plan.linkedUserId
  }

  await ref.set(patch, { merge: true })
  return { linkedOrgId, linkedUserId }
}
