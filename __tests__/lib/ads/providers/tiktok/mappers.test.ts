// __tests__/lib/ads/providers/tiktok/mappers.test.ts
import {
  tiktokStatusFromCanonical,
  canonicalStatusFromTiktok,
  tiktokObjectiveFromCanonical,
  canonicalObjectiveFromTiktok,
  defaultOptimizationGoal,
  tiktokBudgetFromMajor,
  tiktokBudgetFromCents,
  tiktokAgeGroupsFromRange,
  tiktokTargetingFromCanonical,
} from '@/lib/ads/providers/tiktok/mappers'
import type { AdEntityStatus, AdObjective } from '@/lib/ads/types'

// ─── 1. tiktokStatusFromCanonical — all 5 canonical statuses ──────────────────

describe('tiktokStatusFromCanonical', () => {
  it('maps all 5 canonical statuses', () => {
    const cases: Array<[AdEntityStatus, string]> = [
      ['ACTIVE', 'ENABLE'],
      ['PAUSED', 'DISABLE'],
      ['ARCHIVED', 'DELETE'],
      ['PENDING_REVIEW', 'DISABLE'],
      ['DRAFT', 'DISABLE'],
    ]
    for (const [canonical, expected] of cases) {
      expect(tiktokStatusFromCanonical(canonical)).toBe(expected)
    }
  })
})

// ─── 2. canonicalStatusFromTiktok — round-trips ENABLE/DISABLE/DELETE ─────────

describe('canonicalStatusFromTiktok', () => {
  it('maps ENABLE → ACTIVE, DISABLE → PAUSED, DELETE → ARCHIVED', () => {
    expect(canonicalStatusFromTiktok('ENABLE')).toBe('ACTIVE')
    expect(canonicalStatusFromTiktok('DISABLE')).toBe('PAUSED')
    expect(canonicalStatusFromTiktok('DELETE')).toBe('ARCHIVED')
  })

  it('maps unknown delivery status → DRAFT', () => {
    expect(canonicalStatusFromTiktok('STATUS_DELIVERY_OK')).toBe('DRAFT')
    expect(canonicalStatusFromTiktok('STATUS_REVIEW_IN_PROGRESS')).toBe('DRAFT')
    expect(canonicalStatusFromTiktok('UNKNOWN')).toBe('DRAFT')
  })
})

// ─── 3. tiktokObjectiveFromCanonical — all 5 canonical objectives ─────────────

describe('tiktokObjectiveFromCanonical', () => {
  it('maps all 5 canonical objectives per design table', () => {
    const cases: Array<[AdObjective, string]> = [
      ['TRAFFIC', 'TRAFFIC'],
      ['LEADS', 'LEAD_GENERATION'],
      ['SALES', 'CONVERSIONS'],
      ['AWARENESS', 'REACH'],
      ['ENGAGEMENT', 'ENGAGEMENT'],
    ]
    for (const [canonical, expected] of cases) {
      expect(tiktokObjectiveFromCanonical(canonical)).toBe(expected)
    }
  })
})

// ─── 4. canonicalObjectiveFromTiktok — VIDEO_VIEWS, APP_PROMOTION, variants ───

describe('canonicalObjectiveFromTiktok', () => {
  it('handles SALES variants (CONVERSIONS, WEBSITE_CONVERSIONS, CATALOG_SALES, PRODUCT_SALES)', () => {
    expect(canonicalObjectiveFromTiktok('CONVERSIONS')).toBe('SALES')
    expect(canonicalObjectiveFromTiktok('WEBSITE_CONVERSIONS')).toBe('SALES')
    expect(canonicalObjectiveFromTiktok('CATALOG_SALES')).toBe('SALES')
    expect(canonicalObjectiveFromTiktok('PRODUCT_SALES')).toBe('SALES')
  })

  it('maps VIDEO_VIEWS → ENGAGEMENT', () => {
    expect(canonicalObjectiveFromTiktok('VIDEO_VIEWS')).toBe('ENGAGEMENT')
  })

  it('maps APP_PROMOTION → TRAFFIC', () => {
    expect(canonicalObjectiveFromTiktok('APP_PROMOTION')).toBe('TRAFFIC')
  })

  it('maps REACH → AWARENESS, LEAD_GENERATION → LEADS, TRAFFIC → TRAFFIC', () => {
    expect(canonicalObjectiveFromTiktok('REACH')).toBe('AWARENESS')
    expect(canonicalObjectiveFromTiktok('LEAD_GENERATION')).toBe('LEADS')
    expect(canonicalObjectiveFromTiktok('TRAFFIC')).toBe('TRAFFIC')
  })
})

// ─── 5. Unknown canonical objective defaults to TRAFFIC ───────────────────────

describe('tiktokObjectiveFromCanonical — unknown default', () => {
  it('unknown canonical objective defaults to TRAFFIC', () => {
    expect(tiktokObjectiveFromCanonical('UNKNOWN' as AdObjective)).toBe('TRAFFIC')
  })
})

// ─── 6. defaultOptimizationGoal ───────────────────────────────────────────────

describe('defaultOptimizationGoal', () => {
  it('returns CLICK for TRAFFIC', () => {
    expect(defaultOptimizationGoal('TRAFFIC')).toBe('CLICK')
  })

  it('returns CONVERT for CONVERSIONS', () => {
    expect(defaultOptimizationGoal('CONVERSIONS')).toBe('CONVERT')
  })

  it('returns INSTALL for APP_PROMOTION', () => {
    expect(defaultOptimizationGoal('APP_PROMOTION')).toBe('INSTALL')
  })

  it('returns LEAD_GENERATION for LEAD_GENERATION', () => {
    expect(defaultOptimizationGoal('LEAD_GENERATION')).toBe('LEAD_GENERATION')
  })

  it('returns REACH for REACH', () => {
    expect(defaultOptimizationGoal('REACH')).toBe('REACH')
  })

  it('returns VIDEO_VIEW for VIDEO_VIEWS', () => {
    expect(defaultOptimizationGoal('VIDEO_VIEWS')).toBe('VIDEO_VIEW')
  })
})

