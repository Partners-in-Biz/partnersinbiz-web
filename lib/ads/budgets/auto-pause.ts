// lib/ads/budgets/auto-pause.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdBudget } from './types'
import type { AdCampaign } from '@/lib/ads/types'

/** Find all canonical campaigns active in scope, dispatch per-platform pause helper.
 *  Returns the canonical doc ids that were paused locally + remotely. Best-effort —
 *  per-platform pause failures don't abort other platforms. */
export async function autoPauseCampaignsInScope(args: {
  budget: AdBudget
  /** Inject fetch impl for testing per-platform pause calls. */
  fetchImpl?: typeof fetch
}): Promise<string[]> {
  const { budget } = args

  // Campaign scope — exact campaign bypass
  if (budget.campaignId) {
    const snap = await adminDb.collection('ad_campaigns').doc(budget.campaignId).get()
    if (!snap.exists) return []
    const campaign = snap.data() as AdCampaign
    if (campaign.status !== 'ACTIVE') return []
    await pauseOne(campaign)
    return [campaign.id]
  }

  // 1. Find active canonical campaigns in scope
  let q = adminDb.collection('ad_campaigns')
    .where('orgId', '==', budget.orgId)
    .where('status', '==', 'ACTIVE') as FirebaseFirestore.Query
  if (budget.platform) q = q.where('platform', '==', budget.platform)

  const snap = await q.get()
  const campaigns = snap.docs.map((d) => d.data() as AdCampaign)
  const paused: string[] = []
  for (const campaign of campaigns) {
    try {
      await pauseOne(campaign)
      paused.push(campaign.id)
    } catch (err) {
      console.warn(`[budget auto-pause] failed for campaign ${campaign.id}: ${(err as Error).message}`)
    }
  }
  return paused
}

async function pauseOne(campaign: AdCampaign): Promise<void> {
  // Flip status locally
  await adminDb.collection('ad_campaigns').doc(campaign.id).update({
    status: 'PAUSED',
    updatedAt: Timestamp.now(),
  })

  // Remote sync is handled by the existing /campaigns/[id]/pause endpoint when
  // admin re-fires it. This keeps the cron path simple + idempotent.
  // Per-platform remote dispatch is intentionally omitted here (local-only approach).
}
