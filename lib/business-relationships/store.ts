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
): Promise<BusinessRelationship> {
  const patch = sanitizeRelationship(input)
  const relationshipType = patch.relationshipType ?? 'partner'
  const status = patch.status ?? 'active'
  const ref = await adminDb.collection(COLLECTION).add({
    ...patch,
    sourceOrgId,
    relationshipType,
    status,
    sharedCapabilities: patch.sharedCapabilities ?? ['projects', 'documents', 'services'],
    visibility: patch.visibility ?? 'relationship',
    approvalState: patch.approvalState ?? 'approved',
    portalVisible: patch.portalVisible ?? true,
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
): Promise<BusinessRelationship> {
  const patch = sanitizeRelationship(input)
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

  const defaults = {
    ...patch,
    sourceOrgId,
    relationshipType,
    status: patch.status ?? 'active',
    sharedCapabilities: patch.sharedCapabilities ?? ['crm', 'projects', 'documents', 'services'],
    visibility: patch.visibility ?? 'relationship',
    approvalState: patch.approvalState ?? 'approved',
    portalVisible: patch.portalVisible ?? true,
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
