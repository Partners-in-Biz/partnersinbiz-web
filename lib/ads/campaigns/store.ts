// lib/ads/campaigns/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdCampaign, CreateAdCampaignInput, UpdateAdCampaignInput } from '@/lib/ads/types'
import { recordVisibleForOwner, ownerFieldsForWrite, type MarketingOwnerContext } from '@/lib/social/account-scope'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'
import crypto from 'crypto'

const COLLECTION = 'ad_campaigns'

export async function createCampaign(args: {
  orgId: string
  createdBy: string
  input: CreateAdCampaignInput
  platform?: AdCampaign['platform']
  owner?: MarketingOwnerContext
}): Promise<AdCampaign> {
  const id = `cmp_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: AdCampaign = {
    ...args.input,
    id,
    orgId: args.orgId,
    platform: args.platform ?? 'meta',
    providerData: {},
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
    ...(ownerFieldsForWrite(args.owner ?? { owner: 'org' }) as Pick<AdCampaign, 'marketingOwner' | 'workOwner' | 'companyId'>),
    ...(clientVisibilityFieldsForWrite(args.input.clientVisibility) as Pick<AdCampaign, 'clientVisibility'>),
  }

  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getCampaign(id: string): Promise<AdCampaign | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return snap.data() as AdCampaign
}

export async function listCampaigns(args: {
  orgId: string
  status?: AdCampaign['status']
  platform?: AdCampaign['platform']
  owner?: MarketingOwnerContext
}): Promise<AdCampaign[]> {
  let query = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId)

  if (args.status !== undefined) {
    query = query.where('status', '==', args.status)
  }

  if (args.platform !== undefined) {
    query = query.where('platform', '==', args.platform)
  }

  const snap = await query.get()
  return snap.docs
    .map((d) => d.data() as AdCampaign)
    .filter((campaign) => recordVisibleForOwner(campaign, args.owner ?? { owner: 'org' }))
}

export async function updateCampaign(id: string, patch: UpdateAdCampaignInput): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

export async function deleteCampaign(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/**
 * Merges the Meta-side campaign ID into providerData.meta.id.
 * Called after createCampaign on the Meta API returns the remote ID.
 */
export async function setCampaignMetaId(id: string, metaCampaignId: string): Promise<void> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  const current = snap.data() as AdCampaign | undefined
  const existingMeta = current?.providerData?.meta ?? {}

  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      providerData: {
        ...current?.providerData,
        meta: { ...existingMeta, id: metaCampaignId },
      },
      updatedAt: Timestamp.now(),
    })
}
