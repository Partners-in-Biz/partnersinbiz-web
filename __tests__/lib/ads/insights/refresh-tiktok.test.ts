// __tests__/lib/ads/insights/refresh-tiktok.test.ts
// Sub-3c Phase 5 — TikTok arm of refreshEntityInsights

import { refreshEntityInsights, mapTiktokInsightRow } from '@/lib/ads/insights/refresh'
import type { TiktokDailyInsightRow } from '@/lib/ads/providers/tiktok/insights'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPullTiktokInsights = jest.fn()

jest.mock('@/lib/ads/providers/tiktok/insights', () => ({
  pullInsights: (...args: unknown[]) => mockPullTiktokInsights(...args),
}))

// Shared Firestore batch mock
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn().mockResolvedValue(undefined)
const mockBatch = jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }))

const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
const mockDocRef = jest.fn(() => ({ update: mockDocUpdate }))
const mockCollRef = jest.fn((_name: string) => ({ doc: mockDocRef }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    batch: () => mockBatch(),
    collection: (name: string) => mockCollRef(name),
  },
}))

// Silence other provider imports
jest.mock('@/lib/ads/providers/meta', () => ({ metaProvider: {} }))
jest.mock('@/lib/ads/providers/google/insights', () => ({ fetchInsights: jest.fn() }))
jest.mock('@/lib/ads/providers/linkedin/insights', () => ({ pullInsights: jest.fn() }))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({ readDeveloperToken: jest.fn() }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ROW: TiktokDailyInsightRow = {
  date: '2026-05-15',
  entityId: '777888',
  impressions: 1000,
  clicks: 50,
  spendMajor: 25.5,
  spendCents: 2550,
  currencyCode: 'USD',
  conversions: 5,
  cpc: 0.51,
  cpm: 25.5,
  ctr: 5.0,
  reach: 900,
}

const BASE_ROW_2: TiktokDailyInsightRow = {
  ...BASE_ROW,
  date: '2026-05-16',
  impressions: 2000,
  clicks: 100,
  spendMajor: 51.0,
  spendCents: 5100,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockBatchSet.mockReset()
  mockBatchCommit.mockResolvedValue(undefined)
  mockDocUpdate.mockResolvedValue(undefined)
})

describe('refreshEntityInsights — TikTok dispatch', () => {
  // ─── 11. dispatches to TikTok arm ──────────────────────────────────────────

  test('11. dispatches to TikTok arm and calls pullInsights with correct args', async () => {
    mockPullTiktokInsights.mockResolvedValue([BASE_ROW])

    await refreshEntityInsights({
      platform: 'tiktok',
      orgId: 'org-tt',
      accessToken: 'tiktok-token',
      pibEntityId: 'camp-pib-99',
      advertiserId: 'adv-123',
      tiktokEntityId: '777888',
      level: 'campaign',
      currencyCode: 'USD',
      daysBack: 7,
    })

    expect(mockPullTiktokInsights).toHaveBeenCalledTimes(1)
    const callArgs = mockPullTiktokInsights.mock.calls[0][0]
    expect(callArgs.advertiserId).toBe('adv-123')
    expect(callArgs.accessToken).toBe('tiktok-token')
    expect(callArgs.level).toBe('campaign')
    expect(callArgs.ids).toEqual(['777888'])
    expect(callArgs.currencyCode).toBe('USD')
    expect(callArgs.dateRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(callArgs.dateRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // ─── 12. writes metrics docs with source=tiktok_ads ───────────────────────

  test('12. writes metrics docs with source=tiktok_ads and correct shape', async () => {
    mockPullTiktokInsights.mockResolvedValue([BASE_ROW])

    await refreshEntityInsights({
      platform: 'tiktok',
      orgId: 'org-tt',
      accessToken: 'tiktok-token',
      pibEntityId: 'camp-pib-99',
      advertiserId: 'adv-123',
      tiktokEntityId: '777888',
      level: 'campaign',
      currencyCode: 'USD',
    })

    // 8 metrics per row: impressions, clicks, spend_cents, conversions, cpc_cents, cpm_cents, ctr, reach
    expect(mockBatchSet).toHaveBeenCalledTimes(8)

    const firstCallArgs = mockBatchSet.mock.calls[0]
    const docData = firstCallArgs[1]
    expect(docData.orgId).toBe('org-tt')
    expect(docData.source).toBe('tiktok_ads')
    expect(docData.level).toBe('campaign')
    expect(docData.dimensionId).toBe('camp-pib-99')
    expect(docData.date).toBe('2026-05-15')
    expect(typeof docData.metric).toBe('string')
    expect(typeof docData.value).toBe('number')
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  // ─── 13. updates lastRefreshedAt on correct collection ────────────────────

  test('13. updates lastRefreshedAt on parent collection for each level', async () => {
    const levels: Array<{ level: 'campaign' | 'adset' | 'ad'; expectedCollection: string }> = [
      { level: 'campaign', expectedCollection: 'ad_campaigns' },
      { level: 'adset', expectedCollection: 'ad_sets' },
      { level: 'ad', expectedCollection: 'ads' },
    ]

    for (const { level, expectedCollection } of levels) {
      jest.clearAllMocks()
      mockBatchCommit.mockResolvedValue(undefined)
      mockDocUpdate.mockResolvedValue(undefined)
      mockPullTiktokInsights.mockResolvedValue([BASE_ROW])

      await refreshEntityInsights({
        platform: 'tiktok',
        orgId: 'org-tt',
        accessToken: 'tok',
        pibEntityId: 'ent-1',
        advertiserId: 'adv-1',
        tiktokEntityId: '999',
        level,
        currencyCode: 'USD',
      })

      expect(mockCollRef).toHaveBeenCalledWith(expectedCollection)
      expect(mockDocRef).toHaveBeenCalledWith('ent-1')
      expect(mockDocUpdate).toHaveBeenCalledWith({ lastRefreshedAt: expect.anything() })
    }
  })

  test('mapTiktokInsightRow produces all 8 canonical metric keys', () => {
    const metrics = mapTiktokInsightRow(BASE_ROW)
    const expectedKeys = [
      'impressions',
      'clicks',
      'spend_cents',
      'conversions',
      'cpc_cents',
      'cpm_cents',
      'ctr',
      'reach',
    ]
    for (const key of expectedKeys) {
      expect(metrics).toHaveProperty(key)
    }
    expect(metrics.impressions).toBe(1000)
    expect(metrics.clicks).toBe(50)
    expect(metrics.spend_cents).toBe(2550)
    expect(metrics.conversions).toBe(5)
    expect(metrics.cpc_cents).toBe(51) // 0.51 * 100
    expect(metrics.cpm_cents).toBe(2550) // 25.5 * 100
    expect(metrics.ctr).toBe(5.0)
    expect(metrics.reach).toBe(900)
  })

  test('returns rowsWritten and daysProcessed matching row count', async () => {
    mockPullTiktokInsights.mockResolvedValue([BASE_ROW, BASE_ROW_2])

    const result = await refreshEntityInsights({
      platform: 'tiktok',
      orgId: 'org-tt',
      accessToken: 'tok',
      pibEntityId: 'camp-pib-99',
      advertiserId: 'adv-1',
      tiktokEntityId: '777888',
      level: 'campaign',
      currencyCode: 'USD',
    })

    // 2 rows × 8 metrics = 16 writes
    expect(result.rowsWritten).toBe(16)
    expect(result.daysProcessed).toBe(2)
  })
})
