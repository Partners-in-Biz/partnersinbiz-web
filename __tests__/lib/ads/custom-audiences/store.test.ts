import {
  createCustomAudience,
  getCustomAudience,
  listCustomAudiences,
  updateCustomAudience,
  deleteCustomAudience,
  setCustomAudienceMetaId,
} from '@/lib/ads/custom-audiences/store'

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

const BASE_SOURCE = {
  kind: 'CUSTOMER_LIST' as const,
  csvStoragePath: 'orgs/org_1/uploads/list.csv',
  hashCount: 500,
  uploadedAt: { seconds: 1747000000, nanoseconds: 0 } as any,
}

const BASE_INPUT = {
  name: 'Newsletter Subscribers',
  type: 'CUSTOMER_LIST' as const,
  status: 'BUILDING' as const,
  source: BASE_SOURCE,
}

describe('custom-audiences store', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    _docs.clear()
  })

  it('roundtrips create/get with generated ca_ id and defaults', async () => {
    const ca = await createCustomAudience({
      orgId: 'org_1',
      createdBy: 'user_abc',
      platform: 'meta',
      input: BASE_INPUT,
    })

    expect(ca.id).toMatch(/^ca_[0-9a-f]{16}$/)
    expect(ca.orgId).toBe('org_1')
    expect(ca.createdBy).toBe('user_abc')
    expect(ca.platform).toBe('meta')
    expect(ca.providerData).toEqual({})
    expect(ca.createdAt).toBeDefined()
    expect(ca.updatedAt).toBeDefined()

    const fetched = await getCustomAudience(ca.id)
    expect(fetched?.id).toBe(ca.id)
    expect(fetched?.name).toBe('Newsletter Subscribers')
    expect(fetched?.type).toBe('CUSTOMER_LIST')
  })

  it('accepts optional pre-generated id', async () => {
    const ca = await createCustomAudience({
      orgId: 'org_1',
      createdBy: 'user_abc',
      platform: 'meta',
      input: BASE_INPUT,
      id: 'ca_preset123',
    })

    expect(ca.id).toBe('ca_preset123')

    const fetched = await getCustomAudience('ca_preset123')
    expect(fetched).not.toBeNull()
  })

  it('listCustomAudiences filters by orgId and type', async () => {
    await createCustomAudience({ orgId: 'org_1', createdBy: 'u1', platform: 'meta', input: { ...BASE_INPUT, type: 'CUSTOMER_LIST' } })
    await createCustomAudience({ orgId: 'org_1', createdBy: 'u1', platform: 'meta', input: { ...BASE_INPUT, type: 'WEBSITE', source: { kind: 'WEBSITE', pixelId: 'px_1', retentionDays: 30, rules: [] } } })
    await createCustomAudience({ orgId: 'org_2', createdBy: 'u2', platform: 'meta', input: BASE_INPUT })

    const lists = await listCustomAudiences({ orgId: 'org_1', type: 'CUSTOMER_LIST' })
    expect(lists).toHaveLength(1)
    expect(lists[0].type).toBe('CUSTOMER_LIST')

    const all = await listCustomAudiences({ orgId: 'org_1' })
    expect(all).toHaveLength(2)
  })

  it('updateCustomAudience patches fields and bumps updatedAt', async () => {
    const ca = await createCustomAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      platform: 'meta',
      input: BASE_INPUT,
    })

    await updateCustomAudience(ca.id, { name: 'Updated List', status: 'READY' })

    const fetched = await getCustomAudience(ca.id)
    expect(fetched?.name).toBe('Updated List')
    expect(fetched?.status).toBe('READY')
    expect(fetched?.updatedAt).toBeDefined()
  })

  it('deleteCustomAudience hard-deletes the document', async () => {
    const ca = await createCustomAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      platform: 'meta',
      input: BASE_INPUT,
    })

    await deleteCustomAudience(ca.id)

    const fetched = await getCustomAudience(ca.id)
    expect(fetched).toBeNull()
  })

  it('setCustomAudienceMetaId merges customAudienceId into providerData.meta', async () => {
    const ca = await createCustomAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      platform: 'meta',
      input: BASE_INPUT,
    })

    await setCustomAudienceMetaId(ca.id, 'act_111_aud_999')

    const fetched = await getCustomAudience(ca.id)
    expect(fetched?.providerData?.meta?.customAudienceId).toBe('act_111_aud_999')
  })

  it('isolates custom audiences by orgId — does not leak across tenants', async () => {
    await createCustomAudience({ orgId: 'org_1', createdBy: 'u1', platform: 'meta', input: { ...BASE_INPUT, name: 'Org 1 Audience' } })
    await createCustomAudience({ orgId: 'org_2', createdBy: 'u2', platform: 'meta', input: { ...BASE_INPUT, name: 'Org 2 Audience' } })

    const list1 = await listCustomAudiences({ orgId: 'org_1' })
    const list2 = await listCustomAudiences({ orgId: 'org_2' })

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('Org 1 Audience')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('Org 2 Audience')
  })
})
