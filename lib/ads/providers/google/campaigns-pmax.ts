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
  const budgetBody = {
    operations: [
      {
        create: {
          name: `${args.canonical.name} budget`,
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

  // Step 2: Build bidding strategy payload
  const strategy = args.biddingStrategy ?? 'MAXIMIZE_CONVERSIONS'
  const biddingPayload: Record<string, unknown> = {}
  if (strategy === 'MAXIMIZE_CONVERSIONS') {
    biddingPayload.maximizeConversions = args.targetCpaMajor !== undefined
      ? { targetCpaMicros: microsFromMajor(args.targetCpaMajor) }
      : {}
  } else if (strategy === 'MAXIMIZE_CONVERSION_VALUE') {
    biddingPayload.maximizeConversionValue = args.targetRoas !== undefined
      ? { targetRoas: args.targetRoas }
      : {}
  } else if (strategy === 'TARGET_CPA') {
    biddingPayload.targetCpa = { targetCpaMicros: microsFromMajor(args.targetCpaMajor ?? 10) }
  } else if (strategy === 'TARGET_ROAS') {
    biddingPayload.targetRoas = { targetRoas: args.targetRoas ?? 1.0 }
  }

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
