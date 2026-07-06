const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { upsertCreativeProviderConnection } from '@/lib/creative-canvas/connections/store'
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'

const ACTOR = { uid: 'uid-9', type: 'user' as const }

// In-memory Firestore fake keyed by doc id, mirrors connections-store.test.ts.
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

describe('resolveCreativeProviderCredential', () => {
  beforeAll(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'test-master-key' })
  beforeEach(() => { delete process.env.XAI_API_KEY })

  it('returns connection_required when nothing is connected (non-higgsfield)', async () => {
    const res = await resolveCreativeProviderCredential({ provider: 'recraft', orgId: 'org-1', uid: 'uid-9' })
    expect(res).toEqual({ kind: 'connection_required' })
  })

  it('falls back to shared VPS for higgsfield when nothing is connected', async () => {
    const res = await resolveCreativeProviderCredential({ provider: 'higgsfield', orgId: 'org-1', uid: 'uid-9' })
    expect(res).toEqual({ kind: 'shared' })
  })

  it('xai falls back to shared when XAI_API_KEY env is set', async () => {
    process.env.XAI_API_KEY = 'xai-platform-key'
    const res = await resolveCreativeProviderCredential({ provider: 'xai', orgId: 'org-2', uid: 'uid-9' })
    expect(res).toEqual({ kind: 'shared' })
  })

  it('xai without env key and without connections requires connection', async () => {
    const res = await resolveCreativeProviderCredential({ provider: 'xai', orgId: 'org-2', uid: 'uid-9' })
    expect(res).toEqual({ kind: 'connection_required' })
  })

  it('resolves an org connection and decrypts credentials', async () => {
    await upsertCreativeProviderConnection({ provider: 'xai', scope: 'org', orgId: 'org-1', ownerUid: null, label: 'Org', credentials: { apiKey: 'xai-org-key' } }, ACTOR)
    const res = await resolveCreativeProviderCredential({ provider: 'xai', orgId: 'org-1', uid: 'uid-9' })
    expect(res.kind).toBe('byok')
    if (res.kind === 'byok') expect(res.credentials.apiKey).toBe('xai-org-key')
  })

  it('user connection beats org connection', async () => {
    await upsertCreativeProviderConnection({ provider: 'xai', scope: 'user', orgId: 'org-1', ownerUid: 'uid-9', label: 'Mine', credentials: { apiKey: 'xai-user-key' } }, ACTOR)
    const res = await resolveCreativeProviderCredential({ provider: 'xai', orgId: 'org-1', uid: 'uid-9' })
    if (res.kind !== 'byok') throw new Error('expected byok')
    expect(res.credentials.apiKey).toBe('xai-user-key')
    expect(res.connection.scope).toBe('user')
  })

  it('a user personal key works from ANOTHER org (portability)', async () => {
    const res = await resolveCreativeProviderCredential({ provider: 'xai', orgId: 'org-OTHER', uid: 'uid-9' })
    if (res.kind !== 'byok') throw new Error('expected byok')
    expect(res.credentials.apiKey).toBe('xai-user-key')
  })

  it('skips invalid/revoked connections and falls through', async () => {
    await upsertCreativeProviderConnection({ provider: 'fal', scope: 'org', orgId: 'org-1', ownerUid: null, label: 'Org fal', credentials: { apiKey: 'fal-key' } }, ACTOR)
    // flip status to 'invalid' directly via our in-memory fake
    const existing = docs.get('org:org-1:fal')
    docs.set('org:org-1:fal', { ...(existing ?? {}), status: 'invalid' })
    const res = await resolveCreativeProviderCredential({ provider: 'fal', orgId: 'org-1', uid: 'uid-9' })
    expect(res.kind).toBe('connection_required')
  })
})
