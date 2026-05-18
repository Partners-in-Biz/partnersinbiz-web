// __tests__/lib/ads/providers/tiktok/identities.test.ts
// Unit tests for Sub-3c Phase 2 Batch 2D — TikTok identities provider helper.

import { listIdentities } from '@/lib/ads/providers/tiktok/identities'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

function makeFetchImpl(identityList: unknown[] = []) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      message: 'OK',
      data: { identity_list: identityList },
    }),
    text: async () => '',
  })
}

describe('TikTok identities provider', () => {
  it('POSTs /identity/get/ with advertiser_id and optional identity_type filter', async () => {
    const fetchImpl = makeFetchImpl([])

    await listIdentities({
      advertiserId: 'adv-123',
      accessToken: 'tk-token',
      identityType: 'TT_USER',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/identity/get/'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Access-Token': 'tk-token' }),
      }),
    )

    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.advertiser_id).toBe('adv-123')
    expect(body.identity_type).toBe('TT_USER')
  })

  it('omits identity_type from body when not provided', async () => {
    const fetchImpl = makeFetchImpl([])

    await listIdentities({
      advertiserId: 'adv-456',
      accessToken: 'tk-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.advertiser_id).toBe('adv-456')
    expect(body.identity_type).toBeUndefined()
  })

  it('maps response fields correctly (identity_id → identityId, display_name → displayName, profile_image → profileImageUrl)', async () => {
    const fetchImpl = makeFetchImpl([
      {
        identity_id: 'ident-001',
        identity_type: 'TT_USER',
        display_name: 'Test Account',
        profile_image: 'https://example.com/avatar.jpg',
      },
      {
        identity_id: 'ident-002',
        identity_type: 'AUTH_CODE',
      },
    ])

    const result = await listIdentities({
      advertiserId: 'adv-123',
      accessToken: 'tk-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      identityId: 'ident-001',
      identityType: 'TT_USER',
      displayName: 'Test Account',
      profileImageUrl: 'https://example.com/avatar.jpg',
    })
    expect(result[1]).toEqual({
      identityId: 'ident-002',
      identityType: 'AUTH_CODE',
      displayName: undefined,
      profileImageUrl: undefined,
    })
  })

  it('returns empty array when identity_list is absent or empty', async () => {
    const fetchImplEmpty = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: {} }),
      text: async () => '',
    })

    const result = await listIdentities({
      advertiserId: 'adv-123',
      accessToken: 'tk-token',
      fetchImpl: fetchImplEmpty as unknown as typeof fetch,
    })

    expect(result).toEqual([])
  })
})
