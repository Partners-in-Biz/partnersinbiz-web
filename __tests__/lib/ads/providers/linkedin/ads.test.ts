// __tests__/lib/ads/providers/linkedin/ads.test.ts
import {
  createCreative,
  updateCreative,
  pauseCreative,
  resumeCreative,
  archiveCreative,
} from '@/lib/ads/providers/linkedin/ads'
import type { Ad } from '@/lib/ads/types'

const baseCanonical: Ad = {
  id: 'ad-doc-id',
  orgId: 'org-1',
  adSetId: 'adset-doc-id',
  campaignId: 'campaign-doc-id',
  platform: 'linkedin',
  name: 'Test creative',
  status: 'DRAFT',
  format: 'SINGLE_IMAGE',
  creativeIds: [],
  copy: {
    primaryText: 'Check us out',
    headline: 'Great Offer',
  },
  providerData: {},
  createdAt: { _seconds: 0, _nanoseconds: 0 } as any,
  updatedAt: { _seconds: 0, _nanoseconds: 0 } as any,
} as Ad

const baseCallArgs = {
  accountUrn: 'urn:li:sponsoredAccount:111',
  accessToken: 'test-access-token',
}

const campaignUrn = 'urn:li:sponsoredCampaign:222'
const referenceUrn = 'urn:li:share:333'

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers({ 'X-RestLi-Id': '555' }),
    text: async () => '',
    json: async () => ({}),
  })
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

describe('LinkedIn Creative CRUD', () => {
  // ─── Test 1: createCreative sends POST with campaign URN + type + content.reference ─────
  it('createCreative sends POST with campaign URN + type: SPONSORED_STATUS_UPDATE + content.reference URN', async () => {
    const result = await createCreative({
      ...baseCallArgs,
      canonical: baseCanonical,
      campaignUrn,
      referenceUrn,
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // URL uses numeric account id (111), not full URN
    expect(url).toBe('https://api.linkedin.com/rest/adAccounts/111/creatives')

    // Method is POST
    expect(init.method).toBe('POST')

    // Headers include required LinkedIn headers
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-access-token')
    expect(headers['LinkedIn-Version']).toBe('202405')
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')

    // Body shape matches spec
    const body = JSON.parse(init.body as string)
    expect(body.campaign).toBe(campaignUrn)
    expect(body.type).toBe('SPONSORED_STATUS_UPDATE')
    expect(body.content).toEqual({ reference: referenceUrn })

    // Returned URN is correct
    expect(result).toEqual({
      urn: 'urn:li:sponsoredCreative:555',
      id: '555',
    })
  })

  // ─── Test 2: createCreative uses initialStatus when provided ─────────────────
  it('createCreative uses initialStatus when provided', async () => {
    await createCreative({
      ...baseCallArgs,
      canonical: baseCanonical,
      campaignUrn,
      referenceUrn,
      initialStatus: 'PAUSED',
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)

    expect(body.status).toBe('PAUSED')
  })

  // ─── Test 3: createCreative derives status from canonical when initialStatus omitted ──
  it('createCreative derives status from canonical when initialStatus omitted', async () => {
    // ACTIVE canonical → ACTIVE LinkedIn
    const activeCanonical: Ad = { ...baseCanonical, status: 'ACTIVE' }
    await createCreative({
      ...baseCallArgs,
      canonical: activeCanonical,
      campaignUrn,
      referenceUrn,
    })

    const [, initActive] = (global.fetch as jest.Mock).mock.calls[0]
    expect(JSON.parse(initActive.body as string).status).toBe('ACTIVE')

    // Reset mock and test DRAFT
    ;(global.fetch as jest.Mock).mockClear()

    const draftCanonical: Ad = { ...baseCanonical, status: 'DRAFT' }
    await createCreative({
      ...baseCallArgs,
      canonical: draftCanonical,
      campaignUrn,
      referenceUrn,
    })

    const [, initDraft] = (global.fetch as jest.Mock).mock.calls[0]
    expect(JSON.parse(initDraft.body as string).status).toBe('DRAFT')
  })

  // ─── Test 4: createCreative falls back to Location header for id extraction ───
  it('createCreative falls back to Location header for id extraction', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({
        Location: '/rest/adAccounts/111/creatives/777',
      }),
      text: async () => '',
      json: async () => ({}),
    })

    const result = await createCreative({
      ...baseCallArgs,
      canonical: baseCanonical,
      campaignUrn,
      referenceUrn,
    })

    expect(result).toEqual({
      urn: 'urn:li:sponsoredCreative:777',
      id: '777',
    })
  })

  // ─── Test 5: updateCreative uses X-RestLi-Method: PARTIAL_UPDATE + $set patch ─
  it('updateCreative uses X-RestLi-Method: PARTIAL_UPDATE + $set patch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
    })

    await updateCreative({
      ...baseCallArgs,
      creativeUrn: 'urn:li:sponsoredCreative:555',
      patch: { status: 'PAUSED' },
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // URL uses numeric ids for both account and creative
    expect(url).toBe('https://api.linkedin.com/rest/adAccounts/111/creatives/555')

    // Method is POST (LinkedIn PARTIAL_UPDATE pattern)
    expect(init.method).toBe('POST')

    // Required PARTIAL_UPDATE header present
    const headers = init.headers as Record<string, string>
    expect(headers['X-RestLi-Method']).toBe('PARTIAL_UPDATE')

    // Body uses $set wrapper
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ patch: { $set: { status: 'PAUSED' } } })
  })

  // ─── Test 6: pauseCreative / resumeCreative / archiveCreative convenience wrappers ──
  it('pauseCreative / resumeCreative / archiveCreative route to updateCreative with correct status', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
    })

    const sharedArgs = {
      ...baseCallArgs,
      creativeUrn: 'urn:li:sponsoredCreative:999',
    }

    await pauseCreative(sharedArgs)
    await resumeCreative(sharedArgs)
    await archiveCreative(sharedArgs)

    expect(global.fetch).toHaveBeenCalledTimes(3)

    const pauseBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)
    expect(pauseBody.patch.$set.status).toBe('PAUSED')

    const resumeBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body as string)
    expect(resumeBody.patch.$set.status).toBe('ACTIVE')

    const archiveBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body as string)
    expect(archiveBody.patch.$set.status).toBe('ARCHIVED')
  })
})
