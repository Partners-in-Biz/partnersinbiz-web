// lib/ads/identities/store.ts
// Canonical store for the ad_identities collection introduced in Sub-3c TikTok Phase 2.
// Currently only TikTok populates this; the abstraction allows future LinkedIn/Meta
// poster-identity entities to land in the same collection with a `platform` field.

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { AdPlatform } from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'ad_identities'

export interface AdIdentity {
  id: string
  orgId: string
  platform: AdPlatform
  /** Provider account id (TikTok advertiser_id, Meta page_id, LinkedIn organization URN, etc) */
  accountId: string
  /** Provider identity id */
  identityId: string
  /** Provider identity type discriminator */
  identityType: string
  displayName?: string
  profileImageUrl?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export async function upsertIdentity(args: {
  orgId: string
  platform: AdPlatform
  accountId: string
  identityId: string
  identityType: string
  displayName?: string
  profileImageUrl?: string
}): Promise<AdIdentity> {
  // Deterministic id: hash(orgId|platform|accountId|identityId) keeps upsert simple
  const hash = crypto
    .createHash('sha1')
    .update(`${args.orgId}|${args.platform}|${args.accountId}|${args.identityId}`)
    .digest('hex')
    .slice(0, 24)
  const id = `id_${hash}`
  const now = Timestamp.now()

  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()

  if (snap.exists) {
    await ref.update({
      identityType: args.identityType,
      displayName: args.displayName ?? FieldValue.delete(),
      profileImageUrl: args.profileImageUrl ?? FieldValue.delete(),
      updatedAt: now,
    })
    const updated = (await ref.get()).data() as AdIdentity
    return updated
  }

  const doc: AdIdentity = {
    id,
    orgId: args.orgId,
    platform: args.platform,
    accountId: args.accountId,
    identityId: args.identityId,
    identityType: args.identityType,
    displayName: args.displayName,
    profileImageUrl: args.profileImageUrl,
    createdAt: now,
    updatedAt: now,
  }
  // Strip undefined fields before write
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (v !== undefined) cleaned[k] = v
  }
  await ref.set(cleaned)
  return doc
}

export async function listIdentities(args: {
  orgId: string
  platform?: AdPlatform
  accountId?: string
}): Promise<AdIdentity[]> {
  let q = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId) as FirebaseFirestore.Query
  if (args.platform) q = q.where('platform', '==', args.platform)
  if (args.accountId) q = q.where('accountId', '==', args.accountId)
  const snap = await q.get()
  return snap.docs.map((d) => d.data() as AdIdentity)
}

export async function getIdentity(id: string): Promise<AdIdentity | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  return snap.exists ? (snap.data() as AdIdentity) : null
}
