// __tests__/lib/ads/providers/tiktok/insights.test.ts
// Sub-3c Phase 5 — TikTok /report/integrated/get/ provider tests

import {
  levelMappingFor,
  buildInsightsUrl,
  parseInsightElement,
  pullInsights,
} from '@/lib/ads/providers/tiktok/insights'

// ─── 1. levelMappingFor ───────────────────────────────────────────────────────

describe('levelMappingFor', () => {
  test('campaign → AUCTION_CAMPAIGN / campaign_id / campaign_ids', () => {
    const m = levelMappingFor('campaign')
    expect(m.dataLevel).toBe('AUCTION_CAMPAIGN')
    expect(m.dimensionKey).toBe('campaign_id')
    expect(m.filterField).toBe('campaign_ids')
  })

  test('adset → AUCTION_ADGROUP / adgroup_id / adgroup_ids', () => {
    const m = levelMappingFor('adset')
    expect(m.dataLevel).toBe('AUCTION_ADGROUP')
    expect(m.dimensionKey).toBe('adgroup_id')
    expect(m.filterField).toBe('adgroup_ids')
  })

  test('ad → AUCTION_AD / ad_id / ad_ids', () => {
    const m = levelMappingFor('ad')
    expect(m.dataLevel).toBe('AUCTION_AD')
    expect(m.dimensionKey).toBe('ad_id')
    expect(m.filterField).toBe('ad_ids')
  })
})

// ─── 2. buildInsightsUrl (campaign) ──────────────────────────────────────────

describe('buildInsightsUrl', () => {
  test('includes correct query params for campaign level', () => {
    const url = buildInsightsUrl({
      advertiserId: 'adv-123',
      level: 'campaign',
      ids: ['camp-1', 'camp-2'],
      startIso: '2026-05-01',
      endIso: '2026-05-07',
    })

    const u = new URL(url)
    expect(u.searchParams.get('advertiser_id')).toBe('adv-123')
    expect(u.searchParams.get('report_type')).toBe('BASIC')
    expect(u.searchParams.get('data_level')).toBe('AUCTION_CAMPAIGN')

    const dimensions = JSON.parse(u.searchParams.get('dimensions') ?? '[]')
    expect(dimensions).toEqual(['campaign_id', 'stat_time_day'])

    const metrics = JSON.parse(u.searchParams.get('metrics') ?? '[]')
    expect(metrics).toContain('impressions')
    expect(metrics).toContain('clicks')
    expect(metrics).toContain('spend')
    expect(metrics).toContain('ctr')

    expect(u.searchParams.get('start_date')).toBe('2026-05-01')
    expect(u.searchParams.get('end_date')).toBe('2026-05-07')

    const filters = JSON.parse(u.searchParams.get('filters') ?? '[]')
    expect(filters[0].field_name).toBe('campaign_ids')
    expect(filters[0].filter_type).toBe('IN')
    const filterValue = JSON.parse(filters[0].filter_value)
    expect(filterValue).toEqual(['camp-1', 'camp-2'])
  })

  // ─── 3. buildInsightsUrl (adset) ───────────────────────────────────────────

  test('adset level uses AUCTION_ADGROUP and adgroup_ids in filters', () => {
    const url = buildInsightsUrl({
      advertiserId: 'adv-456',
      level: 'adset',
      ids: ['ag-1'],
      startIso: '2026-05-01',
      endIso: '2026-05-07',
    })

    const u = new URL(url)
    expect(u.searchParams.get('data_level')).toBe('AUCTION_ADGROUP')

    const dimensions = JSON.parse(u.searchParams.get('dimensions') ?? '[]')
    expect(dimensions[0]).toBe('adgroup_id')

    const filters = JSON.parse(u.searchParams.get('filters') ?? '[]')
    expect(filters[0].field_name).toBe('adgroup_ids')
  })
})

// ─── 4. parseInsightElement — happy path ─────────────────────────────────────