// ─── 7. tiktokBudgetFromMajor — 50.5, rounding ───────────────────────────────

describe('tiktokBudgetFromMajor', () => {
  it('returns 50.5 for 50.5', () => {
    expect(tiktokBudgetFromMajor(50.5)).toBe(50.5)
  })

  it('rounds 50.555 → 50.56', () => {
    expect(tiktokBudgetFromMajor(50.555)).toBe(50.56)
  })

  it('returns 0 for 0', () => {
    expect(tiktokBudgetFromMajor(0)).toBe(0)
  })
})

// ─── 8. tiktokBudgetFromMajor — throws on negative + NaN ─────────────────────

describe('tiktokBudgetFromMajor — error cases', () => {
  it('throws on negative amount', () => {
    expect(() => tiktokBudgetFromMajor(-5)).toThrow('Invalid TikTok budget: -5')
  })

  it('throws on NaN', () => {
    expect(() => tiktokBudgetFromMajor(NaN)).toThrow()
  })

  it('throws on Infinity', () => {
    expect(() => tiktokBudgetFromMajor(Infinity)).toThrow()
  })
})

// ─── 9. tiktokBudgetFromCents — 5050 → 50.5 ──────────────────────────────────

describe('tiktokBudgetFromCents', () => {
  it('converts 5050 cents → 50.5', () => {
    expect(tiktokBudgetFromCents(5050)).toBe(50.5)
  })

  it('converts 0 cents → 0', () => {
    expect(tiktokBudgetFromCents(0)).toBe(0)
  })

  it('throws on negative cents', () => {
    expect(() => tiktokBudgetFromCents(-100)).toThrow()
  })

  it('throws on non-integer cents', () => {
    expect(() => tiktokBudgetFromCents(10.5)).toThrow()
  })
})

// ─── 10. tiktokAgeGroupsFromRange(18, 34) → ['AGE_18_24', 'AGE_25_34'] ───────

describe('tiktokAgeGroupsFromRange', () => {
  it('returns [AGE_18_24, AGE_25_34] for range 18–34', () => {
    expect(tiktokAgeGroupsFromRange(18, 34)).toEqual(['AGE_18_24', 'AGE_25_34'])
  })

  // ─── 11. tiktokAgeGroupsFromRange(35, 100) → 4 buckets ───────────────────

  it('returns 4 buckets for range 35–100', () => {
    expect(tiktokAgeGroupsFromRange(35, 100)).toEqual([
      'AGE_35_44',
      'AGE_45_54',
      'AGE_55_100',
    ])
  })

  it('returns all 6 buckets for range 13–100', () => {
    expect(tiktokAgeGroupsFromRange(13, 100)).toEqual([
      'AGE_13_17',
      'AGE_18_24',
      'AGE_25_34',
      'AGE_35_44',
      'AGE_45_54',
      'AGE_55_100',
    ])
  })

  // ─── 12. tiktokAgeGroupsFromRange(NaN, 30) → undefined ───────────────────

  it('returns undefined for NaN ageMin', () => {
    expect(tiktokAgeGroupsFromRange(NaN, 30)).toBeUndefined()
  })

  it('returns undefined when ageMax < ageMin', () => {
    expect(tiktokAgeGroupsFromRange(40, 20)).toBeUndefined()
  })
})

// ─── 13. tiktokTargetingFromCanonical — demographics only ─────────────────────

describe('tiktokTargetingFromCanonical', () => {
  it('maps canonical age range to TikTok age_groups buckets', () => {
    const result = tiktokTargetingFromCanonical({
      demographics: { ageMin: 18, ageMax: 34 },
      geo: {},
    })
    expect(result.age_groups).toEqual(['AGE_18_24', 'AGE_25_34'])
    // No extension — no other fields
    expect(result.location_ids).toBeUndefined()
    expect(result.gender).toBeUndefined()
  })

  // ─── 14. tiktokTargetingFromCanonical — merges extension fields ────────────

  it('merges extension fields (location_ids, gender, languages, interests)', () => {
    const result = tiktokTargetingFromCanonical(
      { demographics: { ageMin: 25, ageMax: 44 }, geo: {} },
      {
        location_ids: [1000001, 1000002],
        gender: 'GENDER_FEMALE',
        languages: ['en', 'af'],
        interest_category_ids: [700001],
        behavior_ids: [900001],
        included_audiences: ['audience-abc'],
        excluded_audiences: ['audience-xyz'],
      },
    )
    expect(result.age_groups).toEqual(['AGE_25_34', 'AGE_35_44'])
    expect(result.location_ids).toEqual([1000001, 1000002])
    expect(result.gender).toBe('GENDER_FEMALE')
    expect(result.languages).toEqual(['en', 'af'])
    expect(result.interest_category_ids).toEqual([700001])
    expect(result.behavior_ids).toEqual([900001])
    expect(result.included_audiences).toEqual(['audience-abc'])
    expect(result.excluded_audiences).toEqual(['audience-xyz'])
  })

  // ─── 15. tiktokTargetingFromCanonical — empty object when nothing provided ──

  it('returns empty object when no canonical or extension provided', () => {
    const result = tiktokTargetingFromCanonical(undefined)
    expect(result).toEqual({})
  })
})
