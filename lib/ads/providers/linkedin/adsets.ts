// lib/ads/providers/linkedin/adsets.ts
// LinkedIn Campaign CRUD = canonical AdSet — Sub-3b Phase 2 Batch 2B.
// Wraps /rest/adAccounts/{accountId}/adCampaigns.
// LinkedIn Campaign ≡ PiB AdSet (parent: LinkedIn Campaign Group ≡ PiB AdCampaign).

import type { AdSet } from '@/lib/ads/types'
import {
  LINKEDIN_ADS_API_BASE,
  LINKEDIN_ADS_VERSION,
} from './constants'
import {
  linkedinStatusFromCanonical,
  linkedinObjectiveFromCanonical,
  linkedinMoneyFromMajor,
  linkedinTargetingFromCanonical,
  defaultLinkedinCostType,
  type LinkedinEntityStatus,
} from './mappers'
import type { LinkedinAdSetExtension } from './types'
import { composeUrn, urnId } from './urn'

// Re-export LinkedinCallArgs so route layers can import from a single file.
export type { LinkedinCallArgs } from './campaigns'
import type { LinkedinCallArgs } from './campaigns'

// ─── Result type ──────────────────────────────────────────────────────────────

export interface LinkedinCampaignResult {
  /** Full URN: urn:li:sponsoredCampaign:{id} */
  urn: string
  /** Numeric id (parsed from URN) */
  id: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a LinkedIn Campaign (PiB AdSet).
 *
 * Required caller inputs:
 *  - campaignGroupUrn: the parent LinkedIn Campaign Group URN
 *  - objectiveType: resolved at route layer from parent campaign objective
 *
 * Optional:
 *  - campaignType: defaults to SPONSORED_UPDATES
 *  - costType: defaults per campaignType via defaultLinkedinCostType()
 *  - dailyBudgetMajor + currencyCode: when a per-adset budget is required
 *  - startEpochMs: defaults to Date.now()
 *  - endEpochMs: optional schedule end
 */
export async function createCampaign(
  args: LinkedinCallArgs & {
    canonical: AdSet
    campaignGroupUrn: string
    objectiveType: LinkedinAdSetExtension['liObjectiveType']
    campaignType?: LinkedinAdSetExtension['liCampaignType']
    costType?: LinkedinAdSetExtension['liCostType']
    dailyBudgetMajor?: number
    currencyCode?: string
    startEpochMs?: number
    endEpochMs?: number
  },
): Promise<LinkedinCampaignResult> {
  const accountNumericId = urnId(args.accountUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/adCampaigns`

  const status: LinkedinEntityStatus = linkedinStatusFromCanonical(args.canonical.status)
  const campaignType: LinkedinAdSetExtension['liCampaignType'] = args.campaignType ?? 'SPONSORED_UPDATES'
  const costType: LinkedinAdSetExtension['liCostType'] = args.costType ?? defaultLinkedinCostType(campaignType)

  // AdSet.providerData is typed as { meta? }, but at runtime may carry a linkedin slot
  // populated by the route layer. Cast via unknown to access it safely.
  const liProviderData = (args.canonical.providerData as Record<string, unknown>)?.linkedin as
    | LinkedinAdSetExtension
    | undefined

  const targetingCriteria = linkedinTargetingFromCanonical(
    args.canonical.targeting,
    liProviderData?.liTargetingCriteria,
  )

  const body: Record<string, unknown> = {
    account: args.accountUrn,
    campaignGroup: args.campaignGroupUrn,
    name: args.canonical.name,
    type: campaignType,
    status,
    costType,
    objectiveType: args.objectiveType,
    targetingCriteria,
    runSchedule: {
      start: args.startEpochMs ?? Date.now(),
      ...(args.endEpochMs !== undefined ? { end: args.endEpochMs } : {}),
    },
  }

  if (args.dailyBudgetMajor !== undefined) {
    body.dailyBudget = linkedinMoneyFromMajor(args.dailyBudgetMajor, args.currencyCode ?? 'USD')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn campaign create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  const urn = composeUrn('sponsoredCampaign', id)
  return { urn, id }
}

// Alias so route files can import as linkedinCreateCampaign without collision
// with lib/ads/campaigns/store.ts createCampaign.
export { createCampaign as linkedinCreateCampaign }

// ─── Update ───────────────────────────────────────────────────────────────────

/** Partial-update an existing LinkedIn Campaign (PiB AdSet). Pass only the fields you want to change. */
export async function updateCampaign(
  args: LinkedinCallArgs & {
    campaignUrn: string
    patch: Partial<{
      name: string
      status: LinkedinEntityStatus
      dailyBudget: { amount: string; currencyCode: string }
      costType: LinkedinAdSetExtension['liCostType']
      objectiveType: LinkedinAdSetExtension['liObjectiveType']
      targetingCriteria: ReturnType<typeof linkedinTargetingFromCanonical>
    }>
  },
): Promise<void> {
  const accountNumericId = urnId(args.accountUrn)
  const campaignId = urnId(args.campaignUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/adCampaigns/${campaignId}`

  const body = { patch: { $set: args.patch } }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args, { 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`LinkedIn campaign update failed: HTTP ${res.status} — ${text}`)
  }
}

export { updateCampaign as linkedinUpdateCampaign }

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Convenience: flip status to PAUSED. */
export async function pauseCampaign(
  args: LinkedinCallArgs & { campaignUrn: string },
): Promise<void> {
  return updateCampaign({ ...args, patch: { status: 'PAUSED' } })
}

export { pauseCampaign as linkedinPauseCampaign }

/** Convenience: flip status to ACTIVE. */
export async function resumeCampaign(
  args: LinkedinCallArgs & { campaignUrn: string },
): Promise<void> {
  return updateCampaign({ ...args, patch: { status: 'ACTIVE' } })
}

export { resumeCampaign as linkedinResumeCampaign }

/** Convenience: flip status to ARCHIVED. */
export async function archiveCampaign(
  args: LinkedinCallArgs & { campaignUrn: string },
): Promise<void> {
  return updateCampaign({ ...args, patch: { status: 'ARCHIVED' } })
}

export { archiveCampaign as linkedinArchiveCampaign }

// ─── Mapper re-export for convenience ────────────────────────────────────────
// Route layers can call linkedinObjectiveFromCanonical without a separate import.
export { linkedinObjectiveFromCanonical }
