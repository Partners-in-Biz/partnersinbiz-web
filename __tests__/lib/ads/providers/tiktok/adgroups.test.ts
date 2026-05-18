// __tests__/lib/ads/providers/tiktok/adgroups.test.ts
// Unit tests for Sub-3c Phase 2 Batch 2B — TikTok AdGroup CRUD (PiB AdSet).

import {
  createAdGroup,
  updateAdGroup,
  pauseAdGroup,
  resumeAdGroup,
  archiveAdGroup,
} from '@/lib/ads/providers/tiktok/adgroups'
import type { AdSet } from '@/lib/ads/types'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

function makeFetchImpl(responseData: unknown = { adgroup_id: '77777' }) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: 'OK', data: responseData }),
    text: async () => '',
  })
}

const CANONICAL_ADSET: AdSet = {
  id: 'pib-adset-1',
  orgId: 'org-123',
  campaignId: 'pib-campaign-1',
  name: 'Test AdGroup',
  platform: 'tiktok',
  status: 'ACTIVE',
  optimizationGoal: 'LINK_CLICKS',
  billingEvent: 'IMPRESSIONS',
  placements: { feeds: true, stories: false, reels: false, marketplace: false },
  targeting: {
    geo: { countries: ['US'] },
    demographics: { ageMin: 18, ageMax: 34 },
  },
  providerData: {},
  createdAt: null as any,
  updatedAt: null as any,
}

const BASE_ARGS = {
  advertiserId: 'adv-456',
  accessToken: 'tk-token',
  campaignId: '12345',
  objective: 'TRAFFIC' as const,
}

describe('TikTok AdGroup CRUD', () => {
  describe('createAdGroup', () => {
    it('POSTs /adgroup/create/ with campaign_id, adgroup_name, placement_type AUTOMATIC by default, and optimization_goal defaulted from objective', async () => {
      const fetchImpl = makeFetchImpl({ adgroup_id: '77777' })

      const result = await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_ADSET,
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/adgroup/create/'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Access-Token': 'tk-token' }),
        }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.campaign_id).toBe('12345')
      expect(body.adgroup_name).toBe('Test AdGroup')
      expect(body.placement_type).toBe('PLACEMENT_TYPE_AUTOMATIC')
      expect(body.placements).toBeUndefined()
      // TRAFFIC objective → CLICK optimization goal
      expect(body.optimization_goal).toBe('CLICK')
      expect(body.operation_status).toBe('ENABLE')
      expect(result).toEqual({ adgroupId: '77777' })
    })

    it('sets placement_type NORMAL and includes placements array when placements provided', async () => {
      const fetchImpl = makeFetchImpl({ adgroup_id: '77777' })

      await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_ADSET,
        placements: ['PLACEMENT_TIKTOK', 'PLACEMENT_PANGLE'],
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.placement_type).toBe('PLACEMENT_TYPE_NORMAL')
      expect(body.placements).toEqual(['PLACEMENT_TIKTOK', 'PLACEMENT_PANGLE'])
    })

    it('includes bid_price when bidType is BID_TYPE_CUSTOM and bidPriceMajor is provided', async () => {
      const fetchImpl = makeFetchImpl({ adgroup_id: '77777' })

      await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_ADSET,
        bidType: 'BID_TYPE_CUSTOM',
        bidPriceMajor: 2.5,
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.bid_type).toBe('BID_TYPE_CUSTOM')
      expect(body.bid_price).toBe(2.5)
    })

    it('defaults budget_mode to INFINITE when no budgetMajor; uses DAY when budgetMajor passed', async () => {
      // Case 1: no budgetMajor → INFINITE, no budget field
      const fetchImpl1 = makeFetchImpl({ adgroup_id: '77777' })
      await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl1 as any,
        canonical: CANONICAL_ADSET,
      })
      const body1 = JSON.parse(fetchImpl1.mock.calls[0][1].body)
      expect(body1.budget_mode).toBe('BUDGET_MODE_INFINITE')
      expect(body1.budget).toBeUndefined()

      // Case 2: budgetMajor provided → DAY + budget value
      const fetchImpl2 = makeFetchImpl({ adgroup_id: '77777' })
      await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl2 as any,
        canonical: CANONICAL_ADSET,
        budgetMajor: 50,
      })
      const body2 = JSON.parse(fetchImpl2.mock.calls[0][1].body)
      expect(body2.budget_mode).toBe('BUDGET_MODE_DAY')
      expect(body2.budget).toBe(50)
    })

    it('includes targeting built from canonical age range and merges tkTargeting extension override', async () => {
      const fetchImpl = makeFetchImpl({ adgroup_id: '77777' })

      await createAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_ADSET,
        tkTargeting: {
          location_ids: [9876543],
          gender: 'GENDER_FEMALE',
        },
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      // canonical ageMin=18, ageMax=34 → AGE_18_24 + AGE_25_34
      expect(body.targeting.age_groups).toEqual(['AGE_18_24', 'AGE_25_34'])
      // extension merges in location_ids and gender
      expect(body.targeting.location_ids).toEqual([9876543])
      expect(body.targeting.gender).toBe('GENDER_FEMALE')
    })
  })

  describe('updateAdGroup', () => {
    it('POSTs /adgroup/update/ echoing only the provided patch fields (partial update)', async () => {
      const fetchImpl = makeFetchImpl({})

      await updateAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        adgroupId: '77777',
        patch: { name: 'Renamed AdGroup' },
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/adgroup/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.adgroup_id).toBe('77777')
      expect(body.adgroup_name).toBe('Renamed AdGroup')
      // unprovided fields must be absent
      expect(body.budget).toBeUndefined()
      expect(body.bid_price).toBeUndefined()
      expect(body.targeting).toBeUndefined()
    })
  })

  describe('pauseAdGroup / resumeAdGroup / archiveAdGroup', () => {
    it('pauseAdGroup POSTs /adgroup/status/update/ with operation_status DISABLE', async () => {
      const fetchImpl = makeFetchImpl({})

      await pauseAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        adgroupId: '77777',
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/adgroup/status/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.adgroup_ids).toEqual(['77777'])
      expect(body.operation_status).toBe('DISABLE')
    })

    it('resumeAdGroup sends ENABLE; archiveAdGroup sends DELETE', async () => {
      const fetchImpl1 = makeFetchImpl({})
      await resumeAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl1 as any,
        adgroupId: '77777',
      })
      const body1 = JSON.parse(fetchImpl1.mock.calls[0][1].body)
      expect(body1.operation_status).toBe('ENABLE')

      const fetchImpl2 = makeFetchImpl({})
      await archiveAdGroup({
        ...BASE_ARGS,
        fetchImpl: fetchImpl2 as any,
        adgroupId: '77777',
      })
      const body2 = JSON.parse(fetchImpl2.mock.calls[0][1].body)
      expect(body2.operation_status).toBe('DELETE')
    })
  })
})
