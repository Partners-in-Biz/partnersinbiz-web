// lib/ads/ads/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { Ad, CreateAdInput, UpdateAdInput } from '@/lib/ads/types'
import { clientVisibilityFieldsForWrite, recordVisibleForWorkScope, type WorkScope } from '@/lib/work-scope'
import crypto from 'crypto'

const COLLECTION = 'ads'

export async function createAd(args: {
  orgId: string
  input: CreateAdInput
  platform?: Ad['platform']
  /** Scope stamp inherited from the parent ad set (companyId/workOwner/marketingOwner). */
  scopeFields?: Record<string, unknown>
}): Promise<Ad> {
  const id = `ad_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: Ad = {
    ...args.input,
    id,
    orgId: args.orgId,
    platform: args.platform ?? 'meta',
    providerData: {},
    createdAt: now,
    updatedAt: now,
    ...(args.scopeFields as Pick<Ad, 'marketingOwner' | 'workOwner' | 'companyId'> | undefined),
    ...(clientVisibilityFieldsForWrite(args.input.clientVisibility) as Pick<Ad, 'clientVisibility'>),
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getAd(id: string): Promise<Ad | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as Ad
}

export async function listAds(args: {
  orgId: string
  adSetId?: string
  campaignId?: string
  status?: Ad['status']
  scope?: WorkScope
}): Promise<Ad[]> {
  let query = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId)

  if (args.adSetId !== undefined) {
    query = query.where('adSetId', '==', args.adSetId)
  }

  if (args.campaignId !== undefined) {
    query = query.where('campaignId', '==', args.campaignId)
  }

  if (args.status !== undefined) {
    query = query.where('status', '==', args.status)
  }

  const snap = await query.get()
  const rows = snap.docs.map((d) => d.data() as Ad)
  return args.scope ? rows.filter((row) => recordVisibleForWorkScope(row, args.scope!)) : rows
}

export async function updateAd(id: string, patch: UpdateAdInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

export async function deleteAd(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/**
 * Merges both Meta-side IDs into providerData.meta after createAd on Meta API returns.
 * - metaAdId → providerData.meta.adId
 * - metaCreativeId → providerData.meta.creativeId
 */
export async function setAdMetaIds(
  id: string,
  ids: { metaAdId: string; metaCreativeId: string },
): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as Ad | undefined
  const existingMeta = current?.providerData?.meta ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      providerData: {
        ...current?.providerData,
        meta: { ...existingMeta, adId: ids.metaAdId, creativeId: ids.metaCreativeId },
      },
      updatedAt: Timestamp.now(),
    })
}
