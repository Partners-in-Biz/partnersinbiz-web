import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { ensurePlatformLeadForClaim } from '@/lib/platform-owner/relationships'
import type {
  ApplyClaimLinksInput,
  ClaimableRelationship,
  ClaimableResourceType,
  EnsureClaimableRelationshipInput,
  EnsureClaimableRelationshipResult,
} from './types'

const COLLECTION = 'claimable_relationships'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function resourceCollection(resourceType: ClaimableResourceType): string {
  return resourceType === 'invoice' ? 'invoices' : 'projects'
}

async function loadExistingCrmLink(collectionName: 'companies' | 'contacts', id: string | undefined, sourceOrgId: string) {
  if (!id) return {}
  const snap = await adminDb.collection(collectionName).doc(id).get()
  if (!snap.exists) return {}
  const data = snap.data() ?? {}
  if (data.orgId !== sourceOrgId) return {}
  return data
}

export async function ensureClaimableRelationship(
  input: EnsureClaimableRelationshipInput,
): Promise<EnsureClaimableRelationshipResult> {
  const recipientEmail = normalizeEmail(input.recipientEmail)
  if (!input.sourceOrgId) throw new Error('sourceOrgId is required')
  if (!recipientEmail) throw new Error('recipientEmail is required')
  if (!input.resourceId) throw new Error('resourceId is required')

  const existing = await adminDb
    .collection(COLLECTION)
    .where('sourceOrgId', '==', input.sourceOrgId)
    .where('resourceType', '==', input.resourceType)
    .where('resourceId', '==', input.resourceId)
    .where('recipientEmail', '==', recipientEmail)
    .limit(1)
    .get()

  if (!existing.empty) {
    const doc = existing.docs[0]
    const data = doc.data() as ClaimableRelationship
    return {
      id: doc.id,
      claimToken: data.claimToken,
      targetOrgId: data.targetOrgId,
      targetUserId: data.targetUserId,
      status: data.status,
    }
  }

  const [company, contact] = await Promise.all([
    loadExistingCrmLink('companies', input.sourceCompanyId, input.sourceOrgId),
    loadExistingCrmLink('contacts', input.sourceContactId, input.sourceOrgId),
  ])

  const claimToken = crypto.randomBytes(16).toString('hex')
  const targetOrgId = input.recipientOrgId ||
    (typeof company.linkedOrgId === 'string' ? company.linkedOrgId : undefined)
  const targetUserId = input.recipientUserId ||
    (typeof contact.linkedUserId === 'string' ? contact.linkedUserId : undefined)
  const status: ClaimableRelationship['status'] = targetOrgId ? 'claimed' : 'pending'
  const now = FieldValue.serverTimestamp()

  const doc: Record<string, unknown> = {
    sourceOrgId: input.sourceOrgId,
    sourceCompanyId: input.sourceCompanyId,
    sourceContactId: input.sourceContactId,
    targetOrgId,
    targetUserId,
    recipientEmail,
    recipientName: input.recipientName,
    recipientCompanyName: input.recipientCompanyName,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    claimToken,
    status,
    claimedAt: status === 'claimed' ? now : undefined,
    createdAt: now,
    updatedAt: now,
  }

  const toWrite = Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined))
  const ref = await adminDb.collection(COLLECTION).add(toWrite)

  return {
    id: ref.id,
    claimToken,
    targetOrgId,
    targetUserId,
    status,
  }
}

export async function applyClaimLinks(input: ApplyClaimLinksInput): Promise<void> {
  const now = FieldValue.serverTimestamp()
  const tasks: Array<Promise<unknown>> = []

  tasks.push(adminDb.collection(COLLECTION).doc(input.relationshipId).update({
    targetOrgId: input.targetOrgId,
    targetUserId: input.targetUserId,
    status: 'claimed',
    claimedAt: now,
    updatedAt: now,
  }))

  if (input.sourceCompanyId) {
    tasks.push(adminDb.collection('companies').doc(input.sourceCompanyId).update({
      linkedOrgId: input.targetOrgId,
      updatedAt: now,
    }))
  }

  if (input.sourceContactId) {
    tasks.push(adminDb.collection('contacts').doc(input.sourceContactId).update({
      linkedUserId: input.targetUserId,
      updatedAt: now,
    }))
  }

  tasks.push(adminDb.collection(resourceCollection(input.resourceType)).doc(input.resourceId).update({
    recipientOrgId: input.targetOrgId,
    recipientUserId: input.targetUserId,
    targetOrgId: input.targetOrgId,
    targetUserId: input.targetUserId,
    claimStatus: 'claimed',
    updatedAt: now,
  }))

  await Promise.all(tasks)
}

export async function createPlatformLeadForClaim(input: {
  targetOrgId: string
  targetUserId: string
  businessName: string
  contactName: string
  contactEmail: string
  sourceOrgId: string
  resourceType: ClaimableResourceType
  resourceId: string
}): Promise<{ companyId: string; contactId: string; dealId?: string } | null> {
  return ensurePlatformLeadForClaim(input)
}
