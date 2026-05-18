// lib/ads/providers/google/campaigns-pmax.ts
// Google Ads Performance Max campaign CRUD helper — Sub-3a-ext.
// Wraps `customers/{cid}/campaigns:mutate` and `customers/{cid}/campaignBudgets:mutate`.
// Pmax uses advertisingChannelType: 'PERFORMANCE_MAX' with NO subType or networkSettings.

import type { AdCampaign } from '@/lib/ads/types'
import { GOOGLE_ADS_API_BASE_URL } from './constants'
import { googleEntityStatusFromCanonical, microsFromMajor } from './mappers'

interface CallArgs {
  customerId: string  // 10-digit, no dashes
  accessToken: string
  developerToken: string
  loginCustomerId?: string
}

interface GoogleMutateResult {
  resourceName: string
  id: string  // last segment of resourceName
}

function buildHeaders(args: CallArgs): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    'developer-token': args.developerToken,
    'Content-Type': 'application/json',
  }
  if (args.loginCustomerId) h['login-customer-id'] = args.loginCustomerId
  return h
}

async function googleMutate<T>(args: CallArgs & { resource: string; body: unknown }): Promise<T> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/${args.resource}:mutate`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(args.body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Pmax ${args.resource} mutate failed: HTTP ${res.status} — ${text}`)
  }
  return (await res.json()) as T
}

function extractId(rn: string): string {
  return rn.split('/').pop() ?? ''
}

export type PmaxBiddingStrategy =
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CONVERSION_VALUE'
  | 'TARGET_CPA'
  | 'TARGET_ROAS'

// ─── Shared internal helpers ──────────────────────────────────────────────────

/** Create a campaign budget and return its resourceName. */
async function createCampaignBudget(
  args: CallArgs & { campaignName: string; dailyBudgetMajor?: number },
): Promise<string> {
  const budgetBody = {
    operations: [
      {
        create: {
          name: `${args.campaignName} budget`,
          amountMicros: microsFromMajor(args.dailyBudgetMajor ?? 10),  // default $10/day
          deliveryMethod: 'STANDARD',
        },
      },
    ],
  }
  const budgetRes = await googleMutate<{ results: Array<{ resourceName: string }> }>({
    ...args,
    resource: 'campaignBudgets',
    body: budgetBody,
  })
  const budgetResourceName = budgetRes.results[0]?.resourceName
  if (!budgetResourceName) throw new Error('Pmax budget creation returned no resourceName')
  return budgetResourceName
}

