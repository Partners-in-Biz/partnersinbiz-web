// lib/ads/custom-audiences/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type {
  AdCustomAudience,
  AdCustomAudienceStatus,
  AdCustomAudienceType,
  AdPlatform,
  CreateAdCustomAudienceInput,
  UpdateAdCustomAudienceInput,
} from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'custom_audiences'

export async function createCustomAudience(args: {
  orgId: string
  createdBy: string
  /** Which ad platform this audience belongs to. */
  platform: AdPlatform
  input: CreateAdCustomAudienceInput
  /** Optional explicit ID — allows pre-generating an ID before upload. */
  id?: string
}): Promise<AdCustomAudience> {
  const id = args.id ?? `ca_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: AdCustomAudience = {
    ...args.input,
    id,
    orgId: args.orgId,
    platform: args.platform,
    providerData: {},
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getCustomAudience(id: string): Promise<AdCustomAudience | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as AdCustomAudience
}

export async function listCustomAudiences(args: {
  orgId: string
  type?: AdCustomAudienceType
  status?: AdCustomAudienceStatus
}): Promise<AdCustomAudience[]> {
  let query = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId)

  if (args.type !== undefined) {
    query = query.where('type', '==', args.type)
  }

  if (args.status !== undefined) {
    query = query.where('status', '==', args.status)
  }

  const snap = await query.get()
  const results = snap.docs.map((d) => d.data() as AdCustomAudience)

  // Sort by updatedAt desc (in-memory; production index handles this)
  return results.sort((a, b) => {
    const aT = (a.updatedAt as Timestamp).seconds ?? 0
    const bT = (b.updatedAt as Timestamp).seconds ?? 0
    return bT - aT
  })
}

export async function updateCustomAudience(id: string, patch: UpdateAdCustomAudienceInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

/**
 * Hard delete — CAs can be recreated from the same source so a soft-delete
 * tombstone adds no value here (unlike creatives).
 */
export async function deleteCustomAudience(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/**
 * Merges Meta's customAudienceId into providerData.meta after the audience
 * has been created on Meta's side.
 */
export async function setCustomAudienceMetaId(id: string, metaCaId: string): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as AdCustomAudience | undefined
  const existingMeta = current?.providerData?.meta ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      providerData: {
        meta: {
          ...existingMeta,
          customAudienceId: metaCaId,
        },
      },
      updatedAt: Timestamp.now(),
    })
}
