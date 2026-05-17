// __tests__/lib/ads/providers/linkedin/campaigns.test.ts
import {
  createCampaignGroup,
  updateCampaignGroup,
  pauseCampaignGroup,
  resumeCampaignGroup,
  archiveCampaignGroup,
} from '@/lib/ads/providers/linkedin/campaigns'
import type { AdCampaign } from '@/lib/ads/types'

const baseCanonical: AdCampaign = {
  id: 'campaign-doc-id',
  orgId: 'org-1',
  adAccountId: 'urn:li:sponsoredAccount:111',
  platform: 'linkedin',
  name: 'Test campaign group',
  objective: 'TRAFFIC',
  status: 'DRAFT',
  cboEnabled: false,
  specialAdCategories: [],
  providerData: {},
  createdBy: 'uid-1',
  createdAt: { _seconds: 0, _nanoseconds: 0 } as any,
  updatedAt: { _seconds: 0, _nanoseconds: 0 } as any,
} as AdCampaign

const baseCallArgs = {
  accountUrn: 'urn:li:sponsoredAccount:111',
  accessToken: 'test-access-token',
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers({ 'X-RestLi-Id': '12345' }),
    text: async () => '',
    json: async () => ({}),
  })
})

afterEach(() => {
  ;(global.fetch as jest.Mock).mockRestore?.()
})

describe('LinkedIn Campaign Group CRUD', () => {
  // ─── Test 1: createCampaignGroup basic shape ────────────────────────────────
  it('createCampaignGroup sends POST with account URN + canonical name + mapped status', async () => {
    const result = await createCampaignGroup({
      ...baseCallArgs,
      canonical: baseCanonical,
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // URL uses numeric account id (111), not full URN
    expect(url).toBe('https://api.linkedin.com/rest/adAccounts/111/adCampaignGroups')

    // Method is POST
    expect(init.method).toBe('POST')

    // Headers include required LinkedIn headers
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-access-token')
    expect(headers['LinkedIn-Version']).toBe('202405')
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')

    // Body shape matches spec
    const body = JSON.parse(init.body as string)
    expect(body.account).toBe('urn:li:sponsoredAccount:111')
    expect(body.name).toBe('Test campaign group')
    expect(body.status).toBe('DRAFT')  // DRAFT canonical → DRAFT LinkedIn

    // Returned URN is correct
    expect(result).toEqual({
      urn: 'urn:li:sponsoredCampaignGroup:12345',
      id: '12345',
    })
  })

  // ─── Test 2: totalBudget included when totalBudgetMajor passed ──────────────
  it('createCampaignGroup includes totalBudget when totalBudgetMajor passed', async () => {
    await createCampaignGroup({
      ...baseCallArgs,
      canonical: baseCanonical,
      totalBudgetMajor: 100.5,
    })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body as string)

    expect(body.totalBudget).toEqual({ amount: '100.50', currencyCode: 'USD' })
  })

  // ─── Test 3: Location header fallback ──────────────────────────────────────
  it('createCampaignGroup falls back to Location header when X-RestLi-Id absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({
        Location: '/rest/adAccounts/111/adCampaignGroups/99999',
      }),
      text: async () => '',
      json: async () => ({}),
    })

    const result = await createCampaignGroup({
      ...baseCallArgs,
      canonical: baseCanonical,
    })

    expect(result).toEqual({
      urn: 'urn:li:sponsoredCampaignGroup:99999',
      id: '99999',
    })
  })

  // ─── Test 4: throws on HTTP error ──────────────────────────────────────────
  it('createCampaignGroup throws on HTTP error', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: async () => 'INVALID_ARGUMENT: name is required',
      json: async () => ({}),
    })

    await expect(
      createCampaignGroup({ ...baseCallArgs, canonical: baseCanonical }),
    ).rejects.toThrow(/LinkedIn campaign group create failed: HTTP 400/)
  })

  // ─── Test 5: updateCampaignGroup uses PARTIAL_UPDATE + $set wrapper ─────────
  it('updateCampaignGroup sends POST with X-RestLi-Method: PARTIAL_UPDATE + $set patch wrapper', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
    })

    await updateCampaignGroup({
      ...baseCallArgs,
      groupUrn: 'urn:li:sponsoredCampaignGroup:55555',
      patch: { name: 'New Name', status: 'PAUSED' },
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]

    // URL uses numeric ids for both account and group
    expect(url).toBe('https://api.linkedin.com/rest/adAccounts/111/adCampaignGroups/55555')

    // Method is POST (LinkedIn PARTIAL_UPDATE pattern)
    expect(init.method).toBe('POST')

    // Required PARTIAL_UPDATE header present
    const headers = init.headers as Record<string, string>
    expect(headers['X-RestLi-Method']).toBe('PARTIAL_UPDATE')

    // Body uses $set wrapper
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ patch: { $set: { name: 'New Name', status: 'PAUSED' } } })
  })

  // ─── Test 6: convenience wrappers route correct status ─────────────────────
  it('pauseCampaignGroup / resumeCampaignGroup / archiveCampaignGroup produce the correct status patch', async () => {
    // Set up 3 mock responses for 3 calls
    ;(global.fetch as jest.Mock)
      .mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: async () => '',
        json: async () => ({}),
      })

    const sharedArgs = {
      ...baseCallArgs,
      groupUrn: 'urn:li:sponsoredCampaignGroup:77777',
    }

    await pauseCampaignGroup(sharedArgs)
    await resumeCampaignGroup(sharedArgs)
    await archiveCampaignGroup(sharedArgs)

    expect(global.fetch).toHaveBeenCalledTimes(3)

    const pauseBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)
    expect(pauseBody.patch.$set.status).toBe('PAUSED')

    const resumeBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body as string)
    expect(resumeBody.patch.$set.status).toBe('ACTIVE')

    const archiveBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body as string)
    expect(archiveBody.patch.$set.status).toBe('ARCHIVED')
  })

  // ─── Test 7: createCampaignGroup throws when both headers absent ────────────
  it('createCampaignGroup throws when both X-RestLi-Id and Location are absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers(),  // no X-RestLi-Id, no Location
      text: async () => '',
      json: async () => ({}),
    })

    await expect(
      createCampaignGroup({ ...baseCallArgs, canonical: baseCanonical }),
    ).rejects.toThrow('LinkedIn create response missing both X-RestLi-Id and Location headers')
  })
})
