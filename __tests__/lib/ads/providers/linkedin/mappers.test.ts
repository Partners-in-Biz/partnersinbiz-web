// __tests__/lib/ads/providers/linkedin/mappers.test.ts
import {
  linkedinStatusFromCanonical,
  canonicalStatusFromLinkedin,
  linkedinObjectiveFromCanonical,
  canonicalObjectiveFromLinkedin,
  linkedinMoneyFromMajor,
  majorFromLinkedinMoney,
  linkedinMoneyFromCents,
  linkedinTargetingFromCanonical,
  defaultLinkedinCostType,
} from '@/lib/ads/providers/linkedin/mappers'
import type { AdEntityStatus, AdObjective } from '@/lib/ads/types'

// ─── Status Mapping ───────────────────────────────────────────────────────────

describe('linkedinStatusFromCanonical', () => {
  it('maps all 5 canonical statuses', () => {
    const cases: Array<[AdEntityStatus, string]> = [
      ['ACTIVE', 'ACTIVE'],
      ['PAUSED', 'PAUSED'],
      ['ARCHIVED', 'ARCHIVED'],
      ['PENDING_REVIEW', 'DRAFT'],
      ['DRAFT', 'DRAFT'],
    ]
    for (const [canonical, expected] of cases) {
      expect(linkedinStatusFromCanonical(canonical)).toBe(expected)
    }
  })
})

describe('canonicalStatusFromLinkedin', () => {
  it('maps all 7 LinkedIn statuses', () => {
    const cases: Array<[string, AdEntityStatus]> = [
      ['ACTIVE', 'ACTIVE'],
      ['PAUSED', 'PAUSED'],
      ['ARCHIVED', 'ARCHIVED'],
      ['REMOVED', 'ARCHIVED'],
      ['PENDING_DELETION', 'ARCHIVED'],
      ['COMPLETED', 'ARCHIVED'],
      ['DRAFT', 'DRAFT'],
    ]
    for (const [li, expected] of cases) {
      expect(canonicalStatusFromLinkedin(li)).toBe(expected)
    }
  })
})

describe('status round-trip', () => {
  it('ACTIVE round-trips through LinkedIn and back', () => {
    const li = linkedinStatusFromCanonical('ACTIVE')
    expect(canonicalStatusFromLinkedin(li)).toBe('ACTIVE')
  })

  it('PAUSED round-trips through LinkedIn and back', () => {
    const li = linkedinStatusFromCanonical('PAUSED')
    expect(canonicalStatusFromLinkedin(li)).toBe('PAUSED')
  })
})

// ─── Objective Mapping ────────────────────────────────────────────────────────

describe('linkedinObjectiveFromCanonical', () => {
  it('maps all 5 canonical objectives per design table', () => {
    const cases: Array<[AdObjective, string]> = [
      ['TRAFFIC', 'WEBSITE_VISIT'],
      ['LEADS', 'LEAD_GENERATION'],
      ['SALES', 'WEBSITE_CONVERSION'],
      ['AWARENESS', 'BRAND_AWARENESS'],
      ['ENGAGEMENT', 'ENGAGEMENT'],
    ]
    for (const [canonical, expected] of cases) {
      expect(linkedinObjectiveFromCanonical(canonical)).toBe(expected)
    }
  })

  it('unknown canonical objective defaults to WEBSITE_VISIT', () => {
    // Cast to force the default branch
    expect(linkedinObjectiveFromCanonical('UNKNOWN' as AdObjective)).toBe('WEBSITE_VISIT')
  })
})

describe('canonicalObjectiveFromLinkedin', () => {
  it('maps all 8 LinkedIn objectives', () => {
    const cases: Array<[string, AdObjective]> = [
      ['WEBSITE_VISIT', 'TRAFFIC'],
      ['LEAD_GENERATION', 'LEADS'],
      ['WEBSITE_CONVERSION', 'SALES'],
      ['BRAND_AWARENESS', 'AWARENESS'],
      ['ENGAGEMENT', 'ENGAGEMENT'],
      ['VIDEO_VIEW', 'ENGAGEMENT'],
      ['JOB_APPLICANT', 'LEADS'],
      ['TALENT_LEADS', 'LEADS'],
    ]
    for (const [li, expected] of cases) {
      expect(canonicalObjectiveFromLinkedin(li)).toBe(expected)
    }
  })

  it('unknown LinkedIn objective defaults to TRAFFIC', () => {
    expect(canonicalObjectiveFromLinkedin('UNKNOWN_OBJECTIVE')).toBe('TRAFFIC')
  })
})