/** Build the bidding strategy payload for a Pmax-style campaign. */
function buildBiddingPayload(
  strategy: PmaxBiddingStrategy,
  targetCpaMajor?: number,
  targetRoas?: number,
): Record<string, unknown> {
  const biddingPayload: Record<string, unknown> = {}
  if (strategy === 'MAXIMIZE_CONVERSIONS') {
    biddingPayload.maximizeConversions = targetCpaMajor !== undefined
      ? { targetCpaMicros: microsFromMajor(targetCpaMajor) }
      : {}
  } else if (strategy === 'MAXIMIZE_CONVERSION_VALUE') {
    biddingPayload.maximizeConversionValue = targetRoas !== undefined
      ? { targetRoas }
      : {}
  } else if (strategy === 'TARGET_CPA') {
    biddingPayload.targetCpa = { targetCpaMicros: microsFromMajor(targetCpaMajor ?? 10) }
  } else if (strategy === 'TARGET_ROAS') {
    biddingPayload.targetRoas = { targetRoas: targetRoas ?? 1.0 }
  }
  return biddingPayload
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Create a Performance Max campaign. Returns Google resource name + id. */
export async function createPmaxCampaign(
  args: CallArgs & {
    canonical: AdCampaign
    dailyBudgetMajor?: number
    biddingStrategy?: PmaxBiddingStrategy
    /** Applies to MAXIMIZE_CONVERSIONS or TARGET_CPA bidding; converted to micros. */
    targetCpaMajor?: number
    /** Applies to MAXIMIZE_CONVERSION_VALUE or TARGET_ROAS; fractional (e.g. 4.0 = 400%). */
    targetRoas?: number
  },
): Promise<GoogleMutateResult> {
  // Step 1: Create a campaign budget (required before campaign creation)
  const budgetResourceName = await createCampaignBudget({
    ...args,
    campaignName: args.canonical.name,
  })

  // Step 2: Build bidding strategy payload
  const strategy = args.biddingStrategy ?? 'MAXIMIZE_CONVERSIONS'
  const biddingPayload = buildBiddingPayload(strategy, args.targetCpaMajor, args.targetRoas)

  // Step 3: Create the Pmax campaign — no advertisingChannelSubType, no networkSettings
  const campaignBody = {
    operations: [
      {
        create: {
          name: args.canonical.name,
          status: googleEntityStatusFromCanonical(args.canonical.status),
          advertisingChannelType: 'PERFORMANCE_MAX',
          campaignBudget: budgetResourceName,
          ...biddingPayload,
        },
      },
    ],
  }
  const campaignRes = await googleMutate<{ results: Array<{ resourceName: string }> }>({
    ...args,
    resource: 'campaigns',
    body: campaignBody,
  })
  const resourceName = campaignRes.results[0]?.resourceName
  if (!resourceName) throw new Error('Pmax campaign creation returned no resourceName')
  return { resourceName, id: extractId(resourceName) }
}

/** Create a Pmax campaign configured for retail with Merchant Center feed (Smart Shopping). */
export async function createSmartShoppingCampaign(
  args: CallArgs & {
    canonical: AdCampaign
    dailyBudgetMajor?: number
    /** Default MAXIMIZE_CONVERSION_VALUE for Smart Shopping. */
    biddingStrategy?: PmaxBiddingStrategy
    targetCpaMajor?: number
    /** Default 4.0 (400% ROAS) for Smart Shopping. */
    targetRoas?: number
    /** Required — Merchant Center account numeric id. */
    merchantId: string
    /** Required — Merchant Center feed label (region label, e.g. 'US'). */
    feedLabel: string
    /** Optional ISO 3166-1 alpha-2 sales country (e.g. 'US'). */
    salesCountry?: string
  },
): Promise<GoogleMutateResult> {
  // Step 1: Budget
  const budgetResourceName = await createCampaignBudget({
    ...args,
    campaignName: args.canonical.name,
  })

  // Step 2: Bidding — Smart Shopping defaults to MAXIMIZE_CONVERSION_VALUE + targetRoas=4.0
  const strategy = args.biddingStrategy ?? 'MAXIMIZE_CONVERSION_VALUE'
  const targetRoas = args.targetRoas ?? (strategy === 'MAXIMIZE_CONVERSION_VALUE' ? 4.0 : undefined)
  const biddingPayload = buildBiddingPayload(strategy, args.targetCpaMajor, targetRoas)

  // Step 3: Campaign with shoppingSetting to link Merchant Center
  const campaignBody = {
    operations: [{
      create: {
        name: args.canonical.name,
        status: googleEntityStatusFromCanonical(args.canonical.status),
        advertisingChannelType: 'PERFORMANCE_MAX',
        campaignBudget: budgetResourceName,
        shoppingSetting: {
          merchantId: args.merchantId,
          feedLabel: args.feedLabel,
          ...(args.salesCountry ? { salesCountry: args.salesCountry } : {}),
        },
        ...biddingPayload,
      },
    }],
  }
  const campaignRes = await googleMutate<{ results: Array<{ resourceName: string }> }>({
    ...args,
    resource: 'campaigns',
    body: campaignBody,
  })
  const resourceName = campaignRes.results[0]?.resourceName
  if (!resourceName) throw new Error('Smart Shopping campaign creation returned no resourceName')
  return { resourceName, id: extractId(resourceName) }
}

/** Pause a Performance Max campaign. */
export async function pausePmaxCampaign(args: CallArgs & { resourceName: string }): Promise<void> {
  await googleMutate({
    ...args,
    resource: 'campaigns',
    body: {
      operations: [{
        update: { resourceName: args.resourceName, status: 'PAUSED' },
        updateMask: 'status',
      }],
    },
  })
}

/** Resume (enable) a Performance Max campaign. */
export async function resumePmaxCampaign(args: CallArgs & { resourceName: string }): Promise<void> {
  await googleMutate({
    ...args,
    resource: 'campaigns',
    body: {
      operations: [{
        update: { resourceName: args.resourceName, status: 'ENABLED' },
        updateMask: 'status',
      }],
    },
  })
}

/** Remove a Performance Max campaign. */
export async function removePmaxCampaign(args: CallArgs & { resourceName: string }): Promise<void> {
  await googleMutate({
    ...args,
    resource: 'campaigns',
    body: {
      operations: [{ remove: args.resourceName }],
    },
  })
}
