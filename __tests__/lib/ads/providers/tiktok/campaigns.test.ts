// __tests__/lib/ads/providers/tiktok/campaigns.test.ts
// Unit tests for Sub-3c Phase 2 Batch 2A — TikTok Campaign CRUD.

import {
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
} from '@/lib/ads/providers/tiktok/campaigns'
import type { AdCampaign } from '@/lib/ads/types'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

function makeFetchImpl(responseData: unknown = { campaign_id: '99999' }) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: 'OK', data: responseData }),
    text: async () => '',
  })
}

const CANONICAL_CAMPAIGN: AdCampaign = {
  id: 'pib-campaign-1',
  orgId: 'org-123',
  name: 'Test Campaign',
  platform: 'tiktok',
  adAccountId: 'acct-789',
  objective: 'TRAFFIC',
  status: 'ACTIVE',
  cboEnabled: false,
  specialAdCategories: [],
  providerData: {},
  createdBy: 'user-1',
  createdAt: null as any,
  updatedAt: null as any,
}

const BASE_ARGS = {
  advertiserId: 'adv-456',
  accessToken: 'tk-token',
}

describe('TikTok Campaign CRUD', () => {
  describe('createCampaign', () => {
    it('POSTs /campaign/create/ with advertiser_id, campaign_name, objective_type, operation_status, budget_mode', async () => {
      const fetchImpl = makeFetchImpl({ campaign_id: '99999' })

      await createCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_CAMPAIGN,
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/campaign/create/'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Access-Token': 'tk-token' }),
          body: expect.stringContaining('"campaign_name"'),
        }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.campaign_name).toBe('Test Campaign')
      expect(body.objective_type).toBe('TRAFFIC')
      expect(body.operation_status).toBe('ENABLE')
      expect(body.budget_mode).toBeDefined()
    })

    it('includes budget when budgetMajor is provided and budgetMode !== BUDGET_MODE_INFINITE', async () => {
      const fetchImpl = makeFetchImpl({ campaign_id: '99999' })

      await createCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_CAMPAIGN,
        budgetMajor: 100,
        budgetMode: 'BUDGET_MODE_DAY',
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.budget).toBe(100)
      expect(body.budget_mode).toBe('BUDGET_MODE_DAY')
    })

    it('defaults to BUDGET_MODE_INFINITE and omits budget when no budgetMajor passed', async () => {
      const fetchImpl = makeFetchImpl({ campaign_id: '99999' })

      await createCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_CAMPAIGN,
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.budget_mode).toBe('BUDGET_MODE_INFINITE')
      expect(body.budget).toBeUndefined()
    })

    it('returns { campaignId: "99999" } from response data', async () => {
      const fetchImpl = makeFetchImpl({ campaign_id: '99999' })

      const result = await createCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_CAMPAIGN,
      })

      expect(result).toEqual({ campaignId: '99999' })
    })
  })

  describe('updateCampaign', () => {
    it('POSTs /campaign/update/ with only the provided patch fields', async () => {
      const fetchImpl = makeFetchImpl({})

      await updateCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        campaignId: '99999',
        patch: { name: 'Updated Name' },
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/campaign/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.campaign_id).toBe('99999')
      expect(body.campaign_name).toBe('Updated Name')
      // budget not in patch — should not be present
      expect(body.budget).toBeUndefined()
    })
  })

  describe('pauseCampaign', () => {
    it('POSTs /campaign/status/update/ with operation_status DISABLE', async () => {
      const fetchImpl = makeFetchImpl({})

      await pauseCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        campaignId: '99999',
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/campaign/status/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.campaign_ids).toEqual(['99999'])
      expect(body.operation_status).toBe('DISABLE')
    })
  })

  describe('resumeCampaign / archiveCampaign', () => {
    it('resumeCampaign sends operation_status ENABLE', async () => {
      const fetchImpl = makeFetchImpl({})

      await resumeCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        campaignId: '99999',
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.operation_status).toBe('ENABLE')
    })

    it('archiveCampaign sends operation_status DELETE', async () => {
      const fetchImpl = makeFetchImpl({})

      await archiveCampaign({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        campaignId: '99999',
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.operation_status).toBe('DELETE')
    })
  })
})
