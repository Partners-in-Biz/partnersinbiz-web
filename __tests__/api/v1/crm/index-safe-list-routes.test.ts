jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { callAsMember, seedOrgMember } from '../../../helpers/crm'

process.env.SESSION_COOKIE_NAME = '__session'

type FirestoreDoc = { id: string; data: () => Record<string, unknown> }
type QueryOperation = { type: string; field?: string; op?: string; value?: unknown }
type CapturedCollection = {
  where: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  offset: jest.Mock
  get: jest.Mock
}

function stageMemberAuth(member: ReturnType<typeof seedOrgMember>) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
}

function baseAuthCollections(member: ReturnType<typeof seedOrgMember>, name: string) {
  if (name === 'users') {
    return {
      doc: () => ({
        get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
      }),
    }
  }
  if (name === 'orgMembers') {
    return {
      doc: () => ({
        get: () => Promise.resolve({ exists: true, data: () => member }),
      }),
      where: (_field: string, _op: string, value: string) => ({
        get: () => Promise.resolve({
          docs: value === member.uid
            ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
            : [],
        }),
      }),
    }
  }
  if (name === 'organizations') {
    return {
      doc: () => ({
        get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
      }),
    }
  }
  return null
}

function docs(rows: Array<{ id: string; data: Record<string, unknown> }>): FirestoreDoc[] {
  return rows.map((row) => ({ id: row.id, data: () => row.data }))
}

function collectionWithOperationCapture(
  rows: FirestoreDoc[],
  operations: QueryOperation[],
) {
  const chain = {} as CapturedCollection
  chain.where = jest.fn((field: string, op: string, value: unknown) => {
    operations.push({ type: 'where', field, op, value })
    return chain
  })
  chain.orderBy = jest.fn((field: string) => {
    operations.push({ type: 'orderBy', field })
    return chain
  })
  chain.limit = jest.fn((value: number) => {
    operations.push({ type: 'limit', value })
    return chain
  })
  chain.offset = jest.fn((value: number) => {
    operations.push({ type: 'offset', value })
    return chain
  })
  chain.get = jest.fn().mockResolvedValue({ docs: rows })
  return chain
}

