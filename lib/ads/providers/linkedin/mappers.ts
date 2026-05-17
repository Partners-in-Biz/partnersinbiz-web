// lib/ads/providers/linkedin/mappers.ts
// Canonical ↔ LinkedIn status / objective / money / targeting / bidding mappers.
// Mirrors lib/ads/providers/google/mappers.ts structure and test discipline.
// Additive — Sub-3b Phase 2 Batch 1.

import type { AdEntityStatus, AdObjective, AdTargeting } from '@/lib/ads/types'
import type { LinkedinAdSetExtension, LinkedinMoneyAmount, LinkedinTargetingCriteria } from './types'

// ─── Entity Status ────────────────────────────────────────────────────────────

export type LinkedinEntityStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'PAUSED'
  | 'PENDING_DELETION'
  | 'REMOVED'
  | 'COMPLETED'

/** canonical → LinkedIn campaign/campaign-group/creative status */
export function linkedinStatusFromCanonical(s: AdEntityStatus): LinkedinEntityStatus {
  switch (s) {
    case 'ACTIVE': return 'ACTIVE'
    case 'PAUSED': return 'PAUSED'
    case 'ARCHIVED': return 'ARCHIVED'
    case 'PENDING_REVIEW': return 'DRAFT'
    case 'DRAFT':
    default:
      return 'DRAFT'
  }
}

/** LinkedIn → canonical status */
export function canonicalStatusFromLinkedin(li: string): AdEntityStatus {
  switch (li) {
    case 'ACTIVE': return 'ACTIVE'
    case 'PAUSED': return 'PAUSED'
    case 'ARCHIVED':
    case 'REMOVED':
    case 'PENDING_DELETION': return 'ARCHIVED'
    case 'COMPLETED': return 'ARCHIVED'
    case 'DRAFT':
    default:
      return 'DRAFT'
  }
}

// ─── Objective Mapping ────────────────────────────────────────────────────────

export type LinkedinObjective = LinkedinAdSetExtension['liObjectiveType']

/** canonical → LinkedIn objective. Maps per the design doc table. */
export function linkedinObjectiveFromCanonical(o: AdObjective): LinkedinObjective {
  switch (o) {
    case 'TRAFFIC': return 'WEBSITE_VISIT'
    case 'LEADS': return 'LEAD_GENERATION'
    case 'SALES': return 'WEBSITE_CONVERSION'
    case 'AWARENESS': return 'BRAND_AWARENESS'
    case 'ENGAGEMENT': return 'ENGAGEMENT'
    default:
      // unknown canonical objective → default to WEBSITE_VISIT (safest for ad-spend)
      return 'WEBSITE_VISIT'
  }
}

/** LinkedIn → canonical objective (inverse, best-effort) */
export function canonicalObjectiveFromLinkedin(o: string): AdObjective {
  switch (o) {
    case 'WEBSITE_VISIT': return 'TRAFFIC'
    case 'LEAD_GENERATION': return 'LEADS'
    case 'WEBSITE_CONVERSION': return 'SALES'
    case 'BRAND_AWARENESS': return 'AWARENESS'
    case 'ENGAGEMENT':
    case 'VIDEO_VIEW': return 'ENGAGEMENT'
    case 'JOB_APPLICANT':
    case 'TALENT_LEADS': return 'LEADS'
    default: return 'TRAFFIC'
  }
}

// ─── Money Conversion ─────────────────────────────────────────────────────────

/** Convert dollars-major (e.g. 10.50) to LinkedIn money object. */
export function linkedinMoneyFromMajor(amountMajor: number, currencyCode = 'USD'): LinkedinMoneyAmount {
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new Error(`Invalid amount for LinkedIn money: ${amountMajor}`)
  }
  // LinkedIn expects a decimal string with at least 2 decimal places
  return { amount: amountMajor.toFixed(2), currencyCode }
}

/** Parse a LinkedIn money object back into dollars-major. */
export function majorFromLinkedinMoney(m: LinkedinMoneyAmount): number {
  const parsed = parseFloat(m.amount)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid LinkedIn money amount: ${m.amount}`)
  return parsed
}

/** Convert cents-integer (Meta-style) to LinkedIn money object. */
export function linkedinMoneyFromCents(cents: number, currencyCode = 'USD'): LinkedinMoneyAmount {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Invalid cents for LinkedIn money: ${cents}`)
  }
  return { amount: (cents / 100).toFixed(2), currencyCode }
}

// ─── Targeting Mapping ────────────────────────────────────────────────────────

/**
 * canonical AdTargeting → LinkedIn targetingCriteria. Phase 2 baseline:
 *  - geo.countries (ISO codes) → urn:li:country:{iso} include facet
 *  - LinkedIn-specific facets (companies/industries/etc) flow via
 *    providerData.linkedin.liTargetingCriteria — merged at build time.
 */
export function linkedinTargetingFromCanonical(
  canonical: AdTargeting | undefined,
  liExtension?: LinkedinTargetingCriteria,
): LinkedinTargetingCriteria {
  const countries = canonical?.geo?.countries ?? []
  const locationUrns = countries.map((iso) => `urn:li:country:${iso.toLowerCase()}`)

  // Build the include AND-of-OR-groups structure
  const includeOrGroups: Array<{ or: Record<string, string[]> }> = []
  if (locationUrns.length > 0) {
    includeOrGroups.push({ or: { 'urn:li:adTargetingFacet:locations': locationUrns } })
  }

  // Merge in extension include groups
  if (liExtension?.include?.and) {
    for (const g of liExtension.include.and) includeOrGroups.push(g)
  }

  const out: LinkedinTargetingCriteria = {
    include: { and: includeOrGroups },
  }
  if (liExtension?.exclude) out.exclude = liExtension.exclude
  return out
}

// ─── Bidding / Cost Type ──────────────────────────────────────────────────────

/** Default cost type per LinkedIn campaign type. SPONSORED_UPDATES → CPM, TEXT_AD → CPC, etc. */
export function defaultLinkedinCostType(
  campaignType: LinkedinAdSetExtension['liCampaignType'],
): LinkedinAdSetExtension['liCostType'] {
  switch (campaignType) {
    case 'TEXT_AD': return 'CPC'
    case 'SPONSORED_UPDATES': return 'CPM'
    case 'SPONSORED_INMAILS': return 'CPM'
    case 'DYNAMIC': return 'CPM'
    default: return 'CPM'
  }
}
