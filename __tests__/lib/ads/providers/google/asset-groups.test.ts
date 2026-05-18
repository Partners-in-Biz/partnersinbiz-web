// __tests__/lib/ads/providers/google/asset-groups.test.ts
import { createAssetGroup, createTextAssets } from '@/lib/ads/providers/google/asset-groups'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

describe('Google asset group helpers', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('createAssetGroup with assetLinks issues 2 fetch calls (group then link)', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ resourceName: 'customers/1234567890/assetGroups/11' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ resourceName: 'customers/1234567890/assetGroupAssets/22' }] }),
      })

    const result = await createAssetGroup({
      ...baseArgs,
      campaignResourceName: 'customers/1234567890/campaigns/999',
      name: 'Creative Group A',
      finalUrls: ['https://example.com'],
      assetLinks: [
        { assetResourceName: 'customers/1234567890/assets/50', fieldType: 'HEADLINE' },
        { assetResourceName: 'customers/1234567890/assets/51', fieldType: 'DESCRIPTION' },
      ],
    })

    expect(result).toEqual({ resourceName: 'customers/1234567890/assetGroups/11', id: '11' })
    expect(global.fetch).toHaveBeenCalledTimes(2)

    // First call: assetGroups:mutate
    const [agUrl, agInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(agUrl).toMatch(/assetGroups:mutate/)
    const agBody = JSON.parse(agInit.body as string)
    expect(agBody.operations[0].create.campaign).toBe('customers/1234567890/campaigns/999')
    expect(agBody.operations[0].create.finalUrls).toEqual(['https://example.com'])

    // Second call: assetGroupAssets:mutate
    const [linkUrl, linkInit] = (global.fetch as jest.Mock).mock.calls[1]
    expect(linkUrl).toMatch(/assetGroupAssets:mutate/)
    const linkBody = JSON.parse(linkInit.body as string)
    expect(linkBody.operations).toHaveLength(2)
    expect(linkBody.operations[0].create.fieldType).toBe('HEADLINE')
    expect(linkBody.operations[1].create.fieldType).toBe('DESCRIPTION')
  })

  it('createAssetGroup with empty assetLinks skips the asset link fetch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ resourceName: 'customers/1234567890/assetGroups/12' }] }),
    })

    const result = await createAssetGroup({
      ...baseArgs,
      campaignResourceName: 'customers/1234567890/campaigns/999',
      name: 'Empty Group',
      finalUrls: ['https://example.com/landing'],
      assetLinks: [],
    })

    expect(result.id).toBe('12')
    expect(global.fetch).toHaveBeenCalledTimes(1)  // only assetGroups:mutate
  })

  it('createTextAssets returns resourceNames mapped to their texts', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { resourceName: 'customers/1234567890/assets/100' },
          { resourceName: 'customers/1234567890/assets/101' },
        ],
      }),
    })

    const results = await createTextAssets({ ...baseArgs, texts: ['Buy now', 'Shop today'] })

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ resourceName: 'customers/1234567890/assets/100', id: '100', text: 'Buy now' })
    expect(results[1]).toEqual({ resourceName: 'customers/1234567890/assets/101', id: '101', text: 'Shop today' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/assets:mutate/)
    const body = JSON.parse(init.body as string)
    expect(body.operations[0].create.textAsset).toEqual({ text: 'Buy now' })
    expect(body.operations[1].create.textAsset).toEqual({ text: 'Shop today' })
  })

  it('createTextAssets returns empty array without making a fetch when texts is empty', async () => {
    const results = await createTextAssets({ ...baseArgs, texts: [] })
    expect(results).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('createAssetGroup throws on non-2xx response from assetGroups:mutate', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'INVALID_ARGUMENT',
    })

    await expect(
      createAssetGroup({
        ...baseArgs,
        campaignResourceName: 'customers/1234567890/campaigns/999',
        name: 'Failing Group',
        finalUrls: ['https://example.com'],
        assetLinks: [],
      }),
    ).rejects.toThrow(/asset group create failed.*400/)
  })
})
