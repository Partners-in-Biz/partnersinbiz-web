// lib/ads/providers/linkedin/ads.ts
// LinkedIn Creative CRUD = canonical Ad — Sub-3b Phase 2 Batch 2C.
// Wraps /rest/adAccounts/{accountId}/creatives.
// Phase 2 baseline: single-image SPONSORED_STATUS_UPDATE only.
// Video + carousel deferred to Phase 2.5 / Phase 3.

import type { Ad } from '@/lib/ads/types'
import {
  LINKEDIN_ADS_API_BASE,
  LINKEDIN_ADS_VERSION,
} from './constants'
import {
  linkedinStatusFromCanonical,
  type LinkedinEntityStatus,
} from './mappers'
import { composeUrn, urnId } from './urn'

export interface LinkedinCreativeCallArgs {
  accountUrn: string  // urn:li:sponsoredAccount:{id}
  accessToken: string
  version?: string  // override LinkedIn-Version header (default: LINKEDIN_ADS_VERSION)
}

export interface LinkedinCreativeResult {
  /** Full URN: urn:li:sponsoredCreative:{id} */
  urn: string
  /** Numeric id (parsed from URN) */
  id: string
}

function buildHeaders(
  args: LinkedinCreativeCallArgs,
  extra?: Record<string, string>,
): Record<string, string> {
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

/** Create a LinkedIn Sponsored Content creative (single-image Phase 2 baseline). */
export async function createCreative(
  args: LinkedinCreativeCallArgs & {
    canonical: Ad
    /** Parent LinkedIn Campaign URN (PiB AdSet's providerData.linkedin.campaignUrn) */
    campaignUrn: string
    /** Content reference URN — Share URN or asset URN backing this creative.
     *  Produced by Batch 2D (creative-sync); treated as opaque here. */
    referenceUrn: string
    /** Optional intended status (default: mapped from canonical status). */
    initialStatus?: 'DRAFT' | 'PAUSED' | 'ACTIVE'
  },
): Promise<LinkedinCreativeResult> {
  const accountNumericId = urnId(args.accountUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/creatives`

  const status: LinkedinEntityStatus =
    args.initialStatus ?? linkedinStatusFromCanonical(args.canonical.status)

  const body: Record<string, unknown> = {
    campaign: args.campaignUrn,
    type: 'SPONSORED_STATUS_UPDATE',
    status,
    content: { reference: args.referenceUrn },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn creative create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('sponsoredCreative', id), id }
}

/** Partial-update an existing Creative. Pass only the fields you want to change. */
export async function updateCreative(
  args: LinkedinCreativeCallArgs & {
    creativeUrn: string
    patch: Partial<{
      status: LinkedinEntityStatus
    }>
  },
): Promise<void> {
  const accountNumericId = urnId(args.accountUrn)
  const creativeId = urnId(args.creativeUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/adAccounts/${accountNumericId}/creatives/${creativeId}`

  const body = { patch: { $set: args.patch } }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args, { 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`LinkedIn creative update failed: HTTP ${res.status} — ${text}`)
  }
}

/** Convenience: flip status to PAUSED. */
export async function pauseCreative(
  args: LinkedinCreativeCallArgs & { creativeUrn: string },
): Promise<void> {
  return updateCreative({ ...args, patch: { status: 'PAUSED' } })
}

/** Convenience: flip status to ACTIVE. */
export async function resumeCreative(
  args: LinkedinCreativeCallArgs & { creativeUrn: string },
): Promise<void> {
  return updateCreative({ ...args, patch: { status: 'ACTIVE' } })
}

/** Convenience: flip status to ARCHIVED. */
export async function archiveCreative(
  args: LinkedinCreativeCallArgs & { creativeUrn: string },
): Promise<void> {
  return updateCreative({ ...args, patch: { status: 'ARCHIVED' } })
}
