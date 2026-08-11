import {
  clearWorkspaceCatalogueCache,
  readWorkspaceCatalogueCache,
  WORKSPACE_CATALOGUE_RESPONSE_CACHE_TTL_MS,
  workspaceCatalogueCacheKey,
  writeWorkspaceCatalogueCache,
} from '@/lib/workspaces/catalogue-response-cache'
import { createRequestScopedDb } from '@/lib/workspaces/request-scoped-db'

describe('workspace catalogue response cache', () => {
  beforeEach(() => {
    clearWorkspaceCatalogueCache()
  })

  it('keys by org, user, and agent', () => {
    expect(workspaceCatalogueCacheKey({
      orgId: 'org-a', userId: 'user-1', agentId: 'pip',
    })).toBe('org-a::user-1::pip')
  })

  it('returns cached payloads inside the TTL and expires afterward', () => {
    const key = 'org::user::pip'
    writeWorkspaceCatalogueCache(key, { projects: 1 }, { nowMs: 1_000, ttlMs: 20_000 })
    expect(readWorkspaceCatalogueCache(key, 1_000 + 5_000)).toEqual({ projects: 1 })
    expect(readWorkspaceCatalogueCache(key, 1_000 + WORKSPACE_CATALOGUE_RESPONSE_CACHE_TTL_MS + 1)).toBeNull()
  })
})

describe('request-scoped db memo', () => {
  it('reuses identical collection.get and where.get promises inside one request', async () => {
    let collectionGets = 0
    let queryGets = 0
    let docGets = 0
    const underlying = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            docGets += 1
            return { exists: true, id, data: () => ({ name }) }
          },
        }),
        where: (field: string, op: string, value: unknown) => ({
          get: async () => {
            queryGets += 1
            return { docs: [{ data: () => ({ field, op, value }) }] }
          },
        }),
        get: async () => {
          collectionGets += 1
          return { docs: [{ id: name, data: () => ({ name }) }] }
        },
      }),
    }

    const db = createRequestScopedDb(underlying)
    const [a, b] = await Promise.all([
      db.collection('linked_devices').get(),
      db.collection('linked_devices').get(),
    ])
    expect(a).toBe(b)
    expect(collectionGets).toBe(1)

    const [q1, q2] = await Promise.all([
      db.collection('project_execution_locations').where!('allowedOrgIds', 'array-contains', 'org-1').get(),
      db.collection('project_execution_locations').where!('allowedOrgIds', 'array-contains', 'org-1').get(),
    ])
    expect(q1).toBe(q2)
    expect(queryGets).toBe(1)

    const [d1, d2] = await Promise.all([
      db.collection('orgMembers').doc('org-1_user-1').get(),
      db.collection('orgMembers').doc('org-1_user-1').get(),
    ])
    expect(d1).toBe(d2)
    expect(docGets).toBe(1)
  })
})
