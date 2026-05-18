// lib/ads/providers/tiktok/mappers.ts
// Canonical ↔ TikTok status / objective / money / targeting / optimization_goal mappers.
// Mirrors lib/ads/providers/linkedin/mappers.ts structure and test discipline.
// Additive — Sub-3c Phase 2 Batch 1.

import type { AdEntityStatus, AdObjective, AdTargeting } from '@/lib/ads/types'
import type {
  TiktokEntityStatus,
  TiktokObjective,
  TiktokOptimizationGoal,
  TiktokTargeting,
} from './types'

export type { TiktokEntityStatus }

// ─── Status ───────────────────────────────────────────────────────────────────

/** canonical → TikTok campaign/adgroup/ad status */
export function tiktokStatusFromCanonical(s: AdEntityStatus): TiktokEntityStatus {
  switch (s) {
    case 'ACTIVE': return 'ENABLE'
    case 'PAUSED': return 'DISABLE'
    case 'ARCHIVED': return 'DELETE'
    case 'PENDING_REVIEW': return 'DISABLE'
    case 'DRAFT':
    default:
      return 'DISABLE'
  }
}

/** TikTok → canonical status */
export function canonicalStatusFromTiktok(t: string): AdEntityStatus {
  switch (t) {
    case 'ENABLE': return 'ACTIVE'
    case 'DISABLE': return 'PAUSED'
    case 'DELETE': return 'ARCHIVED'
    default: return 'DRAFT'
  }
}

// ─── Objective ────────────────────────────────────────────────────────────────

/** canonical → TikTok objective. Maps per the design doc table. */
export function tiktokObjectiveFromCanonical(o: AdObjective): TiktokObjective {
  switch (o) {
    case 'TRAFFIC': return 'TRAFFIC'
    case 'LEADS': return 'LEAD_GENERATION'
    case 'SALES': return 'CONVERSIONS'
    case 'AWARENESS': return 'REACH'
    case 'ENGAGEMENT': return 'ENGAGEMENT'
    default:
      // unknown canonical objective → default to TRAFFIC (safest for ad-spend)
      return 'TRAFFIC'
  }
}

/** TikTok → canonical objective (inverse, best-effort) */
export function canonicalObjectiveFromTiktok(o: string): AdObjective {
  switch (o) {
    case 'TRAFFIC': return 'TRAFFIC'
    case 'LEAD_GENERATION': return 'LEADS'
    case 'CONVERSIONS':
    case 'WEBSITE_CONVERSIONS':
    case 'CATALOG_SALES':
    case 'PRODUCT_SALES': return 'SALES'
    case 'REACH': return 'AWARENESS'
    case 'ENGAGEMENT':
    case 'VIDEO_VIEWS': return 'ENGAGEMENT'
    case 'APP_PROMOTION': return 'TRAFFIC'
    default: return 'TRAFFIC'
  }
}

/** Default optimization goal per TikTok objective. */
export function defaultOptimizationGoal(objective: TiktokObjective): TiktokOptimizationGoal {
  switch (objective) {
    case 'TRAFFIC': return 'CLICK'
    case 'LEAD_GENERATION': return 'LEAD_GENERATION'
    case 'CONVERSIONS':
    case 'WEBSITE_CONVERSIONS':
    case 'PRODUCT_SALES':
    case 'CATALOG_SALES': return 'CONVERT'
    case 'REACH': return 'REACH'
    case 'ENGAGEMENT': return 'CLICK'
    case 'VIDEO_VIEWS': return 'VIDEO_VIEW'
    case 'APP_PROMOTION': return 'INSTALL'
  }
}

// ─── Money (TikTok uses numeric in account currency) ──────────────────────────

/** TikTok accepts budget as a number (major units in account currency). */
export function tiktokBudgetFromMajor(amountMajor: number): number {
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new Error(`Invalid TikTok budget: ${amountMajor}`)
  }
  // TikTok wants 2 decimal precision; round
  return Math.round(amountMajor * 100) / 100
}

/** Convert cents-integer (Meta-style) to TikTok budget number. */
export function tiktokBudgetFromCents(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Invalid TikTok cents: ${cents}`)
  }
  return cents / 100
}

// ─── Age group bucketing ──────────────────────────────────────────────────────

/** Map a numeric age range to TikTok age group enum values. */
export function tiktokAgeGroupsFromRange(
  ageMin: number,
  ageMax: number,
): TiktokTargeting['age_groups'] {
  if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax) || ageMax < ageMin) return undefined
  const buckets: NonNullable<TiktokTargeting['age_groups']> = []
  if (ageMin < 18 && ageMax >= 13) buckets.push('AGE_13_17')
  if (ageMin <= 24 && ageMax >= 18) buckets.push('AGE_18_24')
  if (ageMin <= 34 && ageMax >= 25) buckets.push('AGE_25_34')
  if (ageMin <= 44 && ageMax >= 35) buckets.push('AGE_35_44')
  if (ageMin <= 54 && ageMax >= 45) buckets.push('AGE_45_54')
  if (ageMax >= 55) buckets.push('AGE_55_100')
  return buckets.length > 0 ? buckets : undefined
}

// ─── Targeting mapping ────────────────────────────────────────────────────────

/**
 * canonical AdTargeting → TikTok targeting object. TikTok uses its own location
 * id system + age buckets + gender enum. Caller passes pre-mapped location_ids
 * via `tkTargeting` extension since the canonical has only ISO codes.
 */
export function tiktokTargetingFromCanonical(
  canonical: AdTargeting | undefined,
  tkExtension?: TiktokTargeting,
): TiktokTargeting {
  const out: TiktokTargeting = {}

  // Age range → buckets (only if canonical provides them)
  const ageMin = canonical?.demographics?.ageMin
  const ageMax = canonical?.demographics?.ageMax
  if (typeof ageMin === 'number' && typeof ageMax === 'number') {
    const buckets = tiktokAgeGroupsFromRange(ageMin, ageMax)
    if (buckets) out.age_groups = buckets
  }

  // Gender: skip unless extension provides it (canonical has 'male'|'female'|'all' but
  // TikTok uses its own enum; full mapping ships in Phase 2 Batch 2 targeting endpoint)
  if (tkExtension?.gender) out.gender = tkExtension.gender

  // Locations come from extension (canonical ISO codes can't map without a lookup)
  if (tkExtension?.location_ids) out.location_ids = tkExtension.location_ids
  if (tkExtension?.languages) out.languages = tkExtension.languages
  if (tkExtension?.interest_category_ids) out.interest_category_ids = tkExtension.interest_category_ids
  if (tkExtension?.behavior_ids) out.behavior_ids = tkExtension.behavior_ids
  if (tkExtension?.included_audiences) out.included_audiences = tkExtension.included_audiences
  if (tkExtension?.excluded_audiences) out.excluded_audiences = tkExtension.excluded_audiences

  return out
}
