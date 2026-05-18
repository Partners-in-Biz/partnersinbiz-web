// __tests__/lib/ads/providers/meta/mappers.test.ts
import {
  campaignToMetaForm,
  adSetToMetaForm,
  adToMetaCreativeSpec,
  canonicalObjective,
  canonicalStatus,
  metaStatusToCanonical,
} from '@/lib/ads/providers/meta/mappers'
import type { AdCampaign, AdSet, Ad } from '@/lib/ads/types'

describe('canonicalObjective', () => {
  it('maps canonical → Meta v25 OUTCOME_* enum', () => {
    expect(canonicalObjective('TRAFFIC')).toBe('OUTCOME_TRAFFIC')
    expect(canonicalObjective('LEADS')).toBe('OUTCOME_LEADS')
    expect(canonicalObjective('SALES')).toBe('OUTCOME_SALES')
    expect(canonicalObjective('AWARENESS')).toBe('OUTCOME_AWARENESS')
    expect(canonicalObjective('ENGAGEMENT')).toBe('OUTCOME_ENGAGEMENT')
  })
})

describe('canonicalStatus / metaStatusToCanonical', () => {
  it('maps DRAFT → PAUSED on send (Meta has no DRAFT)', () => {
    expect(canonicalStatus('DRAFT')).toBe('PAUSED')
    expect(canonicalStatus('ACTIVE')).toBe('ACTIVE')
    expect(canonicalStatus('PAUSED')).toBe('PAUSED')
    expect(canonicalStatus('ARCHIVED')).toBe('ARCHIVED')
  })

  it('maps Meta → canonical (PAUSED on read becomes PAUSED, not DRAFT)', () => {
    expect(metaStatusToCanonical('ACTIVE')).toBe('ACTIVE')
    expect(metaStatusToCanonical('PAUSED')).toBe('PAUSED')
    expect(metaStatusToCanonical('ARCHIVED')).toBe('ARCHIVED')
    expect(metaStatusToCanonical('DELETED')).toBe('ARCHIVED')
    expect(metaStatusToCanonical('UNKNOWN')).toBe('PAUSED')
  })
})

describe('campaignToMetaForm', () => {
  it('maps canonical campaign to Meta form body', () => {
    const c: Partial<AdCampaign> = {
      name: 'Test',
      objective: 'TRAFFIC',
      status: 'DRAFT',
      cboEnabled: true,
      dailyBudget: 1000,
      bidStrategy: 'LOWEST_COST',
      specialAdCategories: [],
    }
    const form = campaignToMetaForm(c as AdCampaign)
    expect(form.name).toBe('Test')
    expect(form.objective).toBe('OUTCOME_TRAFFIC')
    expect(form.status).toBe('PAUSED') // DRAFT → PAUSED
    expect(form.daily_budget).toBe('1000')
    expect(form.bid_strategy).toBe('LOWEST_COST')
    expect(form.special_ad_categories).toBe('[]')
  })
})

describe('adSetToMetaForm', () => {
  it('builds targeting JSON + placements from canonical AdSet', () => {
    const s: Partial<AdSet> = {
      name: 'Test Set',
      status: 'ACTIVE',
      dailyBudget: 500,
      bidAmount: 100,
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      targeting: {
        geo: { countries: ['US', 'CA'] },
        demographics: { ageMin: 25, ageMax: 45, genders: ['female'] },
      },
      placements: { feeds: true, stories: true, reels: false, marketplace: false },
    }
    const form = adSetToMetaForm(s as AdSet, 'cmp_meta_123')
    expect(form.campaign_id).toBe('cmp_meta_123')
    expect(form.optimization_goal).toBe('LINK_CLICKS')
    expect(form.billing_event).toBe('IMPRESSIONS')
    expect(form.daily_budget).toBe('500')
    expect(form.bid_amount).toBe('100')
    const targeting = JSON.parse(form.targeting)
    expect(targeting.geo_locations.countries).toEqual(['US', 'CA'])
    expect(targeting.age_min).toBe(25)
    expect(targeting.age_max).toBe(45)
    expect(targeting.genders).toEqual([2]) // 2 = female in Meta enum
    expect(targeting.facebook_positions).toContain('feed')
    expect(targeting.facebook_positions).toContain('story')
    expect(targeting.facebook_positions).not.toContain('reels')
  })
})

describe('adToMetaCreativeSpec', () => {
  it('builds object_story_spec for SINGLE_IMAGE', () => {
    const ad: Partial<Ad> = {
      name: 'Test Ad',
      format: 'SINGLE_IMAGE',
      inlineImageUrl: 'https://x.com/i.jpg',
      copy: {
        primaryText: 'Buy',
        headline: 'Sale',
        description: 'Now',
        callToAction: 'SHOP_NOW',
        destinationUrl: 'https://x.com/buy',
      },
    }
    const spec = adToMetaCreativeSpec(ad as Ad, 'page_123', 'imghash_abc')
    expect(spec.object_story_spec.page_id).toBe('page_123')
    expect(spec.object_story_spec.link_data.image_hash).toBe('imghash_abc')
    expect(spec.object_story_spec.link_data.link).toBe('https://x.com/buy')
    expect(spec.object_story_spec.link_data.message).toBe('Buy')
    expect(spec.object_story_spec.link_data.name).toBe('Sale')
    expect(spec.object_story_spec.link_data.description).toBe('Now')
    expect(spec.object_story_spec.link_data.call_to_action!.type).toBe('SHOP_NOW')
  })

  it('builds child_attachments for CAROUSEL', () => {
    const ad: Partial<Ad> = {
      name: 'Carousel Ad',
      format: 'CAROUSEL',
      inlineCarouselUrls: ['https://x.com/1.jpg', 'https://x.com/2.jpg'],
      copy: {
        primaryText: 'Buy',
        headline: 'Sale',
        callToAction: 'SHOP_NOW',
        destinationUrl: 'https://x.com/buy',
      },
    }
    const spec = adToMetaCreativeSpec(ad as Ad, 'page_123', ['h1', 'h2'])
    const attachments = spec.object_story_spec.link_data.child_attachments
    expect(attachments).toHaveLength(2)
    expect(attachments![0].image_hash).toBe('h1')
    expect(attachments![1].image_hash).toBe('h2')
  })
})
