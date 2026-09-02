// lib/ads/adsets/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdSet, CreateAdSetInput, UpdateAdSetInput } from '@/lib/ads/types'
import { clientVisibilityFieldsForWrite, recordVisibleForWorkScope, type WorkScope } from '@/lib/work-scope'
import crypto from 'crypto'

const COLLECTION = 'ad_sets'

export async function createAdSet(args: {
  orgId: string
  input: CreateAdSetInput
  platform?: AdSet['platform']
  /** Scope stamp inherited from the parent campaign (companyId/workOwner/marketingOwner). */
  scopeFields?: Record<string, unknown>
}): Promise<AdSet> {
  const id = `ads_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: AdSet = {
    ...args.input,
    id,
    orgId: args.orgId,
    platform: args.platform ?? 'meta',
    providerData: {},
    createdAt: now,
    updatedAt: now,
    ...(args.scopeFields as Pick<AdSet, 'marketingOwner' | 'workOwner' | 'companyId'> | undefined),
    ...(clientVisibilityFieldsForWrite(args.input.clientVisibility) as Pick<AdSet, 'clientVisibility'>),
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getAdSet(id: string): Promise<AdSet | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as AdSet
}

export async function listAdSets(args: {
  orgId: string
  campaignId?: string
  status?: AdSet['status']
  scope?: WorkScope
}): Promise<AdSet[]> {
  let query = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId)

  if (args.campaignId !== undefined) {
    query = query.where('campaignId', '==', args.campaignId)
  }

  if (args.status !== undefined) {
    query = query.where('status', '==', args.status)
  }

  const snap = await query.get()
  const rows = snap.docs.map((d) => d.data() as AdSet)
  return args.scope ? rows.filter((row) => recordVisibleForWorkScope(row, args.scope!)) : rows
}

export async function updateAdSet(id: string, patch: UpdateAdSetInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

export async function deleteAdSet(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/**
 * Merges the Meta-side ad set ID into providerData.meta.id.
 * Called after createAdSet on the Meta API returns the remote ID.
 */
export async function setAdSetMetaId(id: string, metaAdSetId: string): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as AdSet | undefined
  const existingMeta = current?.providerData?.meta ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      providerData: {
        ...current?.providerData,
        meta: { ...existingMeta, id: metaAdSetId },
      },
      updatedAt: Timestamp.now(),
    })
}
