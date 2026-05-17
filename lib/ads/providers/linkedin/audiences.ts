// lib/ads/providers/linkedin/audiences.ts
// LinkedIn DMP Segments — 5 PiB Custom Audience subtype creators + status/archive.
// Phase 3 Batch 2A.

import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'
import { composeUrn, urnId } from './urn'

// ─── Shared arg interfaces ─────────────────────────────────────────────────────

export interface LinkedinAudienceCallArgs {
  /** urn:li:sponsoredAccount:{id} */
  accountUrn: string
  accessToken: string
  /** Override LinkedIn-Version header (default: LINKEDIN_ADS_VERSION). */
  version?: string
}

export interface LinkedinAudienceResult {
  /** urn:li:dmpSegment:{id} */
  urn: string
  id: string
}

export type LinkedinAudienceStatus = 'BUILDING' | 'READY' | 'ARCHIVED' | 'PENDING_DELETION'

export interface LinkedinAudienceStatusResult {
  status: LinkedinAudienceStatus
  approximateMemberCount?: number
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function buildHeaders(
  args: LinkedinAudienceCallArgs,
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

/** Extract the numeric id LinkedIn returns in X-RestLi-Id or Location header. */
function extractCreatedId(res: Response): string {
  const headerId = res.headers.get('X-RestLi-Id')
  if (headerId) return headerId

  const loc = res.headers.get('Location')
  if (loc) {
    const segments = loc.split('/')
    const last = segments[segments.length - 1]
    if (last) return last
  }
  throw new Error('LinkedIn create response missing both X-RestLi-Id and Location headers')
}

// ─── CUSTOMER_LIST (contact list) ─────────────────────────────────────────────

/**
 * Create a LinkedIn Contact List DMP Segment for the PiB CUSTOMER_LIST subtype.
 * Caller must subsequently call uploadAudienceMembers (from audiences-hash.ts)
 * to push the actual rows.
 */
export async function createContactListAudience(
  args: LinkedinAudienceCallArgs & { name: string },
): Promise<LinkedinAudienceResult> {
  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments`

  const body = {
    name: args.name,
    destinations: [{ destination: 'LINKEDIN' }],
    sourcePlatform: 'API',
    type: 'USER',
    account: args.accountUrn,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn contact list audience create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('dmpSegment', id), id }
}

// ─── WEBSITE (Insight Tag retargeting) ────────────────────────────────────────

export interface WebsiteAudienceRule {
  matchType: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH'
  url: string
}

export async function createWebsiteAudience(
  args: LinkedinAudienceCallArgs & {
    name: string
    /** LinkedIn Insight Tag partner ID. */
    insightTagId: string
    rules: WebsiteAudienceRule[]
  },
): Promise<LinkedinAudienceResult> {
  if (!args.rules || args.rules.length === 0) {
    throw new Error('createWebsiteAudience: rules array must be non-empty')
  }

  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments`

  const body = {
    name: args.name,
    destinations: [{ destination: 'LINKEDIN' }],
    sourcePlatform: 'API',
    type: 'WEB_SITE',
    account: args.accountUrn,
    websiteAudienceSource: {
      insightTagId: args.insightTagId,
      rules: args.rules.map((r) => ({ matchType: r.matchType, url: r.url })),
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn website audience create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('dmpSegment', id), id }
}

// ─── LOOKALIKE (from source DMP segment URN) ──────────────────────────────────

export async function createLookalikeAudience(
  args: LinkedinAudienceCallArgs & {
    name: string
    /** urn:li:dmpSegment:{id} — caller ensures source segment is READY. */
    sourceSegmentUrn: string
  },
): Promise<LinkedinAudienceResult> {
  // Validate URN format — must be urn:li:dmpSegment:{id}
  if (!args.sourceSegmentUrn.match(/^urn:li:dmpSegment:[A-Za-z0-9_-]+$/)) {
    throw new Error(
      `createLookalikeAudience: invalid sourceSegmentUrn "${args.sourceSegmentUrn}" — expected urn:li:dmpSegment:{id}`,
    )
  }

  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments`

  const body = {
    name: args.name,
    destinations: [{ destination: 'LINKEDIN' }],
    sourcePlatform: 'API',
    type: 'LOOKALIKE',
    account: args.accountUrn,
    sourceSegment: args.sourceSegmentUrn,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn lookalike audience create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('dmpSegment', id), id }
}

// ─── ENGAGEMENT (Company Page visitors/followers/video viewers) ───────────────

export type EngagementType = 'VISITORS' | 'FOLLOWERS' | 'VIDEO_VIEWERS'

export async function createEngagementAudience(
  args: LinkedinAudienceCallArgs & {
    name: string
    /** urn:li:organization:{id} */
    organizationUrn: string
    engagementType: EngagementType
  },
): Promise<LinkedinAudienceResult> {
  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments`

  const body = {
    name: args.name,
    destinations: [{ destination: 'LINKEDIN' }],
    sourcePlatform: 'API',
    type: 'COMPANY_PAGE',
    account: args.accountUrn,
    engagementSource: {
      organization: args.organizationUrn,
      engagementType: args.engagementType,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn engagement audience create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeUrn('dmpSegment', id), id }
}

// ─── APP (no native LinkedIn equivalent — explicit shim) ──────────────────────

/**
 * LinkedIn does not offer a direct App audience equivalent. This function
 * documents the limitation and throws an explicit error. The route layer
 * surfaces this to the admin with a "use Lookalike off a Customer List
 * seeded by app events" workaround.
 */
export async function createAppAudience(
  args: LinkedinAudienceCallArgs & { name: string },
): Promise<never> {
  // Suppress unused-variable warning while keeping the signature correct
  void args
  throw new Error(
    'LinkedIn does not support App audiences natively. ' +
      'Workaround: create a Customer List audience seeded by your app analytics events, ' +
      'then create a Lookalike from that list.',
  )
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getAudienceStatus(
  args: LinkedinAudienceCallArgs & { segmentUrn: string },
): Promise<LinkedinAudienceStatusResult> {
  const segmentId = urnId(args.segmentUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments/${encodeURIComponent(segmentId)}`

  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(args),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn get audience status failed: HTTP ${res.status} — ${text}`)
  }

  const data = (await res.json()) as {
    status?: string
    approximateMemberCount?: number
  }

  return {
    status: data.status as LinkedinAudienceStatus,
    approximateMemberCount: data.approximateMemberCount,
  }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveAudience(
  args: LinkedinAudienceCallArgs & { segmentUrn: string },
): Promise<void> {
  const segmentId = urnId(args.segmentUrn)
  const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments/${encodeURIComponent(segmentId)}`

  const body = { patch: { $set: { status: 'ARCHIVED' } } }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args, { 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`LinkedIn archive audience failed: HTTP ${res.status} — ${text}`)
  }
}
