// __tests__/lib/ads/providers/linkedin/insights.test.ts
// LinkedIn /rest/adAnalytics provider — Phase 4 Batch 1.

import {
  levelMappingFor,
  expandDateRange,
  chunkDateRange,
  buildInsightsUrl,
  parseInsightElement,
  pullInsights,
} from '@/lib/ads/providers/linkedin/insights'

// ─── 1. levelMappingFor — 3 level cases ──────────────────────────────────────

describe('levelMappingFor', () => {
  it('campaign → CAMPAIGN_GROUP + campaignGroups', () => {
    const m = levelMappingFor('campaign')
    expect(m.pivot).toBe('CAMPAIGN_GROUP')
    expect(m.urnListParam).toBe('campaignGroups')
  })

  it('adset → CAMPAIGN + campaigns', () => {
    const m = levelMappingFor('adset')
    expect(m.pivot).toBe('CAMPAIGN')
    expect(m.urnListParam).toBe('campaigns')
  })

  it('ad → CREATIVE + creatives', () => {
    const m = levelMappingFor('ad')
    expect(m.pivot).toBe('CREATIVE')
    expect(m.urnListParam).toBe('creatives')
  })
})

// ─── 2. expandDateRange ───────────────────────────────────────────────────────

describe('expandDateRange', () => {
  it('start === end → exactly 1 date', () => {
    const result = expandDateRange('2026-05-01', '2026-05-01')
    expect(result).toEqual(['2026-05-01'])
  })

  it('3-day range → 3 dates inclusive', () => {
    const result = expandDateRange('2026-05-01', '2026-05-03')
    expect(result).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })
})

// ─── 3. expandDateRange — invalid range ──────────────────────────────────────

describe('expandDateRange invalid', () => {
  it('returns empty array when end < start', () => {
    expect(expandDateRange('2026-05-10', '2026-05-01')).toEqual([])
  })

  it('returns empty array for garbage input', () => {
    expect(expandDateRange('not-a-date', '2026-05-01')).toEqual([])
  })
})

// ─── 4. chunkDateRange — 90-day range → 3 30-day chunks ─────────────────────

describe('chunkDateRange — 90-day range', () => {
  // 2026-01-01 to 2026-03-31 = 90 days inclusive
  it('splits 90-day range into 3 chunks of 30', () => {
    const chunks = chunkDateRange('2026-01-01', '2026-03-31', 30)
    expect(chunks).toHaveLength(3)
    // chunk boundaries
    expect(chunks[0].start).toBe('2026-01-01')
    expect(chunks[0].end).toBe('2026-01-30')
    expect(chunks[1].start).toBe('2026-01-31')
    expect(chunks[1].end).toBe('2026-03-01')
    expect(chunks[2].start).toBe('2026-03-02')
    expect(chunks[2].end).toBe('2026-03-31')
  })
})

// ─── 5. chunkDateRange — short range stays as single chunk ───────────────────

describe('chunkDateRange — short range', () => {
  it('5-day range is a single chunk with default 30-day setting', () => {
    const chunks = chunkDateRange('2026-05-01', '2026-05-05')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].start).toBe('2026-05-01')
    expect(chunks[0].end).toBe('2026-05-05')
  })
})

// ─── 6. buildInsightsUrl — adset level ───────────────────────────────────────

describe('buildInsightsUrl — adset level', () => {
  const url = buildInsightsUrl({
    level: 'adset',
    ids: ['urn:li:sponsoredCampaign:333'],
    startIso: '2026-05-01',
    endIso: '2026-05-15',
  })

  it('uses CAMPAIGN pivot', () => {
    expect(url).toContain('pivot=CAMPAIGN')
    expect(url).not.toContain('CAMPAIGN_GROUP')
  })

  it('uses campaigns= URN list param', () => {
    // URL-encoded colons are acceptable; check key and URN numeric id presence
    expect(url).toContain('campaigns=')
    expect(url).toContain('333')
  })

  it('includes dateRange day/month/year params', () => {
    expect(url).toContain('dateRange.start.day=1')
    expect(url).toContain('dateRange.start.month=5')
    expect(url).toContain('dateRange.start.year=2026')
    expect(url).toContain('dateRange.end.day=15')
    expect(url).toContain('dateRange.end.month=5')
    expect(url).toContain('dateRange.end.year=2026')
  })

  it('includes fields param with expected metric names', () => {
    expect(url).toContain('fields=')
    expect(url).toContain('impressions')
    expect(url).toContain('clicks')
    expect(url).toContain('costInLocalCurrency')
  })
})

// ─── 7. buildInsightsUrl — campaign level ────────────────────────────────────

describe('buildInsightsUrl — campaign level', () => {
  const url = buildInsightsUrl({
    level: 'campaign',
    ids: ['urn:li:sponsoredCampaignGroup:111', 'urn:li:sponsoredCampaignGroup:222'],
    startIso: '2026-05-01',
    endIso: '2026-05-01',
  })

  it('uses CAMPAIGN_GROUP pivot', () => {
    expect(url).toContain('pivot=CAMPAIGN_GROUP')
  })

  it('uses campaignGroups= param with both IDs', () => {
    expect(url).toContain('campaignGroups=')
    expect(url).toContain('111')
    expect(url).toContain('222')
  })
})

// ─── 8. buildInsightsUrl — ad level ──────────────────────────────────────────

