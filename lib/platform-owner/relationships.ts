import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { AGENT_PIP_REF } from '@/lib/orgMembers/memberRef'
import { bootstrapDefaultPipeline, getDefaultPipelineForOrg } from '@/lib/pipelines/store'
import type { ClaimableResourceType } from '@/lib/claimable-relationships/types'

export const PLATFORM_OWNER_FALLBACK_ID = 'pib-platform-owner'

type OrgLike = Record<string, unknown>

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function normalizeComparable(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function mergeTags(existing: unknown, additions: string[], removals: string[] = []): string[] {
  const values = Array.isArray(existing)
    ? existing.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : []
  const removeSet = new Set(removals)
  const next = new Set(values.filter((tag) => !removeSet.has(tag)))
  for (const tag of additions) next.add(tag)
  return Array.from(next)
}

function splitName(displayName: string) {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

function companyNameForOrg(orgId: string, org: OrgLike | null | undefined, fallback?: string): string {
  return cleanString(fallback) || cleanString(org?.name) || cleanString(org?.displayName) || orgId
}

function domainForOrg(org: OrgLike | null | undefined): string {
  const direct = cleanString(org?.domain)
  if (direct) return direct.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const website = cleanString(org?.website)
  if (!website) return ''
  return website.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

async function loadOrg(orgId: string): Promise<OrgLike | null> {
  if (!orgId) return null
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  return snap.exists ? snap.data() ?? null : null
}

export async function resolvePlatformOwnerOrgId(): Promise<string> {
  const snap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  return snap.empty ? PLATFORM_OWNER_FALLBACK_ID : snap.docs[0].id
}

export async function ensurePlatformCompanyForOrg(input: {
  clientOrgId: string
  clientOrg?: OrgLike | null
  businessName?: string
  platformOrgId?: string
  source?: string
  lifecycleStage?: 'lead' | 'prospect' | 'customer' | 'churned'
  tags?: string[]
}): Promise<{ platformOrgId: string; companyId: string; companyName: string }> {
  const platformOrgId = input.platformOrgId || await resolvePlatformOwnerOrgId()
  const clientOrg = input.clientOrg ?? await loadOrg(input.clientOrgId)
  const companyName = companyNameForOrg(input.clientOrgId, clientOrg, input.businessName)
  const domain = domainForOrg(clientOrg)
  const normalizedName = normalizeComparable(companyName)
  const normalizedDomain = normalizeComparable(domain)
  const now = Timestamp.now()

  const companiesSnap = await adminDb.collection('companies')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()

  const existing = companiesSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return data.linkedOrgId === input.clientOrgId ||
      normalizeComparable(data.name) === normalizedName ||
      (normalizedDomain && normalizeComparable(data.domain) === normalizedDomain)
  })

  const basePatch: Record<string, unknown> = {
    orgId: platformOrgId,
    name: companyName,
    linkedOrgId: input.clientOrgId,
    source: input.source ?? 'platform_member_sync',
    lifecycleStage: input.lifecycleStage ?? 'customer',
    tags: input.tags ?? ['client-org'],
    updatedAt: now,
    deleted: false,
  }
  if (domain) basePatch.domain = domain

  if (existing) {
    const existingData = existing.data() ?? {}
    const lifecycleStage = existingData.lifecycleStage === 'customer'
      ? 'customer'
      : input.lifecycleStage ?? existingData.lifecycleStage ?? 'customer'
    await existing.ref.set({
      ...basePatch,
      lifecycleStage,
      tags: mergeTags(existingData.tags, input.tags ?? ['client-org']),
    }, { merge: true })
    return { platformOrgId, companyId: existing.id, companyName }
  }

  const ref = adminDb.collection('companies').doc()
  await ref.set({
    ...basePatch,
    notes: '',
    ownerUid: AGENT_PIP_REF.uid,
    ownerRef: AGENT_PIP_REF,
    createdByRef: AGENT_PIP_REF,
    updatedByRef: AGENT_PIP_REF,
    createdAt: now,
  })
  return { platformOrgId, companyId: ref.id, companyName }
}

export async function syncPlatformContactForOrgMember(input: {
  clientOrgId: string
  uid: string
  email?: string
  displayName?: string
  role?: string
  phone?: string
  jobTitle?: string
  clientOrg?: OrgLike | null
  platformOrgId?: string
}): Promise<{ platformOrgId: string; companyId: string; contactId: string } | null> {
  const uid = cleanString(input.uid)
  const email = normalizeEmail(input.email)
  if (!uid && !email) return null

  const company = await ensurePlatformCompanyForOrg({
    clientOrgId: input.clientOrgId,
    clientOrg: input.clientOrg,
    platformOrgId: input.platformOrgId,
    lifecycleStage: 'customer',
    source: 'platform_member_sync',
    tags: ['client-org'],
  })
  const now = Timestamp.now()
  const displayName = cleanString(input.displayName) || email || uid
  const contactsSnap = await adminDb.collection('contacts')
    .where('orgId', '==', company.platformOrgId)
    .limit(1000)
    .get()
  const existing = contactsSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return data.linkedUserId === uid ||
      (email && normalizeEmail(data.email) === email)
  })

  const patch: Record<string, unknown> = {
    orgId: company.platformOrgId,
    name: displayName,
    email,
    phone: cleanString(input.phone),
    company: company.companyName,
    companyId: company.companyId,
    companyName: company.companyName,
    linkedUserId: uid,
    linkedOrgId: input.clientOrgId,
    source: 'manual',
    type: 'client',
    stage: 'won',
    tags: ['client-member'],
    notes: '',
    assignedTo: '',
    capturedFromId: '',
    role: cleanString(input.role),
    jobTitle: cleanString(input.jobTitle),
    deleted: false,
    updatedByRef: AGENT_PIP_REF,
    updatedAt: now,
    lastContactedAt: null,
    subscribedAt: now,
    unsubscribedAt: null,
    bouncedAt: null,
  }

  if (existing) {
    const existingData = existing.data() ?? {}
    await existing.ref.set({
      ...patch,
      tags: mergeTags(existingData.tags, ['client-member'], ['former-client-member']),
    }, { merge: true })
    return { platformOrgId: company.platformOrgId, companyId: company.companyId, contactId: existing.id }
  }

  const ref = adminDb.collection('contacts').doc()
  const { firstName, lastName } = splitName(displayName)
  await ref.set({
    ...patch,
    firstName,
    lastName,
    website: '',
    createdByRef: AGENT_PIP_REF,
    createdAt: now,
  })
  return { platformOrgId: company.platformOrgId, companyId: company.companyId, contactId: ref.id }
}

