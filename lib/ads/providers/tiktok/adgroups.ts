// lib/ads/providers/tiktok/adgroups.ts
// TikTok AdGroup CRUD = canonical AdSet — Sub-3c Phase 2 Batch 2B.
// Wraps /adgroup/create/, /adgroup/update/, /adgroup/status/update/.
// TikTok AdGroup ≡ PiB AdSet (parent: TikTok Campaign ≡ PiB AdCampaign).

import type { AdSet } from '@/lib/ads/types'
import { createTiktokAdsClient } from './client'
import {
  tiktokStatusFromCanonical,
  tiktokBudgetFromMajor,
  defaultOptimizationGoal,
  tiktokTargetingFromCanonical,
  type TiktokEntityStatus,
} from './mappers'
import type {
  TiktokOptimizationGoal,
  TiktokTargeting,
  TiktokObjective,
} from './types'

// ─── Call arg types ───────────────────────────────────────────────────────────

export interface TiktokAdGroupCallArgs {
  advertiserId: string
  accessToken: string
  fetchImpl?: typeof fetch
}

export interface TiktokAdGroupResult {
  /** Numeric string as returned by TikTok API. */
  adgroupId: string
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a TikTok AdGroup (PiB AdSet).
 *
 * Required caller inputs:
 *  - canonical: AdSet with at minimum name + status
 *  - campaignId: parent TikTok campaign numeric id string
 *  - objective: TikTok objective of the parent campaign — used to default optimization_goal
 *
 * Optional (all have sensible defaults):
 *  - optimizationGoal: defaults via defaultOptimizationGoal(objective)
 *  - billingEvent: defaults to 'CPC'
 *  - bidType: defaults to 'BID_TYPE_NO_BID'
 *  - bidPriceMajor: only sent when bidType = 'BID_TYPE_CUSTOM'
 *  - budgetMajor: when omitted, budgetMode defaults to BUDGET_MODE_INFINITE
 *  - budgetMode: defaults to INFINITE when no budgetMajor; DAY when budgetMajor provided
 *  - pacing: defaults to 'PACING_MODE_SMOOTH'
 *  - placements: when omitted, placement_type is AUTOMATIC; when provided, NORMAL
 *  - scheduleStartTime / scheduleEndTime: 'YYYY-MM-DD HH:MM:SS' UTC
 *  - tkTargeting: pre-mapped TikTok targeting extension (overrides / extends canonical targeting)
 */
export async function createAdGroup(
  args: TiktokAdGroupCallArgs & {
    canonical: AdSet
    campaignId: string
    objective: TiktokObjective
    optimizationGoal?: TiktokOptimizationGoal
    billingEvent?: 'CPC' | 'CPM' | 'OCPM' | 'CPV'
    bidType?: 'BID_TYPE_NO_BID' | 'BID_TYPE_CUSTOM'
    bidPriceMajor?: number
    budgetMajor?: number
    budgetMode?: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL' | 'BUDGET_MODE_INFINITE'
    pacing?: 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST'
    placements?: ('PLACEMENT_TIKTOK' | 'PLACEMENT_PANGLE' | 'PLACEMENT_TOPBUZZ')[]
    scheduleStartTime?: string
    scheduleEndTime?: string
    tkTargeting?: TiktokTargeting
  },
): Promise<TiktokAdGroupResult> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })

  const placementType = args.placements && args.placements.length > 0
    ? 'PLACEMENT_TYPE_NORMAL'
    : 'PLACEMENT_TYPE_AUTOMATIC'
  const optimizationGoal = args.optimizationGoal ?? defaultOptimizationGoal(args.objective)
  const billingEvent = args.billingEvent ?? 'CPC'
  const bidType = args.bidType ?? 'BID_TYPE_NO_BID'
  const budgetMode = args.budgetMode ?? (args.budgetMajor === undefined ? 'BUDGET_MODE_INFINITE' : 'BUDGET_MODE_DAY')
  const pacing = args.pacing ?? 'PACING_MODE_SMOOTH'
  const scheduleType = args.scheduleEndTime ? 'SCHEDULE_START_END' : 'SCHEDULE_FROM_NOW'

  const targeting = tiktokTargetingFromCanonical(args.canonical.targeting, args.tkTargeting)

  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    campaign_id: args.campaignId,
    adgroup_name: args.canonical.name,
    placement_type: placementType,
    optimization_goal: optimizationGoal,
    billing_event: billingEvent,
    bid_type: bidType,
    budget_mode: budgetMode,
    pacing,
    schedule_type: scheduleType,
    operation_status: tiktokStatusFromCanonical(args.canonical.status),
    targeting,
  }

  if (placementType === 'PLACEMENT_TYPE_NORMAL' && args.placements) {
    body.placements = args.placements
  }

  if (bidType === 'BID_TYPE_CUSTOM' && args.bidPriceMajor !== undefined) {
    body.bid_price = tiktokBudgetFromMajor(args.bidPriceMajor)
  }

  if (budgetMode !== 'BUDGET_MODE_INFINITE' && args.budgetMajor !== undefined) {
    body.budget = tiktokBudgetFromMajor(args.budgetMajor)
  }

  if (args.scheduleStartTime) body.schedule_start_time = args.scheduleStartTime
  if (args.scheduleEndTime) body.schedule_end_time = args.scheduleEndTime

  const data = await client.post<{ adgroup_id: string }>('/adgroup/create/', body)
  return { adgroupId: String(data.adgroup_id) }
}

// ─── Update ───────────────────────────────────────────────────────────────────

/** Partial-update a TikTok AdGroup. Pass only the fields you want to change. */
export async function updateAdGroup(
  args: TiktokAdGroupCallArgs & {
    adgroupId: string
    patch: {
      name?: string
      budgetMajor?: number
      bidPriceMajor?: number
      targeting?: TiktokTargeting
    }
  },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    adgroup_id: args.adgroupId,
  }
  if (args.patch.name !== undefined) body.adgroup_name = args.patch.name
  if (args.patch.budgetMajor !== undefined) body.budget = tiktokBudgetFromMajor(args.patch.budgetMajor)
  if (args.patch.bidPriceMajor !== undefined) body.bid_price = tiktokBudgetFromMajor(args.patch.bidPriceMajor)
  if (args.patch.targeting !== undefined) body.targeting = args.patch.targeting
  await client.post('/adgroup/update/', body)
}

// ─── Status helpers ───────────────────────────────────────────────────────────

async function setAdGroupStatus(
  args: TiktokAdGroupCallArgs & { adgroupId: string; status: TiktokEntityStatus },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  await client.post('/adgroup/status/update/', {
    advertiser_id: args.advertiserId,
    adgroup_ids: [args.adgroupId],
    operation_status: args.status,
  })
}

/** Pause a TikTok AdGroup (sets operation_status to DISABLE). */
export async function pauseAdGroup(args: TiktokAdGroupCallArgs & { adgroupId: string }): Promise<void> {
  return setAdGroupStatus({ ...args, status: 'DISABLE' })
}

/** Resume a TikTok AdGroup (sets operation_status to ENABLE). */
export async function resumeAdGroup(args: TiktokAdGroupCallArgs & { adgroupId: string }): Promise<void> {
  return setAdGroupStatus({ ...args, status: 'ENABLE' })
}

/** Archive (delete) a TikTok AdGroup (sets operation_status to DELETE). */
export async function archiveAdGroup(args: TiktokAdGroupCallArgs & { adgroupId: string }): Promise<void> {
  return setAdGroupStatus({ ...args, status: 'DELETE' })
}
