import {
  calculateKeywordBalance,
  calculateLeadValue,
  calculateSeoRoi,
  estimateWebsiteCost,
  generateMetaSuggestions,
} from '@/lib/tools/calculators'
import { PUBLIC_TOOLS } from '@/lib/tools/catalog'

describe('public PiB tool calculators', () => {
  it('projects SEO ROI from traffic, conversion, and investment inputs', () => {
    const result = calculateSeoRoi({
      monthlyOrganicVisits: 1000,
      expectedTrafficLiftPct: 50,
      visitorToLeadRatePct: 2,
      leadCloseRatePct: 25,
      averageDealValue: 10000,
      monthlySeoInvestment: 5000,
    })

    expect(result).toEqual({
      additionalVisits: 500,
      additionalLeads: 10,
      projectedCustomers: 2.5,
      projectedRevenue: 25000,
      roiPct: 400,
      paybackMultiple: 5,
    })
  })

  it('estimates website ranges with portal scope increasing cost and timeline', () => {
    const simple = estimateWebsiteCost({
      pageCount: 5,
      designLevel: 'lean',
      needsCopywriting: false,
      needsCms: false,
      integrationCount: 0,
      hasPortalOrApp: false,
    })
    const portal = estimateWebsiteCost({
      pageCount: 5,
      designLevel: 'lean',
      needsCopywriting: false,
      needsCms: false,
      integrationCount: 0,
      hasPortalOrApp: true,
    })

    expect(portal.low).toBeGreaterThan(simple.low)
    expect(portal.high).toBeGreaterThan(simple.high)
    expect(portal.timelineWeeks).toBeGreaterThan(simple.timelineWeeks)
  })

  it('calculates lead value using margin, close rate, and lifetime multiplier', () => {
    const result = calculateLeadValue({
      averageSaleValue: 20000,
      grossMarginPct: 50,
      closeRatePct: 20,
      lifetimeMultiplier: 2,
    })

    expect(result.customerGrossValue).toBe(20000)
    expect(result.leadValue).toBe(4000)
    expect(result.suggestedCostPerLead).toBe(2200)
  })

  it('generates deterministic metadata suggestions with character counts in usable ranges', () => {
    const [first] = generateMetaSuggestions({
      businessName: 'Partners in Biz',
      service: 'SEO Sprint',
      location: 'South Africa',
      audience: 'SMEs',
      benefit: 'win more qualified leads',
    })

    expect(first.title).toContain('SEO Sprint')
    expect(first.description).toContain('Partners in Biz')
    expect(first.title.length).toBeLessThanOrEqual(60)
    expect(first.description.length).toBeLessThanOrEqual(160)
  })

  it('frames keyword checks as balance guidance rather than a ranking formula', () => {
    const result = calculateKeywordBalance({
      keyword: 'SEO',
      text: 'SEO helps businesses plan. SEO should be useful, but SEO repeated too often becomes noisy copy for readers.',
    })

    expect(result.wordCount).toBeGreaterThan(0)
    expect(result.keywordMentions).toBe(3)
    expect(result.guidance).toMatch(/repetitive|present|context/i)
  })
})

describe('public PiB tool catalog', () => {
  it('keeps tools PiB-focused and exposes unique slugs', () => {
    const slugs = PUBLIC_TOOLS.map(tool => tool.slug)

    expect(new Set(slugs).size).toBe(PUBLIC_TOOLS.length)
    expect(slugs).toContain('seo-roi-calculator')
    expect(slugs).toContain('website-cost-calculator')
    expect(PUBLIC_TOOLS.map(tool => `${tool.title} ${tool.description}`).join(' ')).not.toMatch(/Lumen|Velox/i)
  })
})