export async function markPlatformContactFormerOrgMember(input: {
  clientOrgId: string
  uid: string
  email?: string
}): Promise<{ contactId: string } | null> {
  const platformOrgId = await resolvePlatformOwnerOrgId()
  const uid = cleanString(input.uid)
  const email = normalizeEmail(input.email)
  const contactsSnap = await adminDb.collection('contacts')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()
  const existing = contactsSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return (uid && data.linkedUserId === uid) ||
      (email && normalizeEmail(data.email) === email)
  })
  if (!existing) return null
  const data = existing.data() ?? {}
  await existing.ref.set({
    linkedOrgId: input.clientOrgId,
    tags: mergeTags(data.tags, ['former-client-member'], ['client-member']),
    clientMemberActive: false,
    updatedAt: Timestamp.now(),
  }, { merge: true })
  return { contactId: existing.id }
}

export async function ensurePlatformLeadForClaim(input: {
  targetOrgId: string
  targetUserId: string
  businessName: string
  contactName: string
  contactEmail: string
  sourceOrgId: string
  resourceType: ClaimableResourceType
  resourceId: string
}): Promise<{ companyId: string; contactId: string; dealId?: string } | null> {
  const platformOrgId = await resolvePlatformOwnerOrgId()
  const company = await ensurePlatformCompanyForOrg({
    clientOrgId: input.targetOrgId,
    businessName: input.businessName,
    platformOrgId,
    lifecycleStage: 'lead',
    source: 'claimable_relationship',
    tags: ['organic-platform-lead'],
  })
  const contact = await syncPlatformContactForOrgMember({
    clientOrgId: input.targetOrgId,
    uid: input.targetUserId,
    email: input.contactEmail,
    displayName: input.contactName,
    clientOrg: { name: input.businessName },
    platformOrgId,
  })
  if (!contact) return null

  const pipeline = await getDefaultPipelineForOrg(platformOrgId) ??
    await bootstrapDefaultPipeline(platformOrgId, AGENT_PIP_REF)
  const firstOpenStage = pipeline.stages.find((stage) => stage.kind === 'open') ?? pipeline.stages[0]

  const dealsSnap = await adminDb.collection('deals')
    .where('orgId', '==', platformOrgId)
    .limit(1000)
    .get()
  const existingDeal = dealsSnap.docs.find((doc) => {
    const data = doc.data() ?? {}
    return data.companyId === company.companyId &&
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
      title: `${company.companyName} - PiB service opportunity`,
      contactId: contact.contactId,
      companyId: company.companyId,
      companyName: company.companyName,
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
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      deleted: false,
    })
  } else if (existingDeal) {
    await existingDeal.ref.set({
      updatedAt: Timestamp.now(),
    }, { merge: true })
  }

  await adminDb.collection('contacts').doc(contact.contactId).set({
    tags: FieldValue.arrayUnion('organic-platform-lead'),
    updatedAt: Timestamp.now(),
  }, { merge: true })

  return { companyId: company.companyId, contactId: contact.contactId, dealId }
}
