// __tests__/lib/ads/identities/store.test.ts
// Unit tests for Sub-3c Phase 2 Batch 2D — ad_identities store.

import { upsertIdentity, listIdentities, getIdentity } from '@/lib/ads/identities/store'

// Mock firebase-admin/firestore — FieldValue.delete() must be a sentinel the mock can handle
jest.mock('firebase-admin/firestore', () => {
  const DELETE_SENTINEL = Symbol('DELETE')
  return {
    Timestamp: {
      now: () => ({ seconds: 1000000, nanoseconds: 0, toDate: () => new Date() }),
    },
    FieldValue: {
      delete: () => DELETE_SENTINEL,
    },
    _DELETE_SENTINEL: DELETE_SENTINEL,
  }
})

// Mock adminDb — mirrors pattern used in connections/store.test.ts
jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, op, value]) => {
              if (op !== '==') return true
              return (data as Record<string, unknown>)[field] === value
            }),
          )
          .map(([, v]) => ({ data: () => v })),
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
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { _DELETE_SENTINEL } = require('firebase-admin/firestore')
        const cur = docs.get(`${path}/${id}`) ?? {}
        const next: Record<string, unknown> = { ...cur }
        for (const [k, v] of Object.entries(patch)) {
          if (v === _DELETE_SENTINEL) {
            delete next[k]
          } else {
            next[k] = v
          }
        }
        docs.set(`${path}/${id}`, next)
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

describe('ad_identities store', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    _docs.clear()
  })

  it('upsertIdentity creates a new doc with deterministic id id_<24hex>', async () => {
    const result = await upsertIdentity({
      orgId: 'org-1',
      platform: 'tiktok',
      accountId: 'adv-123',
      identityId: 'ident-001',
      identityType: 'TT_USER',
      displayName: 'My TikTok',
    })

    expect(result.id).toMatch(/^id_[0-9a-f]{24}$/)
    expect(result.orgId).toBe('org-1')
    expect(result.platform).toBe('tiktok')
    expect(result.accountId).toBe('adv-123')
    expect(result.identityId).toBe('ident-001')
    expect(result.identityType).toBe('TT_USER')
    expect(result.displayName).toBe('My TikTok')
    expect(result.createdAt).toBeDefined()
    expect(result.updatedAt).toBeDefined()
  })

  it('upsertIdentity updates existing doc — preserves createdAt and bumps updatedAt', async () => {
    // First insert
    const first = await upsertIdentity({
      orgId: 'org-1',
      platform: 'tiktok',
      accountId: 'adv-123',
      identityId: 'ident-001',
      identityType: 'TT_USER',
      displayName: 'Old Name',
    })

    // Second call with same key — update
    const second = await upsertIdentity({
      orgId: 'org-1',
      platform: 'tiktok',
      accountId: 'adv-123',
      identityId: 'ident-001',
      identityType: 'TT_USER',
      displayName: 'New Name',
    })

    // Same deterministic id
    expect(second.id).toBe(first.id)
    // createdAt is preserved from the stored doc
    expect(second.createdAt).toEqual(first.createdAt)
    // displayName updated
    expect(second.displayName).toBe('New Name')
  })

  it('listIdentities filters by orgId and optional platform and accountId', async () => {
    await upsertIdentity({
      orgId: 'org-1',
      platform: 'tiktok',
      accountId: 'adv-111',
      identityId: 'ident-A',
      identityType: 'TT_USER',
    })
    await upsertIdentity({
      orgId: 'org-1',
      platform: 'tiktok',
      accountId: 'adv-222',
      identityId: 'ident-B',
      identityType: 'AUTH_CODE',
    })
    await upsertIdentity({
      orgId: 'org-2',
      platform: 'tiktok',
      accountId: 'adv-111',
      identityId: 'ident-C',
      identityType: 'TT_USER',
    })

    // All for org-1
    const allOrg1 = await listIdentities({ orgId: 'org-1' })
    expect(allOrg1).toHaveLength(2)

    // Filtered by platform
    const tiktokOrg1 = await listIdentities({ orgId: 'org-1', platform: 'tiktok' })
    expect(tiktokOrg1).toHaveLength(2)

    // Filtered by accountId
    const adv111Org1 = await listIdentities({ orgId: 'org-1', accountId: 'adv-111' })
    expect(adv111Org1).toHaveLength(1)
    expect(adv111Org1[0].identityId).toBe('ident-A')

    // Different org — no cross-tenant leakage
    const allOrg2 = await listIdentities({ orgId: 'org-2' })
    expect(allOrg2).toHaveLength(1)
    expect(allOrg2[0].identityId).toBe('ident-C')
  })

  it('getIdentity returns null for a missing id', async () => {
    const result = await getIdentity('id_nonexistentdocumentid0000000')
    expect(result).toBeNull()
  })
})
