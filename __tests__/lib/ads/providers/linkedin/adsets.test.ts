// __tests__/lib/ads/providers/linkedin/adsets.test.ts
// Unit tests for LinkedIn Campaign CRUD (PiB AdSet) — Sub-3b Phase 2 Batch 2B.

import {
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
} from '@/lib/ads/providers/linkedin/adsets'
import type { AdSet } from '@/lib/ads/types'

global.fetch = jest.fn() as any

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const BASE_CANONICAL: AdSet = {
  id: 'adset-001',
  orgId: 'org-001',
  campaignId: 'campaign-001',
  platform: 'linkedin',
  name: 'Test LinkedIn Campaign',
  status: 'ACTIVE',
  optimizationGoal: 'IMPRESSIONS',
  billingEvent: 'IMPRESSIONS',
  targeting: {
    geo: {},
    demographics: { ageMin: 18, ageMax: 65 },
  },
  placements: { feeds: true, stories: false, reels: false, marketplace: false },
  providerData: {},
  createdAt: { toDate: () => new Date() } as any,
  updatedAt: { toDate: () => new Date() } as any,
}

const BASE_CALL_ARGS = {
  accountUrn: 'urn:li:sponsoredAccount:123456',
  accessToken: 'test-access-token',
}

const CAMPAIGN_GROUP_URN = 'urn:li:sponsoredCampaignGroup:789'
const OBJECTIVE_TYPE = 'WEBSITE_VISIT' as const

/** Build a minimal 201 response with an X-RestLi-Id header */
function mockCreatedResponse(id: string) {
  return {
    ok: true,
    status: 201,
    headers: {
      get: (h: string) => (h === 'X-RestLi-Id' ? id : null),
    },
    text: async () => '',
  }
}

