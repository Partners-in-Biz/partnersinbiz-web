// __tests__/lib/ads/providers/google/campaigns-pmax.test.ts
import {
  createPmaxCampaign,
  pausePmaxCampaign,
  resumePmaxCampaign,
  removePmaxCampaign,
} from '@/lib/ads/providers/google/campaigns-pmax'
import type { AdCampaign } from '@/lib/ads/types'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

const baseCanonical: AdCampaign = {
  id: 'camp-pmax-1',
  orgId: 'org-1',
  platform: 'google',
  adAccountId: '1234567890',
  name: 'Test Pmax Campaign',
  status: 'DRAFT',
  objective: 'SALES',
  cboEnabled: false,
  specialAdCategories: [],
  providerData: {},
  createdBy: 'uid-1',
  createdAt: null as any,
  updatedAt: null as any,
}

function mockBudgetThenCampaign(budgetRn = 'customers/1234567890/campaignBudgets/100', campaignRn = 'customers/1234567890/campaigns/999') {
  ;(global.fetch as jest.Mock)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: budgetRn }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: campaignRn }] }) })
}

describe('Google Performance Max campaign helper', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('createPmaxCampaign with MAXIMIZE_CONVERSIONS default issues 2 fetches and sets advertisingChannelType', async () => {
    mockBudgetThenCampaign()

    const result = await createPmaxCampaign({ ...baseArgs, canonical: baseCanonical, dailyBudgetMajor: 20 })

    expect(result).toEqual({ resourceName: 'customers/1234567890/campaigns/999', id: '999' })
    expect(global.fetch).toHaveBeenCalledTimes(2)

    // Second call is the campaign creation
    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const op = body.operations[0].create
    expect(op.advertisingChannelType).toBe('PERFORMANCE_MAX')
    expect(op).not.toHaveProperty('advertisingChannelSubType')
    expect(op).not.toHaveProperty('networkSettings')
    expect(op.maximizeConversions).toEqual({})
  })

  it('createPmaxCampaign with TARGET_CPA converts targetCpaMajor to micros', async () => {
    mockBudgetThenCampaign()

    await createPmaxCampaign({
      ...baseArgs,
      canonical: baseCanonical,
      biddingStrategy: 'TARGET_CPA',
      targetCpaMajor: 5,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const op = body.operations[0].create
    expect(op.targetCpa).toEqual({ targetCpaMicros: '5000000' })
    expect(op).not.toHaveProperty('maximizeConversions')
  })

  it('createPmaxCampaign with TARGET_ROAS uses fractional targetRoas', async () => {
    mockBudgetThenCampaign()

    await createPmaxCampaign({
      ...baseArgs,
      canonical: baseCanonical,
      biddingStrategy: 'TARGET_ROAS',
      targetRoas: 4.0,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const op = body.operations[0].create
    expect(op.targetRoas).toEqual({ targetRoas: 4.0 })
  })

  it('createPmaxCampaign with MAXIMIZE_CONVERSION_VALUE + targetRoas passes targetRoas', async () => {
    mockBudgetThenCampaign()

    await createPmaxCampaign({
      ...baseArgs,
      canonical: baseCanonical,
      biddingStrategy: 'MAXIMIZE_CONVERSION_VALUE',
      targetRoas: 2.5,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[1]
    const body = JSON.parse(init.body as string)
    const op = body.operations[0].create
    expect(op.maximizeConversionValue).toEqual({ targetRoas: 2.5 })
  })

  it('pausePmaxCampaign sends status PAUSED with correct updateMask', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await pausePmaxCampaign({ ...baseArgs, resourceName: 'customers/1234567890/campaigns/999' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/campaigns:mutate/)
    const body = JSON.parse(init.body as string)
    const op = body.operations[0]
    expect(op.update.status).toBe('PAUSED')
    expect(op.updateMask).toBe('status')
  })

  it('resumePmaxCampaign sends status ENABLED and removePmaxCampaign sends remove op', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) })

    await resumePmaxCampaign({ ...baseArgs, resourceName: 'customers/1234567890/campaigns/999' })
    const resumeBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)
    expect(resumeBody.operations[0].update.status).toBe('ENABLED')

    ;(global.fetch as jest.Mock).mockReset()
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) })

    await removePmaxCampaign({ ...baseArgs, resourceName: 'customers/1234567890/campaigns/999' })
    const removeBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)
    expect(removeBody.operations[0]).toEqual({ remove: 'customers/1234567890/campaigns/999' })
  })
})
