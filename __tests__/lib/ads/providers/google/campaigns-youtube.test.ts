// __tests__/lib/ads/providers/google/campaigns-youtube.test.ts
import {
  createVideoCampaign,
  updateVideoCampaign,
  pauseVideoCampaign,
  resumeVideoCampaign,
  removeVideoCampaign,
} from '@/lib/ads/providers/google/campaigns-youtube'
import type { AdCampaign } from '@/lib/ads/types'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

const baseCanonical: AdCampaign = {
  id: 'camp-yt-1',
  orgId: 'org-1',
  platform: 'google',
  adAccountId: '1234567890',
  name: 'Test YouTube Campaign',
  status: 'DRAFT',
  objective: 'SALES',
  cboEnabled: false,
  specialAdCategories: [],
  providerData: {},
  createdBy: 'uid-1',
  createdAt: null as any,
  updatedAt: null as any,
}

function mockBudgetThenCampaign(budgetRn: string, campaignRn: string) {
  ;(global.fetch as jest.Mock)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ resourceName: budgetRn }] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ resourceName: campaignRn }] }),
    })
}

describe('Google YouTube Video campaign helper', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('createVideoCampaign issues 2 fetch calls (budget then campaign)', async () => {
    mockBudgetThenCampaign(
      'customers/1234567890/campaignBudgets/300',
      'customers/1234567890/campaigns/900',
    )

    const result = await createVideoCampaign({
      ...baseArgs,
      canonical: baseCanonical,
      dailyBudgetMajor: 20,
    })

    expect(result).toEqual({ resourceName: 'customers/1234567890/campaigns/900', id: '900' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('campaign body has advertisingChannelType: VIDEO and advertisingChannelSubType: VIDEO_ACTION', async () => {
    mockBudgetThenCampaign(
      'customers/1234567890/campaignBudgets/301',
      'customers/1234567890/campaigns/901',
    )

    await createVideoCampaign({ ...baseArgs, canonical: baseCanonical })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const create = body.operations[0].create
    expect(create.advertisingChannelType).toBe('VIDEO')
    expect(create.advertisingChannelSubType).toBe('VIDEO_ACTION')
  })

  it('campaign body has maximizeConversions: {} by default (no targetCpa)', async () => {
    mockBudgetThenCampaign(
      'customers/1234567890/campaignBudgets/302',
      'customers/1234567890/campaigns/902',
    )

    await createVideoCampaign({ ...baseArgs, canonical: baseCanonical })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    expect(body.operations[0].create.maximizeConversions).toEqual({})
  })

  it('budget amountMicros converts dailyBudgetMajor to micros string', async () => {
    mockBudgetThenCampaign(
      'customers/1234567890/campaignBudgets/303',
      'customers/1234567890/campaigns/903',
    )

    await createVideoCampaign({ ...baseArgs, canonical: baseCanonical, dailyBudgetMajor: 25 })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)
    // 25 major → 25_000_000 micros
    expect(body.operations[0].create.amountMicros).toBe('25000000')
  })

  it('network settings target content network only (YouTube delivery)', async () => {
    mockBudgetThenCampaign(
      'customers/1234567890/campaignBudgets/304',
      'customers/1234567890/campaigns/904',
    )

    await createVideoCampaign({ ...baseArgs, canonical: baseCanonical })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const ns = body.operations[0].create.networkSettings
    expect(ns.targetGoogleSearch).toBe(false)
    expect(ns.targetSearchNetwork).toBe(false)
    expect(ns.targetContentNetwork).toBe(true)
    expect(ns.targetPartnerSearchNetwork).toBe(false)
  })

  it('removeVideoCampaign issues {remove: resourceName} operation', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    })

    await removeVideoCampaign({ ...baseArgs, resourceName: 'customers/1234567890/campaigns/555' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/campaigns:mutate/)
    const body = JSON.parse(init.body as string)
    expect(body.operations[0]).toEqual({ remove: 'customers/1234567890/campaigns/555' })
  })
})
