import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { AudienceDefinition, AudienceEstimate, AudienceVersion } from './audience-types'
import { computeMembershipDelta, hashAudienceDefinition } from './audience-snapshot'

const COLLECTION = 'email_audience_versions'
const WRITE_BATCH_SIZE = 400

async function listProgramVersions(orgId: string, programId: string): Promise<AudienceVersion[]> {
  const snapshot = await adminDb.collection(COLLECTION).where('orgId', '==', orgId).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as AudienceVersion)
    .filter((item) => item.programId === programId)
    .sort((left, right) => right.version - left.version)
}

async function eligibleMembers(versionId: string): Promise<string[]> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .doc(versionId)
    .collection('members')
    .where('status', '==', 'eligible')
    .get()
  return snapshot.docs.map((doc) => doc.id)
}

export async function createAudienceVersion(input: {
  orgId: string
  programId: string
  createdBy: string
  definition: AudienceDefinition
  estimate: AudienceEstimate
}): Promise<{ id: string; version: number; membershipDelta: AudienceVersion['membershipDelta'] }> {
  if (!input.orgId || !input.programId || !input.createdBy) throw new Error('Missing audience version scope')
  const existing = await listProgramVersions(input.orgId, input.programId)
  const previous = existing[0]
  const previousIds = previous ? await eligibleMembers(previous.id) : []
  const membershipDelta = computeMembershipDelta(previousIds, input.estimate.eligibleContactIds)
  const version = (previous?.version ?? 0) + 1
  const ref = adminDb.collection(COLLECTION).doc()

  await ref.set({
    orgId: input.orgId,
    programId: input.programId,
    version,
    schemaVersion: input.definition.schemaVersion,
    definition: input.definition,
    definitionHash: hashAudienceDefinition(input.definition),
    candidateCount: input.estimate.totalCandidates,
    eligibleCount: input.estimate.eligibleCount,
    holdoutCount: input.estimate.holdoutCount,
    excludedCounts: input.estimate.excludedCounts,
    previousVersionId: previous?.id ?? null,
    membershipDelta,
    buildStatus: 'building',
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
  })

  const membership = new Map<string, { status: 'eligible' | 'holdout' | 'excluded'; reason?: string }>()
  for (const contactId of input.estimate.eligibleContactIds) membership.set(contactId, { status: 'eligible' })
  for (const contactId of input.estimate.holdoutContactIds) membership.set(contactId, { status: 'holdout', reason: 'holdout' })
  for (const exclusion of input.estimate.exclusions) {
    if (!membership.has(exclusion.contactId)) {
      membership.set(exclusion.contactId, { status: 'excluded', reason: exclusion.reason })
    }
  }

  const entries = [...membership.entries()]
  for (let index = 0; index < entries.length; index += WRITE_BATCH_SIZE) {
    const batch = adminDb.batch()
    for (const [contactId, state] of entries.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.set(ref.collection('members').doc(contactId), {
        orgId: input.orgId,
        programId: input.programId,
        audienceVersionId: ref.id,
        contactId,
        ...state,
      })
    }
    await batch.commit()
  }

  await ref.update({ buildStatus: 'complete', completedAt: FieldValue.serverTimestamp() })
  return { id: ref.id, version, membershipDelta }
}

export async function getAudienceVersions(orgId: string, programId?: string): Promise<AudienceVersion[]> {
  const snapshot = await adminDb.collection(COLLECTION).where('orgId', '==', orgId).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as AudienceVersion)
    .filter((item) => !programId || item.programId === programId)
    .sort((left, right) => {
      if (left.programId === right.programId) return right.version - left.version
      return left.programId.localeCompare(right.programId)
    })
}
