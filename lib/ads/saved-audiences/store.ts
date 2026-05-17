// lib/ads/saved-audiences/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type {
  AdSavedAudience,
  CreateAdSavedAudienceInput,
  UpdateAdSavedAudienceInput,
} from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'saved_audiences'

export async function createSavedAudience(args: {
  orgId: string
  createdBy: string
  input: CreateAdSavedAudienceInput
  /** Which ad platform this saved audience belongs to. Defaults to 'meta' for backwards compat. */
  platform?: import('@/lib/ads/types').AdPlatform
  /** Optional explicit ID — allows callers to pre-generate IDs. */
  id?: string
}): Promise<AdSavedAudience> {
  const id = args.id ?? `sav_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: AdSavedAudience = {
    ...args.input,
    id,
    orgId: args.orgId,
    platform: args.platform ?? 'meta',
    providerData: {},
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getSavedAudience(id: string): Promise<AdSavedAudience | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as AdSavedAudience
}

export async function listSavedAudiences(args: { orgId: string }): Promise<AdSavedAudience[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('orgId', '==', args.orgId)
    .get()

  const results = snap.docs.map((d) => d.data() as AdSavedAudience)

  // Sort by updatedAt desc (in-memory; production index handles this)
  return results.sort((a, b) => {
    const aT = (a.updatedAt as Timestamp).seconds ?? 0
    const bT = (b.updatedAt as Timestamp).seconds ?? 0
    return bT - aT
  })
}

export async function updateSavedAudience(id: string, patch: UpdateAdSavedAudienceInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

/**
 * Hard delete — saved audiences are reusable targeting templates with no
 * audit requirement; hard deletion keeps the store clean.
 */
export async function deleteSavedAudience(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/**
 * Merges Meta's savedAudienceId into providerData.meta after the audience
 * has been pushed to Meta's Ads API.
 */
export async function setSavedAudienceMetaId(id: string, metaSavId: string): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as AdSavedAudience | undefined
  const existingMeta = current?.providerData?.meta ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      providerData: {
        meta: {
          ...existingMeta,
          savedAudienceId: metaSavId,
        },
      },
      updatedAt: Timestamp.now(),
    })
}
