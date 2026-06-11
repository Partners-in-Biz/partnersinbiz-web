// lib/ads/creatives/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type {
  AdCreative,
  AdCreativeType,
  AdPlatform,
  CreateAdCreativeInput,
  PlatformCreativeRef,
  UpdateAdCreativeInput,
} from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'ad_creatives'

export async function createCreative(args: {
  orgId: string
  createdBy: string
  input: CreateAdCreativeInput
  /** Optional explicit ID — used by upload-url flow so the signed URL and Firestore doc share the same ID. */
  id?: string
}): Promise<AdCreative> {
  const id = args.id ?? `crv_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  let versionGroupId = id
  let versionNumber = 1

  if (args.input.supersedes) {
    const previousRef = adminDb.collection(COLLECTION).doc(args.input.supersedes)
    const previousSnap = await previousRef.get()
    if (!previousSnap.exists) {
      throw new Error('Superseded creative not found')
    }

    const previous = previousSnap.data() as AdCreative
    if (previous.orgId !== args.orgId) {
      throw new Error('Cannot supersede creative outside the active org')
    }

    versionGroupId = previous.versionGroupId ?? previous.id
    versionNumber = (previous.versionNumber ?? 1) + 1

    await previousRef.update({
      isLatest: false,
      updatedAt: now,
    })
  }

  const doc: AdCreative = {
    ...args.input,
    id,
    orgId: args.orgId,
    sourceOrgId: args.input.sourceOrgId ?? args.orgId,
    approvalStatus: args.input.approvalStatus ?? 'draft',
    versionGroupId,
    versionNumber,
    isLatest: true,
    platformRefs: {},
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getCreative(id: string): Promise<AdCreative | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as AdCreative
}

export async function listCreatives(args: {
  orgId: string
  type?: AdCreativeType
  status?: AdCreative['status']
  includeArchived?: boolean
}): Promise<AdCreative[]> {
  let query = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId)

  if (args.type !== undefined) {
    query = query.where('type', '==', args.type)
  }

  if (args.status !== undefined) {
    query = query.where('status', '==', args.status)
  }

  const snap = await query.get()
  const results = snap.docs.map((d) => d.data() as AdCreative)

  // Exclude ARCHIVED by default unless includeArchived is set
  if (!args.includeArchived) {
    return results.filter((c) => c.status !== 'ARCHIVED')
  }

  return results
}

export async function updateCreative(id: string, patch: UpdateAdCreativeInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

/**
 * Soft-delete: sets status to ARCHIVED and stamps archivedAt.
 * The doc remains in Firestore for audit purposes.
 */
export async function archiveCreative(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).update({
    status: 'ARCHIVED',
    archivedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

/**
 * Merges a platform-specific ref into platformRefs[platform].
 * Called after a successful creative sync to Meta (or other platforms in future).
 */
export async function setPlatformRef(
  id: string,
  platform: AdPlatform,
  ref: PlatformCreativeRef,
): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as AdCreative | undefined
  const existingRefs = current?.platformRefs ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      platformRefs: {
        ...existingRefs,
        [platform]: ref,
      },
      updatedAt: Timestamp.now(),
    })
}
