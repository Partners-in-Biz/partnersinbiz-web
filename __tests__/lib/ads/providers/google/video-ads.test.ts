// __tests__/lib/ads/providers/google/video-ads.test.ts
import {
  createResponsiveVideoAd,
} from '@/lib/ads/providers/google/video-ads'
import type { VideoAdAssets } from '@/lib/ads/providers/google/video-ads'
import type { Ad } from '@/lib/ads/types'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

const baseAd: Ad = {
  id: 'ad-yt-1',
  orgId: 'org-1',
  adSetId: 'adset-1',
  campaignId: 'camp-1',
  platform: 'google',
  name: 'Test YouTube Ad',
  status: 'PAUSED',
  format: 'SINGLE_VIDEO',
  creativeIds: [],
  copy: { primaryText: 'Watch now', headline: 'Amazing product' },
  providerData: {},
  createdAt: null as any,
  updatedAt: null as any,
}

const baseVideoAssets: VideoAdAssets = {
  videoAssetResourceName: 'customers/1234567890/assets/111',
  headlines: ['Buy Now', 'Limited Offer'],
  descriptions: ['Get the best product at the best price.'],
  finalUrl: 'https://example.com/landing',
}

function mockOk(resourceName: string) {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ results: [{ resourceName }] }),
  })
}

describe('video-ads — createResponsiveVideoAd', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('creates video ad and returns resourceName + id', async () => {
    mockOk('customers/1234567890/adGroupAds/888~111')

    const result = await createResponsiveVideoAd({
      ...baseArgs,
      adGroupResourceName: 'customers/1234567890/adGroups/888',
      canonical: baseAd,
      videoAssets: baseVideoAssets,
    })

    expect(result.resourceName).toBe('customers/1234567890/adGroupAds/888~111')
    expect(result.id).toBe('888~111')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/adGroupAds:mutate/)
    const body = JSON.parse(init.body as string)
    const op = body.operations[0].create
    expect(op.adGroup).toBe('customers/1234567890/adGroups/888')
    expect(op.status).toBe('PAUSED')
    expect(op.ad.finalUrls).toEqual(['https://example.com/landing'])
  })

  it('maps headlines array to [{text}] shape in responsiveVideoAd', async () => {
    mockOk('customers/1234567890/adGroupAds/888~222')

    await createResponsiveVideoAd({
      ...baseArgs,
      adGroupResourceName: 'customers/1234567890/adGroups/888',
      canonical: baseAd,
      videoAssets: { ...baseVideoAssets, headlines: ['Headline 1', 'Headline 2'] },
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)
    const rva = body.operations[0].create.ad.responsiveVideoAd
    expect(rva.headlines).toEqual([{ text: 'Headline 1' }, { text: 'Headline 2' }])
    expect(rva.videos).toEqual([{ asset: 'customers/1234567890/assets/111' }])
  })

  it('omits callToActionTexts from payload when not supplied', async () => {
    mockOk('customers/1234567890/adGroupAds/888~333')

    await createResponsiveVideoAd({
      ...baseArgs,
      adGroupResourceName: 'customers/1234567890/adGroups/888',
      canonical: baseAd,
      videoAssets: baseVideoAssets,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)
    const rva = body.operations[0].create.ad.responsiveVideoAd
    expect(rva.callToActionTexts).toBeUndefined()
  })

  it('includes companionBanners in payload when companionBannerResourceName is supplied', async () => {
    mockOk('customers/1234567890/adGroupAds/888~444')

    await createResponsiveVideoAd({
      ...baseArgs,
      adGroupResourceName: 'customers/1234567890/adGroups/888',
      canonical: baseAd,
      videoAssets: {
        ...baseVideoAssets,
        companionBannerResourceName: 'customers/1234567890/assets/999',
      },
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)
    const rva = body.operations[0].create.ad.responsiveVideoAd
    expect(rva.companionBanners).toEqual([{ asset: 'customers/1234567890/assets/999' }])
  })

  it('throws on non-2xx response with descriptive message', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'INVALID_VIDEO_ASSET',
    })

    await expect(
      createResponsiveVideoAd({
        ...baseArgs,
        adGroupResourceName: 'customers/1/adGroups/1',
        canonical: baseAd,
        videoAssets: baseVideoAssets,
      }),
    ).rejects.toThrow('Google video ad create failed: HTTP 400')
  })
})