/** Build a 204 No-Content update response */
function mockUpdateResponse() {
  return {
    ok: true,
    status: 204,
    headers: { get: () => null },
    text: async () => '',
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LinkedIn Campaign (AdSet) CRUD', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  // Test 1 — createCampaign: minimum required args, default type + costType, correct URN result
  it('createCampaign sends POST with account + campaignGroup URN + name + objectiveType + SPONSORED_UPDATES type + CPM costType', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockCreatedResponse('99999'))

    const result = await createCampaign({
      ...BASE_CALL_ARGS,
      canonical: BASE_CANONICAL,
      campaignGroupUrn: CAMPAIGN_GROUP_URN,
      objectiveType: OBJECTIVE_TYPE,
    })

    // Result URN must be the sponsoredCampaign namespace
    expect(result).toEqual({
      urn: 'urn:li:sponsoredCampaign:99999',
      id: '99999',
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // Correct endpoint
    expect(url).toMatch(/\/adAccounts\/123456\/adCampaigns$/)
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.account).toBe('urn:li:sponsoredAccount:123456')
    expect(body.campaignGroup).toBe(CAMPAIGN_GROUP_URN)
    expect(body.name).toBe('Test LinkedIn Campaign')
    expect(body.objectiveType).toBe('WEBSITE_VISIT')
    expect(body.type).toBe('SPONSORED_UPDATES')
    expect(body.costType).toBe('CPM')
    expect(body.status).toBe('ACTIVE')
  })

  // Test 2 — createCampaign: dailyBudgetMajor → dailyBudget money object
  it('createCampaign honours dailyBudgetMajor → dailyBudget.amount: "50.00"', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockCreatedResponse('11111'))

    await createCampaign({
      ...BASE_CALL_ARGS,
      canonical: BASE_CANONICAL,
      campaignGroupUrn: CAMPAIGN_GROUP_URN,
      objectiveType: OBJECTIVE_TYPE,
      dailyBudgetMajor: 50,
      currencyCode: 'USD',
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.dailyBudget).toEqual({ amount: '50.00', currencyCode: 'USD' })
  })

  // Test 3 — createCampaign: targetingCriteria from canonical geo countries
  it('createCampaign includes targetingCriteria from canonical geo.countries', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockCreatedResponse('22222'))

    const canonicalWithGeo: AdSet = {
      ...BASE_CANONICAL,
      targeting: {
        geo: { countries: ['US', 'CA'] },
        demographics: { ageMin: 18, ageMax: 65 },
      },
    }

    await createCampaign({
      ...BASE_CALL_ARGS,
      canonical: canonicalWithGeo,
      campaignGroupUrn: CAMPAIGN_GROUP_URN,
      objectiveType: OBJECTIVE_TYPE,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body)
    const orGroup = body.targetingCriteria?.include?.and?.[0]?.or
    expect(orGroup).toBeDefined()
    // Both country URNs must be present (lowercase iso codes)
    const locationUrns: string[] = orGroup['urn:li:adTargetingFacet:locations']
    expect(locationUrns).toContain('urn:li:country:us')
    expect(locationUrns).toContain('urn:li:country:ca')
  })

  // Test 4 — createCampaign: runSchedule.start defaults to a recent epochMs
  it('createCampaign includes runSchedule.start defaulted to a recent epochMs when not supplied', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockCreatedResponse('33333'))

    const before = Date.now()
    await createCampaign({
      ...BASE_CALL_ARGS,
      canonical: BASE_CANONICAL,
      campaignGroupUrn: CAMPAIGN_GROUP_URN,
      objectiveType: OBJECTIVE_TYPE,
    })
    const after = Date.now()

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.runSchedule).toBeDefined()
    expect(typeof body.runSchedule.start).toBe('number')
    // Must be within the window of the test execution (±5s buffer)
    expect(body.runSchedule.start).toBeGreaterThanOrEqual(before - 5000)
    expect(body.runSchedule.start).toBeLessThanOrEqual(after + 5000)
  })

  // Test 5 — updateCampaign: PARTIAL_UPDATE header + $set patch wrapper
  it('updateCampaign uses X-RestLi-Method: PARTIAL_UPDATE and $set patch wrapper', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockUpdateResponse())

    await updateCampaign({
      ...BASE_CALL_ARGS,
      campaignUrn: 'urn:li:sponsoredCampaign:55555',
      patch: { name: 'Renamed Campaign', status: 'PAUSED' },
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/\/adAccounts\/123456\/adCampaigns\/55555$/)
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['X-RestLi-Method']).toBe('PARTIAL_UPDATE')

    const body = JSON.parse(init.body)
    expect(body.patch).toBeDefined()
    expect(body.patch.$set).toEqual({ name: 'Renamed Campaign', status: 'PAUSED' })
  })

  // Test 6 — convenience wrappers route to correct status values
  it('pauseCampaign / resumeCampaign / archiveCampaign each call updateCampaign with correct status', async () => {
    // Provide 3 responses, one per wrapper call
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockUpdateResponse())  // pause
      .mockResolvedValueOnce(mockUpdateResponse())  // resume
      .mockResolvedValueOnce(mockUpdateResponse())  // archive

    const sharedArgs = {
      ...BASE_CALL_ARGS,
      campaignUrn: 'urn:li:sponsoredCampaign:66666',
    }

    await pauseCampaign(sharedArgs)
    await resumeCampaign(sharedArgs)
    await archiveCampaign(sharedArgs)

    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(3)

    const pauseBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(pauseBody.patch.$set.status).toBe('PAUSED')

    const resumeBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)
    expect(resumeBody.patch.$set.status).toBe('ACTIVE')

    const archiveBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body)
    expect(archiveBody.patch.$set.status).toBe('ARCHIVED')
  })

  // Test 7 — createCampaign: throws on non-2xx response with error details
  it('createCampaign throws on non-2xx response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => 'UNPROCESSABLE_ENTITY: invalid targeting',
    })

    await expect(
      createCampaign({
        ...BASE_CALL_ARGS,
        canonical: BASE_CANONICAL,
        campaignGroupUrn: CAMPAIGN_GROUP_URN,
        objectiveType: OBJECTIVE_TYPE,
      }),
    ).rejects.toThrow(/LinkedIn campaign create failed/)
  })

  // Test 8 — createCampaign: Location header fallback when X-RestLi-Id absent
  it('createCampaign falls back to Location header when X-RestLi-Id is absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: {
        get: (h: string) => {
          if (h === 'X-RestLi-Id') return null
          if (h === 'Location') return '/rest/adAccounts/123456/adCampaigns/77777'
          return null
        },
      },
      text: async () => '',
    })

    const result = await createCampaign({
      ...BASE_CALL_ARGS,
      canonical: BASE_CANONICAL,
      campaignGroupUrn: CAMPAIGN_GROUP_URN,
      objectiveType: OBJECTIVE_TYPE,
    })

    expect(result).toEqual({
      urn: 'urn:li:sponsoredCampaign:77777',
      id: '77777',
    })
  })
})
