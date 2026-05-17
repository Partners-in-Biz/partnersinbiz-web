// __tests__/lib/ads/providers/linkedin/types.test.ts
// Type-contract smoke tests — compile-time checks via runtime dummy assignments.
// These tests verify that the exported types accept valid values without TypeScript errors.

import type {
  LinkedinCampaignExtension,
  LinkedinAdSetExtension,
  LinkedinAdExtension,
} from '@/lib/ads/providers/linkedin/types'

describe('LinkedinCampaignExtension', () => {
  it('accepts all valid liStatus values', () => {
    const statuses: Array<NonNullable<LinkedinCampaignExtension['liStatus']>> = [
      'DRAFT',
      'ACTIVE',
      'ARCHIVED',
      'PAUSED',
      'PENDING_DELETION',
      'REMOVED',
      'COMPLETED',
    ]

    const extensions: LinkedinCampaignExtension[] = statuses.map((liStatus) => ({
      campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:12345',
      liStatus,
    }))

    // All 7 statuses should be accepted by the type — runtime check confirms array was built
    expect(extensions).toHaveLength(7)
    for (const ext of extensions) {
      expect(ext.campaignGroupUrn).toMatch(/^urn:li:sponsoredCampaignGroup:/)
    }
  })
})

describe('LinkedinAdSetExtension.liObjectiveType', () => {
  it('constrained to the 8 valid LinkedIn objective values', () => {
    const objectives: LinkedinAdSetExtension['liObjectiveType'][] = [
      'BRAND_AWARENESS',
      'WEBSITE_VISIT',
      'ENGAGEMENT',
      'VIDEO_VIEW',
      'LEAD_GENERATION',
      'WEBSITE_CONVERSION',
      'JOB_APPLICANT',
      'TALENT_LEADS',
    ]

    const extensions: LinkedinAdSetExtension[] = objectives.map((liObjectiveType) => ({
      campaignUrn: 'urn:li:sponsoredCampaign:42',
      liObjectiveType,
      liCampaignType: 'SPONSORED_UPDATES' as const,
    }))

    // All 8 objectives should be accepted — runtime check confirms array was built
    expect(extensions).toHaveLength(8)
    for (const ext of extensions) {
      expect(ext.campaignUrn).toMatch(/^urn:li:sponsoredCampaign:/)
    }
  })

  it('LinkedinAdExtension accepts all valid liStatus values', () => {
    const statuses: Array<NonNullable<LinkedinAdExtension['liStatus']>> = [
      'DRAFT',
      'ACTIVE',
      'ARCHIVED',
      'PAUSED',
      'PENDING_REVIEW',
      'REJECTED',
    ]

    const extensions: LinkedinAdExtension[] = statuses.map((liStatus) => ({
      creativeUrn: 'urn:li:sponsoredCreative:777',
      liStatus,
    }))

    expect(extensions).toHaveLength(6)
    for (const ext of extensions) {
      expect(ext.creativeUrn).toMatch(/^urn:li:sponsoredCreative:/)
    }
  })
})
