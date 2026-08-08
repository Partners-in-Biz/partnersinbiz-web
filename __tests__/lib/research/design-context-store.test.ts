import type { ApiUser } from '@/lib/api/types'

const mockSet = jest.fn()
const mockUpdate = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

const user: ApiUser = { uid: 'agent:theo', role: 'ai', orgId: 'org-1' }

function designItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      orgId: 'org-1',
      title: 'Design Context — acme',
      slug: 'design-context-acme',
      kind: 'design',
      status: 'verified',
      visibility: 'internal',
      deleted: false,
      designContext: {
        audience: 'Small law firms',
        positioning: 'Modern trust',
        brandVoice: 'Clear, calm, confident.',
        antiReferences: [],
        palette: [{ name: 'primary', value: '#0F172A' }],
        typeStack: [{ role: 'heading', family: 'Fraunces' }],
        componentRules: [],
        radiusScale: [],
        elevationScale: [],
        surfaceModes: [],
        version: 3,
        source: 'questionnaire',
        history: [],
      },
      linked: { companyId: 'company-acme' },
      updatedAt: { toMillis: () => 1000 },
      ...overrides,
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ id: 'design-1', set: mockSet, update: mockUpdate, get: mockGet, collection: mockCollection })
  mockWhere.mockReturnValue({ get: mockGet })
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, get: mockGet })
})

describe('research store — design context', () => {
  it('finds the latest design item by org, preferring company-linked rows', async () => {
    mockGet.mockResolvedValue({
      docs: [
        designItem('design-old', { updatedAt: { toMillis: () => 500 } }),
        designItem('design-latest', { linked: { companyId: 'company-acme' }, updatedAt: { toMillis: () => 900 } }),
      ],
    })
    const { findDesignContextItem } = await import('@/lib/research/store')
    const item = await findDesignContextItem('org-1', 'company-acme')
    expect(item?.id).toBe('design-latest')
  })

  it('upsert bumps version and appends history on an existing record', async () => {
    mockGet.mockResolvedValue({ docs: [designItem('design-1')] })
    const { upsertDesignContext } = await import('@/lib/research/store')
    const result = await upsertDesignContext({
      orgId: 'org-1',
      companyId: 'company-acme',
      payload: {
        audience: 'Small law firms (updated)',
        palette: [{ name: 'primary', value: '#0F172A' }, { name: 'accent', value: '#F59E0B' }],
      },
      source: 'questionnaire',
      user,
    })
    expect(result).toMatchObject({ id: 'design-1', created: false, version: 4 })
    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload.designContext.version).toBe(4)
    expect(updatePayload.designContext.history).toHaveLength(1)
    expect(updatePayload.designContext.history[0]).toMatchObject({ version: 3 })
  })

  it('upsert creates a kind=design research item when none exists', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    mockSet.mockResolvedValue(undefined)
    const { upsertDesignContext } = await import('@/lib/research/store')
    const result = await upsertDesignContext({
      orgId: 'org-1',
      companyId: 'company-acme',
      payload: { audience: 'New client', palette: [{ name: 'primary', value: '#123456' }] },
      source: 'style-scan',
      sourceUrl: 'https://acme.example/',
      user,
    })
    expect(result).toMatchObject({ created: true, version: 1 })
    const setPayload = mockSet.mock.calls[0][0]
    expect(setPayload.kind).toBe('design')
    expect(setPayload.designContext).toMatchObject({ version: 1, source: 'style-scan', sourceUrl: 'https://acme.example/' })
    expect(setPayload.linked).toMatchObject({ companyId: 'company-acme' })
  })

  it('upsert rejects empty payloads', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    const { upsertDesignContext } = await import('@/lib/research/store')
    await expect(upsertDesignContext({
      orgId: 'org-1',
      payload: {},
      source: 'questionnaire',
      user,
    })).rejects.toThrow(/at least one design fact/)
  })
})
