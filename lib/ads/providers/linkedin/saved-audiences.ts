// lib/ads/providers/linkedin/saved-audiences.ts
// LinkedIn Audience Templates (Saved Audiences) — create + archive.
// Wraps /adTargetingTemplates endpoint.
// Phase 3 Batch 2A.

import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'
import type { LinkedinTargetingCriteria } from './types'

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface LinkedinSavedAudienceCallArgs {
  /** urn:li:sponsoredAccount:{id} */
  accountUrn: string
  accessToken: string
  /** Override LinkedIn-Version header (default: LINKEDIN_ADS_VERSION). */
  version?: string
}

export interface LinkedinSavedAudienceResult {
  /** urn:li:adTargetingTemplate:{id} */
  urn: string
  id: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(
  args: LinkedinSavedAudienceCallArgs,
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

/**
 * Extract the numeric id LinkedIn returns in X-RestLi-Id or Location header.
 * adTargetingTemplates uses the same REST.li creation pattern as dmpSegments.
 */
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

/** Build a URN for the adTargetingTemplate namespace (not in the shared urn.ts union). */
function composeTargetingTemplateUrn(id: string): string {
  return `urn:li:adTargetingTemplate:${id}`
}

// ─── Create ───────────────────────────────────────────────────────────────────

/** Create a LinkedIn Audience Template (Saved Audience). */
export async function createSavedAudience(
  args: LinkedinSavedAudienceCallArgs & {
    name: string
    targeting: LinkedinTargetingCriteria
  },
): Promise<LinkedinSavedAudienceResult> {
  const url = `${LINKEDIN_ADS_API_BASE}/adTargetingTemplates`

  const body = {
    account: args.accountUrn,
    name: args.name,
    includedTargetingFacets: args.targeting.include,
    excludedTargetingFacets: args.targeting.exclude ?? null,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn saved audience create failed: HTTP ${res.status} — ${text}`)
  }

  const id = extractCreatedId(res)
  return { urn: composeTargetingTemplateUrn(id), id }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

/** Archive a LinkedIn Audience Template. */
export async function archiveSavedAudience(
  args: LinkedinSavedAudienceCallArgs & { templateUrn: string },
): Promise<void> {
  // Extract numeric id from urn:li:adTargetingTemplate:{id}
  const match = args.templateUrn.match(/^urn:li:adTargetingTemplate:(.+)$/)
  if (!match) {
    throw new Error(
      `archiveSavedAudience: invalid templateUrn "${args.templateUrn}" — expected urn:li:adTargetingTemplate:{id}`,
    )
  }
  const templateId = match[1]
  const url = `${LINKEDIN_ADS_API_BASE}/adTargetingTemplates/${encodeURIComponent(templateId)}`

  const body = { patch: { $set: { status: 'ARCHIVED' } } }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args, { 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`LinkedIn archive saved audience failed: HTTP ${res.status} — ${text}`)
  }
}
