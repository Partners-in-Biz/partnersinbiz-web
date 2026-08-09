import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import type {
  BusinessRelationship,
  BusinessRelationshipInput,
  BusinessRelationshipListParams,
  SharedBusinessCapability,
} from './types'

const COLLECTION = 'businessRelationships'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function limitValue(value: unknown, fallback = 100): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 500)
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function sanitizeRelationship(input: Record<string, unknown>): Partial<BusinessRelationshipInput> {
  const out: Partial<BusinessRelationshipInput> = {}
  const copyString = (key: keyof BusinessRelationshipInput) => {
    const value = cleanString(input[key])
    if (value) (out as Record<string, unknown>)[key] = value
  }

  copyString('sourceCompanyId')
  copyString('sourceContactId')
  copyString('targetOrgId')
  copyString('targetCompanyId')
  copyString('targetContactId')
  copyString('targetName')
  copyString('relationshipType')
  copyString('status')
  copyString('visibility')
  copyString('approvalState')
  copyString('partnerLinkId')
  copyString('notes')

  const sharedCapabilities = cleanStringArray(input.sharedCapabilities) as SharedBusinessCapability[]
  if (sharedCapabilities.length > 0) out.sharedCapabilities = sharedCapabilities
  if (typeof input.portalVisible === 'boolean') out.portalVisible = input.portalVisible
  if (input.fieldSharingPolicy && typeof input.fieldSharingPolicy === 'object' && !Array.isArray(input.fieldSharingPolicy)) {
    out.fieldSharingPolicy = input.fieldSharingPolicy as BusinessRelationshipInput['fieldSharingPolicy']
  }
  const allowedOrgIds = cleanStringArray(input.allowedOrgIds)
  if (allowedOrgIds.length > 0) out.allowedOrgIds = allowedOrgIds
  const allowedUserIds = cleanStringArray(input.allowedUserIds)
  if (allowedUserIds.length > 0) out.allowedUserIds = allowedUserIds
  return out
}

function matchesRelationship(row: BusinessRelationship, params: BusinessRelationshipListParams): boolean {
  if (row.deleted === true) return false
  if (params.companyId && row.sourceCompanyId !== params.companyId && row.targetCompanyId !== params.companyId) return false
  if (params.targetOrgId && row.targetOrgId !== params.targetOrgId) return false
  if (params.status && row.status !== params.status) return false
  if (params.capability && !row.sharedCapabilities?.includes(params.capability)) return false
  return true
}

/**
 * Internal-only switch for the accepted bilateral Partner Link accept flow.
 *
 * `bilateral: true` is the ONLY path that may create/activate rows with a
 * partnerLinkId, status=active, approvalState=approved, portalVisible=true or
 * non-empty sharedCapabilities. Only lib/partner-links/store.ts
 * (acceptPartnerInvite) passes it. Every other caller — the generic CRM
 * relationships route, the platform-owner company sync — creates CRM
 * relationship METADATA: pending, draft, private, with no capabilities and no
 * cross-org evidence.
 */
export interface BusinessRelationshipStoreOptions {
  bilateral?: boolean
}

/**
 * Fail closed: a business relationship row can only become usable
 * collaboration (active, approved, portal-visible, with capabilities) when the
 * caller asserts it is one side of an explicitly accepted bilateral Partner
 * Link. Generic metadata rows must never carry a partnerLinkId or activation
 * fields, otherwise a unilateral row would advertise cross-org capability that
 * was never consented to.
 */
function assertActivationBasis(
  patch: Partial<BusinessRelationshipInput>,
  opts: BusinessRelationshipStoreOptions | undefined,
): void {
  if (opts?.bilateral) {
    if (!cleanString(patch.partnerLinkId)) {
      throw new Error('Bilateral activation requires a partnerLinkId')
    }
    return
  }

  if (cleanString(patch.partnerLinkId)) {
    throw new Error('partnerLinkId is set server-side only and requires accepted bilateral Partner Link evidence')
  }

  const attempts: string[] = []
  const status = cleanString(patch.status)
  if (status && !['pending', 'paused', 'revoked', 'archived'].includes(status)) {
    attempts.push(`status=${status}`)
  }
  const approval = cleanString(patch.approvalState)
  if (approval && approval !== 'draft' && approval !== 'pending_approval') {
    attempts.push(`approvalState=${approval}`)
  }
  if (patch.portalVisible === true) attempts.push('portalVisible=true')
  if ((patch.sharedCapabilities?.length ?? 0) > 0) {
    attempts.push(`sharedCapabilities=[${patch.sharedCapabilities?.join(', ')}]`)
  }
  if (attempts.length > 0) {
    throw new Error(
      `Cannot activate a business relationship without accepted bilateral Partner Link evidence (${attempts.join(', ')})`,
    )
  }
}