describe('buildInsightsUrl — ad level', () => {
  const url = buildInsightsUrl({
    level: 'ad',
    ids: ['urn:li:sponsoredCreative:444'],
    startIso: '2026-05-01',
    endIso: '2026-05-01',
  })

  it('uses CREATIVE pivot', () => {
    expect(url).toContain('pivot=CREATIVE')
  })

  it('uses creatives= param', () => {
    expect(url).toContain('creatives=')
    expect(url).toContain('444')
  })
})

// ─── 9. parseInsightElement — maps response fields ───────────────────────────

describe('parseInsightElement', () => {
  const el = {
    dateRange: { start: { day: 3, month: 5, year: 2026 }, end: { day: 3, month: 5, year: 2026 } },
    impressions: 1000,
    clicks: 50,
    costInLocalCurrency: '12.34',
    oneClickLeads: 2,
    landingPageClicks: 45,
    videoViews: 10,
    externalWebsiteConversions: 3,
    conversionValueInLocalCurrency: '99.00',
    pivotValues: ['urn:li:sponsoredCampaign:333'],
  }

  it('maps all fields correctly', () => {
    const row = parseInsightElement(el, 'USD')
    expect(row).not.toBeNull()
    expect(row!.date).toBe('2026-05-03')
    expect(row!.entityUrn).toBe('urn:li:sponsoredCampaign:333')
    expect(row!.entityId).toBe('333')
    expect(row!.impressions).toBe(1000)
    expect(row!.clicks).toBe(50)
    expect(row!.spendMajor).toBeCloseTo(12.34)
    expect(row!.spendCents).toBe(1234)
    expect(row!.currencyCode).toBe('USD')
    expect(row!.conversions).toBe(3)
    expect(row!.leads).toBe(2)
    expect(row!.landingPageClicks).toBe(45)
    expect(row!.videoViews).toBe(10)
    expect(row!.conversionValueMajor).toBeCloseTo(99.0)
  })
})

// ─── 10. parseInsightElement — returns null when dateRange.start missing ──────

describe('parseInsightElement defensive', () => {
  it('returns null when dateRange.start is missing', () => {
    const el = { dateRange: {}, impressions: 100 }
    expect(parseInsightElement(el, 'USD')).toBeNull()
  })

  it('returns null when dateRange itself is missing', () => {
    const el = { impressions: 100 }
    expect(parseInsightElement(el, 'USD')).toBeNull()
  })
})

// ─── 11. pullInsights — empty ids → empty result ─────────────────────────────

describe('pullInsights — empty ids', () => {
  it('returns empty array without calling fetch', async () => {
    const mockFetch = jest.fn()
    const result = await pullInsights({
      level: 'adset',
      ids: [],
      dateRange: { start: '2026-05-01', end: '2026-05-10' },
      accessToken: 'tok',
      currencyCode: 'USD',
      fetchImpl: mockFetch,
    })
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── 12. pullInsights — 90-day range fires 3 chunked fetch calls ─────────────

describe('pullInsights — 90-day range chunking', () => {
  it('fires 3 fetch calls and concatenates results', async () => {
    const makeElement = (day: number) => ({
      dateRange: { start: { day, month: 1, year: 2026 }, end: { day, month: 1, year: 2026 } },
      impressions: 100,
      clicks: 10,
      costInLocalCurrency: '5.00',
      oneClickLeads: 0,
      landingPageClicks: 8,
      videoViews: 0,
      externalWebsiteConversions: 1,
      conversionValueInLocalCurrency: '0',
      pivotValues: ['urn:li:sponsoredCampaign:999'],
    })

    const mockFetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ elements: [makeElement(1)] }),
        text: async () => '',
      })
    )

    const result = await pullInsights({
      level: 'adset',
      ids: ['urn:li:sponsoredCampaign:999'],
      dateRange: { start: '2026-01-01', end: '2026-03-31' },
      accessToken: 'tok',
      currencyCode: 'USD',
      fetchImpl: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(3)
  })
})

// ─── 13. pullInsights — throws on HTTP error ──────────────────────────────────

describe('pullInsights — HTTP error', () => {
  it('throws with status code in message on 500', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })

    await expect(
      pullInsights({
        level: 'campaign',
        ids: ['urn:li:sponsoredCampaignGroup:111'],
        dateRange: { start: '2026-05-01', end: '2026-05-01' },
        accessToken: 'tok',
        currencyCode: 'USD',
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow('500')
  })
})

// ─── 14. pullInsights — sends correct auth + version headers ──────────────────

describe('pullInsights — headers', () => {
  it('sends Authorization Bearer + LinkedIn-Version headers', async () => {
    let capturedHeaders: Record<string, string> = {}

    const mockFetch = jest.fn().mockImplementation((_url: string, opts: RequestInit) => {
      capturedHeaders = opts.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ elements: [] }),
        text: async () => '',
      })
    })

    await pullInsights({
      level: 'adset',
      ids: ['urn:li:sponsoredCampaign:333'],
      dateRange: { start: '2026-05-01', end: '2026-05-01' },
      accessToken: 'my-secret-token',
      currencyCode: 'ZAR',
      fetchImpl: mockFetch,
    })

    expect(capturedHeaders['Authorization']).toBe('Bearer my-secret-token')
    expect(capturedHeaders['LinkedIn-Version']).toBeDefined()
  })
})