describe('parseInsightElement', () => {
  const baseEl = {
    dimensions: { campaign_id: '999', stat_time_day: '2026-05-10 00:00:00' },
    metrics: {
      impressions: '200',
      clicks: '10',
      spend: '12.34',
      conversion: '3',
      cpc: '1.234',
      cpm: '61.7',
      ctr: '5.0',
      reach: '180',
    },
  }

  test('maps response fields correctly; spend "12.34" → 12.34 major + 1234 cents', () => {
    const row = parseInsightElement(baseEl, 'USD', 'campaign_id')
    expect(row).not.toBeNull()
    expect(row!.date).toBe('2026-05-10')
    expect(row!.entityId).toBe('999')
    expect(row!.impressions).toBe(200)
    expect(row!.clicks).toBe(10)
    expect(row!.spendMajor).toBeCloseTo(12.34)
    expect(row!.spendCents).toBe(1234)
    expect(row!.currencyCode).toBe('USD')
    expect(row!.conversions).toBe(3)
    expect(row!.cpc).toBeCloseTo(1.234)
    expect(row!.cpm).toBeCloseTo(61.7)
    expect(row!.ctr).toBeCloseTo(5.0)
    expect(row!.reach).toBe(180)
  })

  // ─── 5. parseInsightElement — missing dimensions ──────────────────────────

  test('returns null when dimensions are missing', () => {
    expect(parseInsightElement({ metrics: baseEl.metrics }, 'USD', 'campaign_id')).toBeNull()
  })

  test('returns null when metrics are missing', () => {
    expect(parseInsightElement({ dimensions: baseEl.dimensions }, 'USD', 'campaign_id')).toBeNull()
  })

  test('returns null when entityId is empty string', () => {
    const el = {
      dimensions: { campaign_id: '', stat_time_day: '2026-05-10 00:00:00' },
      metrics: baseEl.metrics,
    }
    expect(parseInsightElement(el, 'USD', 'campaign_id')).toBeNull()
  })
})

// ─── 6–10. pullInsights ───────────────────────────────────────────────────────

describe('pullInsights', () => {
  // ─── 6. empty ids → no fetch ───────────────────────────────────────────────

  test('returns empty array without calling fetch when ids is empty', async () => {
    const mockFetch = jest.fn()
    const result = await pullInsights({
      advertiserId: 'adv-1',
      accessToken: 'tok',
      level: 'campaign',
      ids: [],
      dateRange: { start: '2026-05-01', end: '2026-05-07' },
      currencyCode: 'USD',
      fetchImpl: mockFetch as unknown as typeof fetch,
    })
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // ─── 7. GET to correct endpoint with Access-Token header ──────────────────

  test('issues GET to /report/integrated/get/ with Access-Token header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK', data: { list: [], page_info: { total_number: 0 } } }),
    })

    await pullInsights({
      advertiserId: 'adv-1',
      accessToken: 'my-access-token',
      level: 'campaign',
      ids: ['camp-1'],
      dateRange: { start: '2026-05-01', end: '2026-05-07' },
      currencyCode: 'USD',
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/report/integrated/get/')
    expect(calledInit.method).toBe('GET')
    expect((calledInit.headers as Record<string, string>)['Access-Token']).toBe('my-access-token')
  })

  // ─── 8. throws on code !== 0 ──────────────────────────────────────────────

  test('throws when TikTok envelope code !== 0', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 40001, message: 'Unauthorized advertiser', data: {} }),
    })

    await expect(
      pullInsights({
        advertiserId: 'adv-bad',
        accessToken: 'tok',
        level: 'campaign',
        ids: ['camp-1'],
        dateRange: { start: '2026-05-01', end: '2026-05-07' },
        currencyCode: 'USD',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/code=40001.*Unauthorized advertiser/)
  })

  // ─── 9. throws on HTTP non-ok ─────────────────────────────────────────────

  test('throws on HTTP non-ok response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })

    await expect(
      pullInsights({
        advertiserId: 'adv-1',
        accessToken: 'tok',
        level: 'campaign',
        ids: ['camp-1'],
        dateRange: { start: '2026-05-01', end: '2026-05-07' },
        currencyCode: 'USD',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 429/)
  })

  // ─── 10. returns mapped rows ──────────────────────────────────────────────

  test('returns mapped TiktokDailyInsightRow[] from list response', async () => {
    const mockList = [
      {
        dimensions: { campaign_id: '111', stat_time_day: '2026-05-05 00:00:00' },
        metrics: {
          impressions: '500',
          clicks: '25',
          spend: '50.00',
          conversion: '5',
          cpc: '2.00',
          cpm: '100.00',
          ctr: '5.0',
          reach: '450',
        },
      },
    ]

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: { list: mockList, page_info: { total_number: 1 } },
      }),
    })

    const rows = await pullInsights({
      advertiserId: 'adv-1',
      accessToken: 'tok',
      level: 'campaign',
      ids: ['111'],
      dateRange: { start: '2026-05-05', end: '2026-05-05' },
      currencyCode: 'EUR',
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].entityId).toBe('111')
    expect(rows[0].date).toBe('2026-05-05')
    expect(rows[0].impressions).toBe(500)
    expect(rows[0].clicks).toBe(25)
    expect(rows[0].spendMajor).toBeCloseTo(50.0)
    expect(rows[0].spendCents).toBe(5000)
    expect(rows[0].currencyCode).toBe('EUR')
  })
})
