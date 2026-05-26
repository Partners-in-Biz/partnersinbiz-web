import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { AGENT_PIP_REF } from '@/lib/orgMembers/memberRef'
import { bootstrapDefaultPipeline, getDefaultPipelineForOrg } from '@/lib/pipelines/store'
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

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
  const platformSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  if (platformSnap.empty) return null

  const platformOrgId = platformSnap.docs[0].id
  const now = Timestamp.now()
  const normalizedEmail = normalizeEmail(input.contactEmail)
  const businessName = cleanString(input.businessName) || normalizedEmail || input.targetOrgId

  const companiesSnap = await adminDb.collection('companies')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()
  const existingCompany = companiesSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return data.linkedOrgId === input.targetOrgId ||
      cleanString(data.name).toLowerCase() === businessName.toLowerCase()
  })

  let companyId = existingCompany?.id
  if (existingCompany) {
    await existingCompany.ref.set({
      linkedOrgId: input.targetOrgId,
      updatedAt: now,
    }, { merge: true })
  } else {
    const ref = adminDb.collection('companies').doc()
    companyId = ref.id
    await ref.set({
      orgId: platformOrgId,
      name: businessName,
      linkedOrgId: input.targetOrgId,
      source: 'claimable_relationship',
      lifecycleStage: 'lead',
      tags: ['organic-platform-lead'],
      ownerUid: AGENT_PIP_REF.uid,
      ownerRef: AGENT_PIP_REF,
      createdByRef: AGENT_PIP_REF,
      updatedByRef: AGENT_PIP_REF,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  const contactsSnap = await adminDb.collection('contacts')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()
  const existingContact = contactsSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return normalizeEmail(cleanString(data.email)) === normalizedEmail ||
      data.linkedUserId === input.targetUserId
  })

  let contactId = existingContact?.id
  if (existingContact) {
    await existingContact.ref.set({
      linkedUserId: input.targetUserId,
      companyId,
      companyName: businessName,
      updatedAt: now,
    }, { merge: true })
  } else {
    const ref = adminDb.collection('contacts').doc()
    contactId = ref.id
    await ref.set({
      orgId: platformOrgId,
      name: cleanString(input.contactName) || normalizedEmail,
      email: normalizedEmail,
      company: businessName,
      companyId,
      companyName: businessName,
      linkedUserId: input.targetUserId,
      source: 'manual',
      type: 'lead',
      stage: 'new',
      tags: ['organic-platform-lead'],
      deleted: false,
      createdByRef: AGENT_PIP_REF,
      updatedByRef: AGENT_PIP_REF,
      createdAt: now,
      updatedAt: now,
      subscribedAt: now,
      unsubscribedAt: null,
      bouncedAt: null,
    })
  }

  const pipeline = await getDefaultPipelineForOrg(platformOrgId) ??
    await bootstrapDefaultPipeline(platformOrgId, AGENT_PIP_REF)
  const firstOpenStage = pipeline.stages.find((stage) => stage.kind === 'open') ?? pipeline.stages[0]

  const dealsSnap = await adminDb.collection('deals')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()
  const existingDeal = dealsSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return data.companyId === companyId &&
      data.deleted !== true &&
      !data.lostReason &&
      (typeof data.probability !== 'number' || data.probability < 100)
  })

  let dealId = existingDeal?.id
  if (!existingDeal && firstOpenStage) {
    const ref = adminDb.collection('deals').doc()
    dealId = ref.id
    await ref.set({
      orgId: platformOrgId,
      title: `${businessName} - PiB service opportunity`,
      contactId,
      companyId,
      companyName: businessName,
      value: 0,
      currency: 'ZAR',
      pipelineId: pipeline.id,
      stageId: firstOpenStage.id,
      probability: firstOpenStage.probability ?? 10,
      sourceRelationship: {
        sourceOrgId: input.sourceOrgId,
        targetOrgId: input.targetOrgId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
      createdByRef: AGENT_PIP_REF,
      updatedByRef: AGENT_PIP_REF,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
  } else if (existingDeal) {
    await existingDeal.ref.set({
      updatedAt: now,
    }, { merge: true })
  }

  return { companyId: companyId!, contactId: contactId!, dealId }
}