describe('CRM/settings list route Firestore query shape', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('contacts list uses only orgId in Firestore and filters the rest in memory', async () => {
    const member = seedOrgMember('org-1', 'uid-contacts', { role: 'viewer' })
    const operations: QueryOperation[] = []
    stageMemberAuth(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const auth = baseAuthCollections(member, name)
      if (auth) return auth
      if (name === 'contacts') {
        return collectionWithOperationCapture(
          docs([
            // Contacts must be assigned to the viewer (assignedTo) so the
            // assignment-based read scope lets them through; this test exercises
            // the in-memory stage/type/source/tags/search filtering, not access.
            { id: 'keep', data: { orgId: 'org-1', assignedTo: 'uid-contacts', name: 'Alice Buyer', email: 'alice@example.com', stage: 'new', type: 'lead', source: 'manual', tags: ['vip'], createdAt: { seconds: 20 }, deleted: false } },
            { id: 'wrong-stage', data: { orgId: 'org-1', assignedTo: 'uid-contacts', name: 'Bob Buyer', email: 'bob@example.com', stage: 'won', type: 'lead', source: 'manual', tags: ['vip'], createdAt: { seconds: 30 }, deleted: false } },
            { id: 'wrong-org', data: { orgId: 'org-2', assignedTo: 'uid-contacts', name: 'Alice Other', email: 'other@example.com', stage: 'new', type: 'lead', source: 'manual', tags: ['vip'], createdAt: { seconds: 40 }, deleted: false } },
          ]),
          operations,
        )
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts?stage=new&type=lead&source=manual&tags=vip&search=alice&limit=20')
    const { GET } = await import('@/app/api/v1/crm/contacts/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((contact: { id: string }) => contact.id)).toEqual(['keep'])
    expect(operations.filter((op) => op.type === 'where')).toEqual([
      { type: 'where', field: 'orgId', op: '==', value: 'org-1' },
    ])
    expect(operations.some((op) => op.type === 'orderBy')).toBe(false)
  })

  it('saved views list filters uid/resourceKind in memory after an orgId-only read', async () => {
    const member = seedOrgMember('org-1', 'uid-views', { role: 'viewer' })
    const operations: QueryOperation[] = []
    stageMemberAuth(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const auth = baseAuthCollections(member, name)
      if (auth) return auth
      if (name === 'saved_views') {
        return collectionWithOperationCapture(
          docs([
            { id: 'own-contact', data: { orgId: 'org-1', uid: 'uid-views', resourceKind: 'contacts', name: 'Mine', createdAt: { seconds: 30 } } },
            { id: 'own-deal', data: { orgId: 'org-1', uid: 'uid-views', resourceKind: 'deals', name: 'Deals', createdAt: { seconds: 20 } } },
            { id: 'other-user', data: { orgId: 'org-1', uid: 'uid-other', resourceKind: 'contacts', name: 'Other', createdAt: { seconds: 10 } } },
          ]),
          operations,
        )
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/saved-views?resourceKind=contacts')
    const { GET } = await import('@/app/api/v1/crm/saved-views/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.views.map((view: { id: string }) => view.id)).toEqual(['own-contact'])
    expect(operations.filter((op) => op.type === 'where')).toEqual([
      { type: 'where', field: 'orgId', op: '==', value: 'org-1' },
    ])
    expect(operations.some((op) => op.type === 'orderBy')).toBe(false)
  })

  it('pipelines list filters deleted/archived in memory after an orgId-only read', async () => {
    const member = seedOrgMember('org-1', 'uid-pipes', { role: 'viewer' })
    const operations: QueryOperation[] = []
    stageMemberAuth(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const auth = baseAuthCollections(member, name)
      if (auth) return auth
      if (name === 'pipelines') {
        return collectionWithOperationCapture(
          docs([
            { id: 'default', data: { orgId: 'org-1', name: 'Default', isDefault: true, archived: false, deleted: false, createdAt: { seconds: 10 } } },
            { id: 'archived', data: { orgId: 'org-1', name: 'Archived', isDefault: false, archived: true, deleted: false, createdAt: { seconds: 30 } } },
            { id: 'deleted', data: { orgId: 'org-1', name: 'Deleted', isDefault: false, archived: false, deleted: true, createdAt: { seconds: 40 } } },
          ]),
          operations,
        )
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/pipelines')
    const { GET } = await import('@/app/api/v1/crm/pipelines/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.pipelines.map((pipeline: { id: string }) => pipeline.id)).toEqual(['default'])
    expect(operations.filter((op) => op.type === 'where')).toEqual([
      { type: 'where', field: 'orgId', op: '==', value: 'org-1' },
    ])
    expect(operations.some((op) => op.type === 'orderBy')).toBe(false)
  })

  it('CRM webhooks list filters deleted/active in memory after an orgId-only read', async () => {
    const member = seedOrgMember('org-1', 'uid-hooks', { role: 'admin' })
    const operations: QueryOperation[] = []
    stageMemberAuth(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const auth = baseAuthCollections(member, name)
      if (auth) return auth
      if (name === 'outbound_webhooks') {
        return collectionWithOperationCapture(
          docs([
            { id: 'active', data: { orgId: 'org-1', name: 'Active', active: true, deleted: false, createdAt: { seconds: 30 }, secret: 'secret' } },
            { id: 'inactive', data: { orgId: 'org-1', name: 'Inactive', active: false, deleted: false, createdAt: { seconds: 20 }, secret: 'secret' } },
            { id: 'deleted', data: { orgId: 'org-1', name: 'Deleted', active: true, deleted: true, createdAt: { seconds: 40 }, secret: 'secret' } },
          ]),
          operations,
        )
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/webhooks?active=true&limit=20')
    const { GET } = await import('@/app/api/v1/crm/webhooks/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.items.map((hook: { id: string }) => hook.id)).toEqual(['active'])
    expect(body.data.items[0].secret).toBe('***')
    expect(operations.filter((op) => op.type === 'where')).toEqual([
      { type: 'where', field: 'orgId', op: '==', value: 'org-1' },
    ])
    expect(operations.some((op) => op.type === 'orderBy')).toBe(false)
  })
})
