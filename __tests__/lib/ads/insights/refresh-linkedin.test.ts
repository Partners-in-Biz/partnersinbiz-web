// __tests__/lib/ads/insights/refresh-linkedin.test.ts
// Phase 4 Batch 2 — LinkedIn arm of refreshEntityInsights

import { refreshEntityInsights, mapLinkedinInsightRow } from '@/lib/ads/insights/refresh'
import type { LinkedinDailyInsightRow } from '@/lib/ads/providers/linkedin/insights'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPullInsights = jest.fn()

jest.mock('@/lib/ads/providers/linkedin/insights', () => ({
  pullInsights: (...args: unknown[]) => mockPullInsights(...args),
}))

// Shared batch mock — we need references to spy on
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn().mockResolvedValue(undefined)
const mockBatch = jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }))

const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
const mockDocRef = jest.fn(() => ({ update: mockDocUpdate }))
const mockCollRef = jest.fn(() => ({ doc: mockDocRef }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    batch: () => mockBatch(),
    collection: (name: string) => mockCollRef(name),
  },
}))

// Silence other provider imports
jest.mock('@/lib/ads/providers/meta', () => ({ metaProvider: {} }))
jest.mock('@/lib/ads/providers/google/insights', () => ({ fetchInsights: jest.fn() }))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({ readDeveloperToken: jest.fn() }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ROW: LinkedinDailyInsightRow = {
  date: '2026-05-15',
  entityUrn: 'urn:li:sponsoredCampaignGroup:123',
  entityId: '123',
  impressions: 100,
  clicks: 5,
  spendMajor: 10.5,
  spendCents: 1050,
  currencyCode: 'USD',
  conversions: 1,
  leads: 0,
  landingPageClicks: 4,
  videoViews: 0,
  conversionValueMajor: 25,
}

const BASE_ROW_2: LinkedinDailyInsightRow = {
  date: '2026-05-16',
  entityUrn: 'urn:li:sponsoredCampaignGroup:123',
  entityId: '123',
  impressions: 200,
  clicks: 10,
  spendMajor: 20,
  spendCents: 2000,
  currencyCode: 'USD',
  conversions: 2,
  leads: 1,
  landingPageClicks: 8,
  videoViews: 3,
  conversionValueMajor: 50,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockBatchSet.mockReset()
  mockBatchCommit.mockResolvedValue(undefined)
  mockDocUpdate.mockResolvedValue(undefined)
})

describe('refreshEntityInsights — LinkedIn dispatch', () => {
  test('1. dispatches to LinkedIn arm and calls pullInsights with correct args', async () => {
    mockPullInsights.mockResolvedValue([BASE_ROW])

    await refreshEntityInsights({
      platform: 'linkedin',
      orgId: 'org-abc',
      accessToken: 'token-xyz',
      pibEntityId: 'campaign-pib-1',
      linkedinEntityUrn: 'urn:li:sponsoredCampaignGroup:123',
      level: 'campaign',
      currencyCode: 'USD',
      daysBack: 7,
    })

    expect(mockPullInsights).toHaveBeenCalledTimes(1)
    const callArgs = mockPullInsights.mock.calls[0][0]
    expect(callArgs.accessToken).toBe('token-xyz')
    expect(callArgs.level).toBe('campaign')
    expect(callArgs.ids).toEqual(['urn:li:sponsoredCampaignGroup:123'])
    expect(callArgs.currencyCode).toBe('USD')
    expect(callArgs.dateRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(callArgs.dateRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('2. writes metrics docs with source=linkedin_ads and correct shape', async () => {
    mockPullInsights.mockResolvedValue([BASE_ROW])

    await refreshEntityInsights({
      platform: 'linkedin',
      orgId: 'org-abc',
      accessToken: 'token-xyz',
      pibEntityId: 'campaign-pib-1',
      linkedinEntityUrn: 'urn:li:sponsoredCampaignGroup:123',
      level: 'campaign',
      currencyCode: 'USD',
    })

    // 8 metrics per row
    expect(mockBatchSet).toHaveBeenCalledTimes(8)
    const firstCallArgs = mockBatchSet.mock.calls[0]
    const docData = firstCallArgs[1]
    expect(docData.orgId).toBe('org-abc')
    expect(docData.source).toBe('linkedin_ads')
    expect(docData.level).toBe('campaign')
    expect(docData.dimensionId).toBe('campaign-pib-1')
    expect(docData.date).toBe('2026-05-15')
    expect(typeof docData.metric).toBe('string')
    expect(typeof docData.value).toBe('number')
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  test('3. updates lastRefreshedAt on correct collection for each level', async () => {
    const levels: Array<{ level: 'campaign' | 'adset' | 'ad'; expectedCollection: string }> = [
      { level: 'campaign', expectedCollection: 'ad_campaigns' },
      { level: 'adset', expectedCollection: 'ad_sets' },
      { level: 'ad', expectedCollection: 'ads' },
    ]

    for (const { level, expectedCollection } of levels) {
      jest.clearAllMocks()
      mockBatchCommit.mockResolvedValue(undefined)
      mockDocUpdate.mockResolvedValue(undefined)
      mockPullInsights.mockResolvedValue([BASE_ROW])

      await refreshEntityInsights({
        platform: 'linkedin',
        orgId: 'org-abc',
        accessToken: 'tok',
        pibEntityId: 'ent-1',
        linkedinEntityUrn: 'urn:li:sponsoredCampaignGroup:999',
        level,
        currencyCode: 'USD',
      })

      expect(mockCollRef).toHaveBeenCalledWith(expectedCollection)
      expect(mockDocRef).toHaveBeenCalledWith('ent-1')
      expect(mockDocUpdate).toHaveBeenCalledWith({ lastRefreshedAt: expect.anything() })
    }
  })

  test('4. mapLinkedinInsightRow produces all 8 canonical metric keys', () => {
    const metrics = mapLinkedinInsightRow(BASE_ROW)
    const expectedKeys = [
      'impressions',
      'clicks',
      'spend_cents',
      'conversions',
      'leads',
      'landing_page_clicks',
      'video_views',
      'conversion_value_cents',
    ]
    for (const key of expectedKeys) {
      expect(metrics).toHaveProperty(key)
    }
    expect(metrics.impressions).toBe(100)
    expect(metrics.clicks).toBe(5)
    expect(metrics.spend_cents).toBe(1050)
    expect(metrics.conversions).toBe(1)
    expect(metrics.leads).toBe(0)
    expect(metrics.landing_page_clicks).toBe(4)
    expect(metrics.video_views).toBe(0)
    expect(metrics.conversion_value_cents).toBe(2500) // 25 * 100
  })

  test('5. returns rowsWritten and daysProcessed matching row count', async () => {
    mockPullInsights.mockResolvedValue([BASE_ROW, BASE_ROW_2])

    const result = await refreshEntityInsights({
      platform: 'linkedin',
      orgId: 'org-abc',
      accessToken: 'tok',
      pibEntityId: 'campaign-pib-1',
      linkedinEntityUrn: 'urn:li:sponsoredCampaignGroup:123',
      level: 'campaign',
      currencyCode: 'USD',
    })

    // 2 rows × 8 metrics = 16 writes
    expect(result.rowsWritten).toBe(16)
    expect(result.daysProcessed).toBe(2)
  })
})
