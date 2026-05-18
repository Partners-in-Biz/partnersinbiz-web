// __tests__/lib/ads/providers/tiktok/ads.test.ts
// Unit tests for Sub-3c Phase 2 Batch 2C — TikTok Ad CRUD.

import {
  createAd,
  updateAd,
  pauseAd,
  resumeAd,
  archiveAd,
} from '@/lib/ads/providers/tiktok/ads'
import type { Ad } from '@/lib/ads/types'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

function makeFetchImpl(
  responseData: unknown = { ad_id: '88888', identity_id: 'ID1', identity_type: 'TT_USER' },
) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: 'OK', data: responseData }),
    text: async () => '',
  })
}

const CANONICAL_AD: Ad = {
  id: 'pib-ad-1',
  orgId: 'org-123',
  name: 'Test Ad',
  platform: 'tiktok',
  adAccountId: 'acct-789',
  adSetId: 'adset-001',
  status: 'ACTIVE',
  providerData: {},
  createdBy: 'user-1',
  createdAt: null as any,
  updatedAt: null as any,
}

const BASE_ARGS = {
  advertiserId: 'adv-456',
  accessToken: 'tk-token',
}

const CREATE_REQUIRED = {
  ...BASE_ARGS,
  canonical: CANONICAL_AD,
  adgroupId: 'adgrp-001',
  identityId: 'ID1',
  identityType: 'TT_USER' as const,
  adText: 'Check out our product',
  callToAction: 'LEARN_MORE' as const,
  landingPageUrl: 'https://example.com',
  imageIds: ['img-asset-1'],
}

describe('TikTok Ad CRUD', () => {
  describe('createAd', () => {
    it('POSTs /ad/create/ with required fields', async () => {
      const fetchImpl = makeFetchImpl()

      await createAd({ ...CREATE_REQUIRED, fetchImpl: fetchImpl as any })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/ad/create/'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Access-Token': 'tk-token' }),
        }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.adgroup_id).toBe('adgrp-001')
      expect(body.ad_name).toBe('Test Ad')
      expect(body.identity_id).toBe('ID1')
      expect(body.identity_type).toBe('TT_USER')
      expect(body.ad_text).toBe('Check out our product')
      expect(body.call_to_action).toBe('LEARN_MORE')
      expect(body.landing_page_url).toBe('https://example.com')
      expect(body.operation_status).toBe('ENABLE')
    })

    it('includes image_ids when imageIds are provided', async () => {
      const fetchImpl = makeFetchImpl()

      await createAd({
        ...CREATE_REQUIRED,
        fetchImpl: fetchImpl as any,
        imageIds: ['img-asset-1', 'img-asset-2'],
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.image_ids).toEqual(['img-asset-1', 'img-asset-2'])
      expect(body.video_id).toBeUndefined()
    })

    it('includes video_id when videoId is provided', async () => {
      const fetchImpl = makeFetchImpl()

      await createAd({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        canonical: CANONICAL_AD,
        adgroupId: 'adgrp-001',
        identityId: 'ID1',
        identityType: 'TT_USER',
        adText: 'Watch this',
        callToAction: 'WATCH_NOW',
        landingPageUrl: 'https://example.com/video',
        videoId: 'vid-asset-99',
      })

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.video_id).toBe('vid-asset-99')
      expect(body.image_ids).toBeUndefined()
    })

    it('throws when neither imageIds nor videoId is provided', async () => {
      const fetchImpl = makeFetchImpl()

      await expect(
        createAd({
          ...BASE_ARGS,
          fetchImpl: fetchImpl as any,
          canonical: CANONICAL_AD,
          adgroupId: 'adgrp-001',
          identityId: 'ID1',
          identityType: 'TT_USER',
          adText: 'No creative',
          callToAction: 'LEARN_MORE',
          landingPageUrl: 'https://example.com',
        }),
      ).rejects.toThrow('creative reference required')
    })

    it('returns { adId, identityId, identityType } from response', async () => {
      const fetchImpl = makeFetchImpl({ ad_id: '88888', identity_id: 'ID1', identity_type: 'TT_USER' })

      const result = await createAd({ ...CREATE_REQUIRED, fetchImpl: fetchImpl as any })

      expect(result).toEqual({
        adId: '88888',
        identityId: 'ID1',
        identityType: 'TT_USER',
      })
    })
  })

  describe('updateAd', () => {
    it('POSTs /ad/update/ with only the provided patch fields', async () => {
      const fetchImpl = makeFetchImpl({})

      await updateAd({
        ...BASE_ARGS,
        fetchImpl: fetchImpl as any,
        adId: '88888',
        patch: {
          adName: 'New Name',
          adText: 'Updated caption',
        },
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/ad/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.ad_id).toBe('88888')
      expect(body.ad_name).toBe('New Name')
      expect(body.ad_text).toBe('Updated caption')
      // fields not in patch must be absent
      expect(body.call_to_action).toBeUndefined()
      expect(body.landing_page_url).toBeUndefined()
    })
  })

  describe('pause / resume / archive', () => {
    it('pauseAd POSTs /ad/status/update/ with operation_status DISABLE', async () => {
      const fetchImpl = makeFetchImpl({})

      await pauseAd({ ...BASE_ARGS, fetchImpl: fetchImpl as any, adId: '88888' })

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('/ad/status/update/'),
        expect.objectContaining({ method: 'POST' }),
      )

      const [, init] = fetchImpl.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.advertiser_id).toBe('adv-456')
      expect(body.ad_ids).toEqual(['88888'])
      expect(body.operation_status).toBe('DISABLE')
    })

    it('resumeAd sends ENABLE; archiveAd sends DELETE', async () => {
      const fetchResume = makeFetchImpl({})
      await resumeAd({ ...BASE_ARGS, fetchImpl: fetchResume as any, adId: '88888' })
      const bodyResume = JSON.parse(fetchResume.mock.calls[0][1].body)
      expect(bodyResume.operation_status).toBe('ENABLE')

      const fetchArchive = makeFetchImpl({})
      await archiveAd({ ...BASE_ARGS, fetchImpl: fetchArchive as any, adId: '88888' })
      const bodyArchive = JSON.parse(fetchArchive.mock.calls[0][1].body)
      expect(bodyArchive.operation_status).toBe('DELETE')
    })
  })
})
