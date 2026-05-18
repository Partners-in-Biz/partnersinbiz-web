// lib/ads/providers/tiktok/campaigns.ts
// TikTok Campaign CRUD = canonical AdCampaign — Sub-3c Phase 2 Batch 2A.
// Wraps /campaign/create/, /campaign/update/, /campaign/status/update/.

import type { AdCampaign } from '@/lib/ads/types'
import { createTiktokAdsClient } from './client'
import {
  tiktokStatusFromCanonical,
  tiktokObjectiveFromCanonical,
  tiktokBudgetFromMajor,
} from './mappers'
import type { TiktokEntityStatus } from './types'

export interface TiktokCallArgs {
  advertiserId: string
  accessToken: string
  fetchImpl?: typeof fetch
}

export interface TiktokCampaignResult {
  /** Numeric string as returned by TikTok API. */
  campaignId: string
}

/** Create a TikTok campaign from a canonical AdCampaign. */
export async function createCampaign(
  args: TiktokCallArgs & {
    canonical: AdCampaign
    /** Major-currency budget amount (e.g. 50.00). Optional — when omitted, BUDGET_MODE_INFINITE is used. */
    budgetMajor?: number
    /** Budget mode. Defaults to BUDGET_MODE_INFINITE when no budgetMajor; BUDGET_MODE_DAY when budgetMajor provided. */
    budgetMode?: 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
  },
): Promise<TiktokCampaignResult> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const budgetMode = args.budgetMode ?? (args.budgetMajor === undefined ? 'BUDGET_MODE_INFINITE' : 'BUDGET_MODE_DAY')

  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    campaign_name: args.canonical.name,
    objective_type: tiktokObjectiveFromCanonical(args.canonical.objective),
    budget_mode: budgetMode,
    operation_status: tiktokStatusFromCanonical(args.canonical.status),
  }

  if (args.budgetMajor !== undefined && budgetMode !== 'BUDGET_MODE_INFINITE') {
    body.budget = tiktokBudgetFromMajor(args.budgetMajor)
  }

  const data = await client.post<{ campaign_id: string }>('/campaign/create/', body)
  return { campaignId: String(data.campaign_id) }
}

/** Partial-update a TikTok campaign. Only name + budget are supported per TikTok docs. */
export async function updateCampaign(
  args: TiktokCallArgs & {
    campaignId: string
    patch: { name?: string; budgetMajor?: number }
  },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    campaign_id: args.campaignId,
  }
  if (args.patch.name !== undefined) body.campaign_name = args.patch.name
  if (args.patch.budgetMajor !== undefined) body.budget = tiktokBudgetFromMajor(args.patch.budgetMajor)
  await client.post('/campaign/update/', body)
}

/** Internal helper — set operation_status on one or more campaign ids. */
async function setCampaignStatus(
  args: TiktokCallArgs & { campaignId: string; status: TiktokEntityStatus },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  await client.post('/campaign/status/update/', {
    advertiser_id: args.advertiserId,
    campaign_ids: [args.campaignId],
    operation_status: args.status,
  })
}

/** Pause a TikTok campaign (sets operation_status to DISABLE). */
export async function pauseCampaign(args: TiktokCallArgs & { campaignId: string }): Promise<void> {
  return setCampaignStatus({ ...args, status: 'DISABLE' })
}

/** Resume a TikTok campaign (sets operation_status to ENABLE). */
export async function resumeCampaign(args: TiktokCallArgs & { campaignId: string }): Promise<void> {
  return setCampaignStatus({ ...args, status: 'ENABLE' })
}

/** Archive (delete) a TikTok campaign (sets operation_status to DELETE). */
export async function archiveCampaign(args: TiktokCallArgs & { campaignId: string }): Promise<void> {
  return setCampaignStatus({ ...args, status: 'DELETE' })
}
