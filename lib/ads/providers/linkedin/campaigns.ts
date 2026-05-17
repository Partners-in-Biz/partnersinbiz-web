// lib/ads/providers/linkedin/campaigns.ts
// LinkedIn Campaign Group CRUD = canonical AdCampaign — Sub-3b Phase 2 Batch 2A.
// Wraps /rest/adAccounts/{accountId}/adCampaignGroups.

import type { AdCampaign } from '@/lib/ads/types'
import {
  LINKEDIN_ADS_API_BASE,
  LINKEDIN_ADS_VERSION,
} from './constants'
import {
  linkedinStatusFromCanonical,
  linkedinMoneyFromMajor,
  type LinkedinEntityStatus,
} from './mappers'
import { composeUrn, urnId } from './urn'

export interface LinkedinCallArgs {
  accountUrn: string  // urn:li:sponsoredAccount:{id}
  accessToken: string
  version?: string  // override LinkedIn-Version header (default: LINKEDIN_ADS_VERSION)
}

export interface CampaignGroupResult {
  /** Full URN: urn:li:sponsoredCampaignGroup:{id} */
  urn: string
  /** Numeric id (parsed from URN) */
  id: string
}

function buildHeaders(args: LinkedinCallArgs, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${args.accessToken}`,
    'LinkedIn-Version': args.version ?? LINKEDIN_ADS_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  }
}

/** Extract the numeric id LinkedIn returns in either the X-RestLi-Id header or the Location header. */
function extractCreatedId(res: Response): string {
  // Preferred: X-RestLi-Id
  const headerId = res.headers.get('X-RestLi-Id')
  if (headerId) return headerId

  // Fallback: parse from Location header
  const loc = res.headers.get('Location')
  if (loc) {
    const segments = loc.split('/')
    const last = segments[segments.length - 1]
    if (last) return last
  }
  throw new Error('LinkedIn create response missing both X-RestLi-Id and Location headers')
}

/** Create a LinkedIn Campaign Group. */
export async function createCampaignGroup(
  args: LinkedinCallArgs & {
    canonical: AdCampaign
    /** Major-currency total budget cap (e.g. 100.50). Optional — Campaign Groups can run without a group-level cap. */
    totalBudgetMajor?: number
    /** ISO currency code (default 'USD'). */
    currencyCode?: string
  },
): Promise<CampaignGroupResult> {
  const accountNumericId = urnId(args.accountUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/adCampaignGroups`

  const status: LinkedinEntityStatus = linkedinStatusFromCanonical(args.canonical.status)

  const body: Record<string, unknown> = {
    account: args.accountUrn,
    name: args.canonical.name,
    status,
    test: false,  // not a "test" campaign group
  }
  if (args.totalBudgetMajor !== undefined) {
    body.totalBudget = linkedinMoneyFromMajor(args.totalBudgetMajor, args.currencyCode ?? 'USD')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn campaign group create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('sponsoredCampaignGroup', id), id }
}

/** Partial-update an existing Campaign Group. Pass only the fields you want to change. */
export async function updateCampaignGroup(
  args: LinkedinCallArgs & {
    groupUrn: string
    patch: Partial<{
      name: string
      status: LinkedinEntityStatus
      totalBudget: { amount: string; currencyCode: string }
    }>
  },
): Promise<void> {
  const accountNumericId = urnId(args.accountUrn)
  const groupId = urnId(args.groupUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/adCampaignGroups/${groupId}`

  const body = { patch: { $set: args.patch } }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args, { 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`LinkedIn campaign group update failed: HTTP ${res.status} — ${text}`)
  }
}

/** Convenience: flip status to PAUSED. */
export async function pauseCampaignGroup(
  args: LinkedinCallArgs & { groupUrn: string },
): Promise<void> {
  return updateCampaignGroup({ ...args, patch: { status: 'PAUSED' } })
}

/** Convenience: flip status to ACTIVE. */
export async function resumeCampaignGroup(
  args: LinkedinCallArgs & { groupUrn: string },
): Promise<void> {
  return updateCampaignGroup({ ...args, patch: { status: 'ACTIVE' } })
}

/** Convenience: flip status to ARCHIVED. */
export async function archiveCampaignGroup(
  args: LinkedinCallArgs & { groupUrn: string },
): Promise<void> {
  return updateCampaignGroup({ ...args, patch: { status: 'ARCHIVED' } })
}
