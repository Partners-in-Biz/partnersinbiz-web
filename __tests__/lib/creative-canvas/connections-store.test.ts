const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { upsertCreativeProviderConnection, listCreativeProviderConnections, revokeCreativeProviderConnection } from '@/lib/creative-canvas/connections/store'

const ACTOR = { uid: 'uid-9', type: 'user' as const }

// In-memory Firestore fake keyed by doc id, so upsert/get/list/revoke share state
// across test cases the same way real Firestore would.
const docs = new Map<string, Record<string, unknown>>()

beforeEach(() => {
  jest.clearAllMocks()

  mockDoc.mockImplementation((id: string) => {
    const docGet = jest.fn(async () => {
      const data = docs.get(id)
      return { exists: Boolean(data), id, data: () => data }
    })
    const docSet = jest.fn(async (value: Record<string, unknown>) => {
      docs.set(id, value)
    })
    const docUpdate = jest.fn(async (value: Record<string, unknown>) => {
      docs.set(id, { ...(docs.get(id) ?? {}), ...value })
    })
    mockDocGet.mockImplementation(docGet)
    mockDocSet.mockImplementation(docSet)
    mockDocUpdate.mockImplementation(docUpdate)
    return { get: docGet, set: docSet, update: docUpdate }
  })

  function makeQuery(filters: Array<[string, unknown]>) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery([...filters, [field, value]]),
      get: async () => {
        const results = [...docs.entries()]
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([id, data]) => ({ id, data: () => data }))
        return { docs: results }
      },
    }
  }

  mockWhere.mockImplementation((field: string, _op: string, value: unknown) => makeQuery([[field, value]]))
  mockGet.mockImplementation(async () => ({ docs: [] }))
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, get: mockGet })
})

describe('creative provider connection store', () => {
  beforeAll(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'test-master-key' })

  it('upserts an org-scoped connection encrypted with the org key and masks output', async () => {
    const conn = await upsertCreativeProviderConnection({
      provider: 'xai', scope: 'org', orgId: 'org-1', ownerUid: null,
      label: 'Org xAI', credentials: { apiKey: 'xai-abcdef1234' },
    }, ACTOR)
    expect(conn.id).toBe('org:org-1:xai')
    expect(conn.scopeKeyRef).toBe('org:org-1')
    expect(conn.hasCredentials).toBe(true)
    expect((conn as Record<string, unknown>).credentialsEnc).toBeUndefined()
    expect(conn.credentialHint).toBe('xai-…1234')
  })

  it('upserts a user-scoped connection with user scope key', async () => {
    const conn = await upsertCreativeProviderConnection({
      provider: 'recraft', scope: 'user', orgId: 'org-1', ownerUid: 'uid-9',
      label: 'My Recraft', credentials: { apiKey: 'rk_secretsecret' },
    }, ACTOR)
    expect(conn.id).toBe('user:uid-9:recraft')
    expect(conn.scopeKeyRef).toBe('user:uid-9')
  })

  it('lists connections visible to a user: own user-scoped + active org-scoped', async () => {
    const list = await listCreativeProviderConnections({ orgId: 'org-1', uid: 'uid-9' })
    expect(list.map((c) => c.id).sort()).toEqual(['org:org-1:xai', 'user:uid-9:recraft'])
  })

  it("does not list another user's personal connections", async () => {
    const list = await listCreativeProviderConnections({ orgId: 'org-1', uid: 'uid-other' })
    expect(list.map((c) => c.id)).toEqual(['org:org-1:xai'])
  })

  it('revoke clears credentials and flips status', async () => {
    const conn = await revokeCreativeProviderConnection('org:org-1:xai', { orgId: 'org-1', uid: 'uid-9' }, ACTOR)
    expect(conn.status).toBe('revoked')
    expect(conn.hasCredentials).toBe(false)
  })

  it('revoked connections disappear from the list', async () => {
    const list = await listCreativeProviderConnections({ orgId: 'org-1', uid: 'uid-9' })
    expect(list.map((c) => c.id)).toEqual(['user:uid-9:recraft'])
  })

  it('upserting over a revoked connection resurrects it with fresh credentials', async () => {
    const conn = await upsertCreativeProviderConnection({
      provider: 'xai', scope: 'org', orgId: 'org-1', ownerUid: null,
      label: 'Org xAI again', credentials: { apiKey: 'xai-freshkey9999' },
    }, ACTOR)
    expect(conn.id).toBe('org:org-1:xai')
    expect(conn.status).toBe('connected')
    expect(conn.hasCredentials).toBe(true)
    const list = await listCreativeProviderConnections({ orgId: 'org-1', uid: 'uid-9' })
    expect(list.map((c) => c.id).sort()).toEqual(['org:org-1:xai', 'user:uid-9:recraft'])
  })
})