/** Safe defaults for CRM relationship metadata rows (no collaboration contract). */
function metadataDefaults(patch: Partial<BusinessRelationshipInput>): Pick<
  BusinessRelationshipInput,
  'status' | 'sharedCapabilities' | 'visibility' | 'approvalState' | 'portalVisible'
> {
  return {
    status: 'pending',
    sharedCapabilities: [],
    visibility: 'private',
    approvalState: 'draft',
    portalVisible: false,
  }
}

/** Activation defaults for one side of an accepted bilateral Partner Link. */
function bilateralDefaults(patch: Partial<BusinessRelationshipInput>): Pick<
  BusinessRelationshipInput,
  'status' | 'sharedCapabilities' | 'visibility' | 'approvalState' | 'portalVisible'
> {
  return {
    status: patch.status ?? 'active',
    sharedCapabilities: patch.sharedCapabilities ?? [],
    visibility: patch.visibility ?? 'relationship',
    approvalState: patch.approvalState ?? 'approved',
    portalVisible: patch.portalVisible ?? true,
  }
}

export async function listBusinessRelationships(
  sourceOrgId: string,
  params: BusinessRelationshipListParams = {},
): Promise<BusinessRelationship[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('sourceOrgId', '==', sourceOrgId)
    .limit(1000)
    .get()

  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as BusinessRelationship)
    .filter((row) => matchesRelationship(row, params))
    .sort((a, b) => timeValue(b.updatedAt ?? b.createdAt) - timeValue(a.updatedAt ?? a.createdAt))
    .slice(0, limitValue(params.limit))
}

