// __tests__/lib/ads/providers/google/listing-groups.test.ts
// Tests for createDefaultListingGroup + createBrandListingGroup — Sub-3a-ext Smart Shopping.

import { createDefaultListingGroup, createBrandListingGroup } from '@/lib/ads/providers/google/listing-groups'

global.fetch = jest.fn() as jest.Mock

const baseArgs = {
  customerId: '1234567890',
  accessToken: 'test-access',
  developerToken: 'test-dev',
}

const assetGroupResourceName = 'customers/1234567890/assetGroups/55'
const rootRn = 'customers/1234567890/assetGroupListingGroupFilters/10'
const unitRn = 'customers/1234567890/assetGroupListingGroupFilters/11'

describe('createDefaultListingGroup', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  // Test 1: POSTs 2 times — root subdivision then unit child referencing root
  it('POSTs twice: root SUBDIVISION then UNIT_INCLUDED child referencing root resourceName', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: rootRn }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: unitRn }] }) })

    const result = await createDefaultListingGroup({ ...baseArgs, assetGroupResourceName })

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ rootResourceName: rootRn, unitResourceName: unitRn })

    // First call: root subdivision
    const [url1, init1] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url1).toMatch(/assetGroupListingGroupFilters:mutate/)
    const root = JSON.parse(init1.body as string).operations[0].create
    expect(root.type).toBe('SUBDIVISION')
    expect(root.assetGroup).toBe(assetGroupResourceName)
    expect(root).not.toHaveProperty('parentListingGroupFilter')

    // Second call: unit child referencing root
    const [, init2] = (global.fetch as jest.Mock).mock.calls[1]
    const unit = JSON.parse(init2.body as string).operations[0].create
    expect(unit.type).toBe('UNIT_INCLUDED')
    expect(unit.assetGroup).toBe(assetGroupResourceName)
    expect(unit.parentListingGroupFilter).toBe(rootRn)
  })

  // Test 2: Throws on root create failure
  it('throws on root create HTTP failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    })

    await expect(
      createDefaultListingGroup({ ...baseArgs, assetGroupResourceName }),
    ).rejects.toThrow(/root listing group create failed.*400/)
  })

  // Test 3: Throws on unit create failure
  it('throws on unit create HTTP failure', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: rootRn }] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })

    await expect(
      createDefaultListingGroup({ ...baseArgs, assetGroupResourceName }),
    ).rejects.toThrow(/unit listing group create failed.*500/)
  })
})

describe('createBrandListingGroup', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
  })

  // Test 4: POSTs UNIT_INCLUDED with productBrand.value
  it('POSTs UNIT_INCLUDED listing group with productBrand.value', async () => {
    const brandRn = 'customers/1234567890/assetGroupListingGroupFilters/20'
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ resourceName: brandRn }] }),
    })

    const result = await createBrandListingGroup({
      ...baseArgs,
      assetGroupResourceName,
      parentListingGroupFilterResourceName: rootRn,
      brandName: 'Nike',
    })

    expect(result.resourceName).toBe(brandRn)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/assetGroupListingGroupFilters:mutate/)
    const op = JSON.parse(init.body as string).operations[0].create
    expect(op.type).toBe('UNIT_INCLUDED')
    expect(op.caseValue).toEqual({ productBrand: { value: 'Nike' } })
    expect(op.parentListingGroupFilter).toBe(rootRn)
    expect(op.assetGroup).toBe(assetGroupResourceName)
  })
})
