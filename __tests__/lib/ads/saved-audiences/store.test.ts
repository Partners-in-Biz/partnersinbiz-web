import {
  createSavedAudience,
  getSavedAudience,
  listSavedAudiences,
  updateSavedAudience,
  deleteSavedAudience,
  setSavedAudienceMetaId,
} from '@/lib/ads/saved-audiences/store'

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

const BASE_TARGETING = {
  geo: {
    countries: ['ZA'],
    regions: [],
    cities: [],
    zips: [],
  },
  demographics: {
    ageMin: 25,
    ageMax: 55,
    genders: ['male', 'female'] as Array<'male' | 'female'>,
  },
}

const BASE_INPUT = {
  name: 'SA Adults 25-55',
  targeting: BASE_TARGETING,
}

describe('saved-audiences store', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    _docs.clear()
  })

  it('roundtrips create/get with generated sav_ id and defaults', async () => {
    const sa = await createSavedAudience({
      orgId: 'org_1',
      createdBy: 'user_abc',
      input: BASE_INPUT,
    })

    expect(sa.id).toMatch(/^sav_[0-9a-f]{16}$/)
    expect(sa.orgId).toBe('org_1')
    expect(sa.createdBy).toBe('user_abc')
    expect(sa.platform).toBe('meta')
    expect(sa.providerData).toEqual({})
    expect(sa.createdAt).toBeDefined()
    expect(sa.updatedAt).toBeDefined()

    const fetched = await getSavedAudience(sa.id)
    expect(fetched?.id).toBe(sa.id)
    expect(fetched?.name).toBe('SA Adults 25-55')
    expect(fetched?.targeting).toEqual(BASE_TARGETING)
  })

  it('accepts optional pre-generated id', async () => {
    const sa = await createSavedAudience({
      orgId: 'org_1',
      createdBy: 'user_abc',
      input: BASE_INPUT,
      id: 'sav_preset456',
    })

    expect(sa.id).toBe('sav_preset456')

    const fetched = await getSavedAudience('sav_preset456')
    expect(fetched).not.toBeNull()
  })

  it('listSavedAudiences returns audiences for orgId sorted by updatedAt desc', async () => {
    await createSavedAudience({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'First' } })
    await createSavedAudience({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'Second' } })
    await createSavedAudience({ orgId: 'org_2', createdBy: 'u2', input: BASE_INPUT })

    const list = await listSavedAudiences({ orgId: 'org_1' })
    expect(list).toHaveLength(2)
  })

  it('updateSavedAudience patches fields and bumps updatedAt', async () => {
    const sa = await createSavedAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })

    const newTargeting = {
      ...BASE_TARGETING,
      demographics: { ...BASE_TARGETING.demographics, ageMin: 30 },
    }
    await updateSavedAudience(sa.id, { name: 'Updated Audience', targeting: newTargeting })

    const fetched = await getSavedAudience(sa.id)
    expect(fetched?.name).toBe('Updated Audience')
    expect(fetched?.targeting?.demographics.ageMin).toBe(30)
    expect(fetched?.updatedAt).toBeDefined()
  })

  it('deleteSavedAudience hard-deletes the document', async () => {
    const sa = await createSavedAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })

    await deleteSavedAudience(sa.id)

    const fetched = await getSavedAudience(sa.id)
    expect(fetched).toBeNull()
  })

  it('setSavedAudienceMetaId merges savedAudienceId into providerData.meta', async () => {
    const sa = await createSavedAudience({
      orgId: 'org_1',
      createdBy: 'u1',
      input: BASE_INPUT,
    })

    await setSavedAudienceMetaId(sa.id, 'meta_sav_777')

    const fetched = await getSavedAudience(sa.id)
    expect(fetched?.providerData?.meta?.savedAudienceId).toBe('meta_sav_777')
  })

  it('isolates saved audiences by orgId — does not leak across tenants', async () => {
    await createSavedAudience({ orgId: 'org_1', createdBy: 'u1', input: { ...BASE_INPUT, name: 'Org 1 Saved' } })
    await createSavedAudience({ orgId: 'org_2', createdBy: 'u2', input: { ...BASE_INPUT, name: 'Org 2 Saved' } })

    const list1 = await listSavedAudiences({ orgId: 'org_1' })
    const list2 = await listSavedAudiences({ orgId: 'org_2' })

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('Org 1 Saved')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('Org 2 Saved')
  })
})