export async function createBusinessRelationship(
  sourceOrgId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
  opts: BusinessRelationshipStoreOptions = {},
): Promise<BusinessRelationship> {
  const patch = sanitizeRelationship(input)
  assertActivationBasis(patch, opts)
  const relationshipType = patch.relationshipType ?? 'partner'
  const activation = opts.bilateral
    ? bilateralDefaults(patch)
    : metadataDefaults(patch)
  const status = activation.status
  const ref = await adminDb.collection(COLLECTION).add({
    ...patch,
    sourceOrgId,
    relationshipType,
    status: activation.status,
    sharedCapabilities: activation.sharedCapabilities,
    visibility: activation.visibility,
    approvalState: activation.approvalState,
    portalVisible: activation.portalVisible,
    createdByRef: actor,
    updatedByRef: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  const snap = await ref.get()
  const relationship = { id: ref.id, ...snap.data() } as BusinessRelationship
  await recordCrmAuditEvent({
    orgId: sourceOrgId,
    eventType: 'business_relationship.created',
    resourceType: 'businessRelationship',
    resourceId: ref.id,
    companyId: relationship.sourceCompanyId,
    relationshipId: ref.id,
    approvalState: relationship.approvalState,
    actorRef: actor,
    metadata: { relationshipType, status },
    notification: relationship.portalVisible
      ? {
          type: 'crm.relationship.created',
          title: 'Business relationship created',
          body: relationship.targetName ? `Relationship with ${relationship.targetName} is now tracked.` : 'A business relationship is now tracked.',
          targetOrgIds: relationship.allowedOrgIds ?? [],
        }
      : undefined,
  })
  return relationship
}

export async function ensureBusinessRelationship(
  sourceOrgId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
  opts: BusinessRelationshipStoreOptions = {},
): Promise<BusinessRelationship> {
  const patch = sanitizeRelationship(input)
  assertActivationBasis(patch, opts)
  const relationshipType = patch.relationshipType ?? 'partner'
  const targetOrgId = cleanString(patch.targetOrgId)
  const sourceCompanyId = cleanString(patch.sourceCompanyId)
  const targetCompanyId = cleanString(patch.targetCompanyId)

  const snap = await adminDb
    .collection(COLLECTION)
    .where('sourceOrgId', '==', sourceOrgId)
    .limit(1000)
    .get()

  const existing = snap.docs.find((doc) => {
    const row = doc.data() as Partial<BusinessRelationship>
    if (row.deleted === true) return false
    if (row.relationshipType !== relationshipType) return false
    if (targetOrgId && row.targetOrgId !== targetOrgId) return false
    if (sourceCompanyId && row.sourceCompanyId !== sourceCompanyId) return false
    if (targetCompanyId && row.targetCompanyId !== targetCompanyId) return false
    return true
  })

  // A row already carrying a partnerLinkId is one side of an accepted
  // bilateral Partner Link — a generic reconcile must never downgrade or
  // strip it. Everything else defaults to inert CRM metadata.
  const existingData = existing ? (existing.data() as Partial<BusinessRelationship>) : null
  const activation = opts.bilateral
    ? bilateralDefaults(patch)
    : existingData && cleanString(existingData.partnerLinkId)
      ? {
          status: existingData.status ?? 'active',
          sharedCapabilities: existingData.sharedCapabilities ?? [],
          visibility: existingData.visibility ?? 'relationship',
          approvalState: existingData.approvalState ?? 'approved',
          portalVisible: existingData.portalVisible ?? true,
        }
      : metadataDefaults(patch)

  const defaults = {
    ...patch,
    sourceOrgId,
    relationshipType,
    status: activation.status,
    sharedCapabilities: activation.sharedCapabilities,
    visibility: activation.visibility,
    approvalState: activation.approvalState,
    portalVisible: activation.portalVisible,
    allowedOrgIds: patch.allowedOrgIds ?? [sourceOrgId, targetOrgId].filter(Boolean),
    updatedByRef: actor,
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  if (existing) {
    await existing.ref.set(defaults, { merge: true })
    const next = await existing.ref.get()
    const relationship = { id: existing.id, ...next.data() } as BusinessRelationship
    await recordCrmAuditEvent({
      orgId: sourceOrgId,
      eventType: 'business_relationship.reconciled',
      resourceType: 'businessRelationship',
      resourceId: existing.id,
      companyId: relationship.sourceCompanyId,
      relationshipId: existing.id,
      approvalState: relationship.approvalState,
      actorRef: actor,
      metadata: { relationshipType, targetOrgId, sourceCompanyId, targetCompanyId },
    })
    return relationship
  }

  const ref = await adminDb.collection(COLLECTION).add({
    ...defaults,
    createdByRef: actor,
    createdAt: FieldValue.serverTimestamp(),
  })
  const next = await ref.get()
  const relationship = { id: ref.id, ...next.data() } as BusinessRelationship
  await recordCrmAuditEvent({
    orgId: sourceOrgId,
    eventType: 'business_relationship.created',
    resourceType: 'businessRelationship',
    resourceId: ref.id,
    companyId: relationship.sourceCompanyId,
    relationshipId: ref.id,
    approvalState: relationship.approvalState,
    actorRef: actor,
    metadata: { relationshipType, targetOrgId, sourceCompanyId, targetCompanyId },
    notification: relationship.portalVisible
      ? {
          type: 'crm.relationship.created',
          title: 'Business relationship created',
          body: relationship.targetName ? `Relationship with ${relationship.targetName} is now tracked.` : 'A business relationship is now tracked.',
          targetOrgIds: relationship.allowedOrgIds ?? [],
        }
      : undefined,
  })
  return relationship
}

export async function updateBusinessRelationship(
  sourceOrgId: string,
  relationshipId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
): Promise<BusinessRelationship> {
  const ref = adminDb.collection(COLLECTION).doc(relationshipId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Relationship not found')
  const existing = snap.data() as BusinessRelationship
  if (existing.sourceOrgId !== sourceOrgId) throw new Error('Relationship not found')
  const patch = sanitizeRelationship(input)

  // partnerLinkId is minted once by the accept flow; it can never be changed
  // or forged through an update.
  if (cleanString(patch.partnerLinkId)) {
    throw new Error('partnerLinkId is set server-side only and requires accepted bilateral Partner Link evidence')
  }

  // Accepted bilateral links keep one-sided edits (capabilities, visibility,
  // portal visibility). Metadata rows without a partnerLinkId may change
  // notes/status lifecycle but can never activate themselves.
  const isLiveBilateralLink = Boolean(cleanString(existing.partnerLinkId))
  if (!isLiveBilateralLink) assertActivationBasis(patch, undefined)

  await ref.update({
    ...patch,
    updatedByRef: actor,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const next = await ref.get()
  const relationship = { id: relationshipId, ...next.data() } as BusinessRelationship
  await recordCrmAuditEvent({
    orgId: sourceOrgId,
    eventType: 'business_relationship.updated',
    resourceType: 'businessRelationship',
    resourceId: relationshipId,
    companyId: relationship.sourceCompanyId,
    relationshipId,
    approvalState: relationship.approvalState,
    actorRef: actor,
    metadata: patch as Record<string, unknown>,
    notification: patch.status || patch.portalVisible !== undefined || patch.fieldSharingPolicy
      ? {
          type: 'crm.relationship.updated',
          title: 'Business relationship updated',
          body: relationship.targetName ? `Relationship with ${relationship.targetName} changed.` : 'A business relationship changed.',
          targetOrgIds: relationship.allowedOrgIds ?? [],
        }
      : undefined,
  })
  return relationship
}