// ─── Money Conversion ─────────────────────────────────────────────────────────

describe('linkedinMoneyFromMajor', () => {
  it('converts 10.5 → {amount:"10.50", currencyCode:"USD"}', () => {
    expect(linkedinMoneyFromMajor(10.5)).toEqual({ amount: '10.50', currencyCode: 'USD' })
  })

  it('uses provided currency code', () => {
    expect(linkedinMoneyFromMajor(100, 'EUR')).toEqual({ amount: '100.00', currencyCode: 'EUR' })
  })

  it('throws on negative amount', () => {
    expect(() => linkedinMoneyFromMajor(-5)).toThrow('Invalid amount for LinkedIn money: -5')
  })

  it('throws on NaN', () => {
    expect(() => linkedinMoneyFromMajor(NaN)).toThrow()
  })
})

describe('majorFromLinkedinMoney', () => {
  it('parses {amount:"10.50", currencyCode:"USD"} → 10.5', () => {
    expect(majorFromLinkedinMoney({ amount: '10.50', currencyCode: 'USD' })).toBe(10.5)
  })

  it('throws on non-numeric amount string', () => {
    expect(() => majorFromLinkedinMoney({ amount: 'not-a-number', currencyCode: 'USD' })).toThrow()
  })
})

describe('linkedinMoneyFromCents', () => {
  it('converts 1050 cents → {amount:"10.50", currencyCode:"USD"}', () => {
    expect(linkedinMoneyFromCents(1050)).toEqual({ amount: '10.50', currencyCode: 'USD' })
  })

  it('converts 0 cents → {amount:"0.00", currencyCode:"USD"}', () => {
    expect(linkedinMoneyFromCents(0)).toEqual({ amount: '0.00', currencyCode: 'USD' })
  })

  it('throws on negative cents', () => {
    expect(() => linkedinMoneyFromCents(-100)).toThrow()
  })

  it('throws on non-integer cents', () => {
    expect(() => linkedinMoneyFromCents(10.5)).toThrow()
  })
})

// ─── Targeting Mapping ────────────────────────────────────────────────────────

describe('linkedinTargetingFromCanonical', () => {
  it('includes both country URNs lowercased for US and GB', () => {
    const result = linkedinTargetingFromCanonical({
      geo: { countries: ['US', 'GB'] },
      demographics: { ageMin: 18, ageMax: 65 },
    })
    expect(result.include.and).toHaveLength(1)
    const locationGroup = result.include.and[0]
    expect(locationGroup.or['urn:li:adTargetingFacet:locations']).toEqual([
      'urn:li:country:us',
      'urn:li:country:gb',
    ])
  })

  it('returns empty include.and if no targeting provided', () => {
    const result = linkedinTargetingFromCanonical(undefined)
    expect(result.include.and).toHaveLength(0)
  })

  it('merges canonical + extension include groups', () => {
    const extension = {
      include: {
        and: [
          { or: { 'urn:li:adTargetingFacet:industries': ['urn:li:industry:96'] } },
        ],
      },
    }
    const result = linkedinTargetingFromCanonical(
      { geo: { countries: ['US'] }, demographics: { ageMin: 25, ageMax: 54 } },
      extension,
    )
    // Should have geo group + industry group
    expect(result.include.and).toHaveLength(2)
    const facetKeys = result.include.and.map((g) => Object.keys(g.or)[0])
    expect(facetKeys).toContain('urn:li:adTargetingFacet:locations')
    expect(facetKeys).toContain('urn:li:adTargetingFacet:industries')
  })

  it('passes through extension exclude block', () => {
    const extension = {
      include: { and: [] },
      exclude: { or: { 'urn:li:adTargetingFacet:companies': ['urn:li:company:1234'] } },
    }
    const result = linkedinTargetingFromCanonical(undefined, extension)
    expect(result.exclude).toEqual(extension.exclude)
  })
})

// ─── Bidding / Cost Type ──────────────────────────────────────────────────────

describe('defaultLinkedinCostType', () => {
  it('returns CPC for TEXT_AD', () => {
    expect(defaultLinkedinCostType('TEXT_AD')).toBe('CPC')
  })

  it('returns CPM for SPONSORED_UPDATES', () => {
    expect(defaultLinkedinCostType('SPONSORED_UPDATES')).toBe('CPM')
  })

  it('returns CPM for SPONSORED_INMAILS', () => {
    expect(defaultLinkedinCostType('SPONSORED_INMAILS')).toBe('CPM')
  })

  it('returns CPM for DYNAMIC', () => {
    expect(defaultLinkedinCostType('DYNAMIC')).toBe('CPM')
  })
})
