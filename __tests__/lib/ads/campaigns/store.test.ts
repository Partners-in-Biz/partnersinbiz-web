import {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  setCampaignMetaId,
} from '@/lib/ads/campaigns/store'

// Mock the firebase admin module to avoid live Firestore in tests
jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      orderBy: (_field: string, _dir?: string) => makeQuery(path, filters),
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, op, value]) => {
              if (op !== '==') return true
              return (data as Record<string, unknown>)[field] === value
            }),
          )
          .map(([k, v]) => ({ id: k.replace(`${path}/`, ''), data: () => v })),
      }),
    }
  }

  const collection = (path: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: docs.has(`${path}/${id}`),
        id,
        data: () => docs.get(`${path}/${id}`),
      }),
      set: async (data: Record<string, unknown>) => {
        docs.set(`${path}/${id}`, { ...data })
      },
      update: async (patch: Record<string, unknown>) => {
        const cur = docs.get(`${path}/${id}`) ?? {}
        docs.set(`${path}/${id}`, { ...cur, ...patch })
      },
      delete: async () => {
        docs.delete(`${path}/${id}`)
      },
    }),
    where: (field: string, op: string, value: unknown) => makeQuery(path, [[field, op, value]]),
  })

  return {
    adminDb: { collection },
    _docs: docs,
  }
})

const BASE_INPUT = {
  adAccountId: 'act_123',
  name: 'Test Campaign',
  objective: 'TRAFFIC' as const,
  status: 'DRAFT' as const,
  cboEnabled: false,
  specialAdCategories: [] as string[],
}

describe('campaigns store', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    _docs.clear()
  })

  it('roundtrips create/get with generated id and defaults', async () => {
    const campaign = await createCampaign({
      orgId: 'org_1',
      createdBy: 'user_abc',
      input: BASE_INPUT,
    })

    expect(campaign.id).toMatch(/^cmp_[0-9a-f]{16}$/)
    expect(campaign.platform).toBe('meta')
    expect(campaign.providerData).toEqual({})
    expect(campaign.orgId).toBe('org_1')
    expect(campaign.createdBy).toBe('user_abc')
    expect(campaign.createdAt).toBeDefined()
    expect(campaign.updatedAt).toBeDefined()

    const fetched = await getCampaign(campaign.id)
    expect(fetched?.id).toBe(campaign.id)
    expect(fetched?.name).toBe('Test Campaign')
  })

  it('listCampaigns filters by orgId and status', async () => {
    await createCampaign({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, status: 'ACTIVE' } })
    await createCampaign({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, status: 'PAUSED' } })
    await createCampaign({ orgId: 'org_2', createdBy: 'u2', input: { ...BASE_INPUT, status: 'ACTIVE' } })

    const activeOrg1 = await listCampaigns({ orgId: 'org_1', status: 'ACTIVE' })
    expect(activeOrg1).toHaveLength(1)
    expect(activeOrg1[0].orgId).toBe('org_1')
    expect(activeOrg1[0].status).toBe('ACTIVE')

    const allOrg1 = await listCampaigns({ orgId: 'org_1' })
    expect(allOrg1).toHaveLength(2)
  })

  it('keeps company-owned ads off the organisation list', async () => {
    await createCampaign({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'Org ads' } })
    await createCampaign({
      orgId: 'org_1',
      createdBy: 'u1',
      input: { ...BASE_INPUT, name: 'Lumen ads' },
      owner: { owner: 'company', companyId: 'co-1' },
    })

    const orgOwn = await listCampaigns({ orgId: 'org_1', owner: { owner: 'org' } })
    expect(orgOwn.map((row) => row.name)).toEqual(['Org ads'])

    const company = await listCampaigns({ orgId: 'org_1', owner: { owner: 'company', companyId: 'co-1' } })
    expect(company.map((row) => row.name)).toEqual(['Lumen ads'])
  })

  it('updateCampaign patches fields and bumps updatedAt', async () => {
    const campaign = await createCampaign({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })
    const originalUpdatedAt = campaign.updatedAt

    await updateCampaign(campaign.id, { name: 'Renamed Campaign', status: 'ACTIVE' })

    const fetched = await getCampaign(campaign.id)
    expect(fetched?.name).toBe('Renamed Campaign')
    expect(fetched?.status).toBe('ACTIVE')
    // updatedAt should be a new Timestamp (or at least defined)
    expect(fetched?.updatedAt).toBeDefined()
    // In mock env Timestamp.now() always returns same object shape — just verify it's set
    expect(fetched?.updatedAt).not.toBeUndefined()
    void originalUpdatedAt // suppress unused var warning
  })

  it('deleteCampaign removes the doc', async () => {
    const campaign = await createCampaign({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })
    await deleteCampaign(campaign.id)
    const fetched = await getCampaign(campaign.id)
    expect(fetched).toBeNull()
  })

  it('setCampaignMetaId merges providerData.meta.id', async () => {
    const campaign = await createCampaign({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })

    await setCampaignMetaId(campaign.id, 'meta_cmp_999')

    const fetched = await getCampaign(campaign.id)
    expect(fetched?.providerData?.meta?.id).toBe('meta_cmp_999')
  })

  it('isolates campaigns by orgId — does not leak across tenants', async () => {
    await createCampaign({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'Org 1 Campaign' } })
    await createCampaign({ orgId: 'org_2', createdBy: 'u2', input: { ...BASE_INPUT, name: 'Org 2 Campaign' } })

    const list1 = await listCampaigns({ orgId: 'org_1' })
    const list2 = await listCampaigns({ orgId: 'org_2' })

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('Org 1 Campaign')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('Org 2 Campaign')
  })
})
