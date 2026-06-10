type TestDocData = Record<string, unknown>

export type FirestoreTestDoc = {
  id: string
  data: () => TestDocData
}

export type FirestoreQueryMock = {
  where: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  get: jest.Mock
}

type PortalMember = {
  uid: string
  orgId: string
  role: string
  firstName?: string
  lastName?: string
}

type PortalCollectionOptions = {
  permissions?: Record<string, unknown>
  collections?: Record<string, unknown>
}

export function makeFirestoreDoc(id: string, data: TestDocData): FirestoreTestDoc {
  return { id, data: () => data }
}

export function makeFirestoreQuery(docs: FirestoreTestDoc[] = []): FirestoreQueryMock {
  const query = {} as FirestoreQueryMock
  query.where = jest.fn(() => query)
  query.orderBy = jest.fn(() => query)
  query.limit = jest.fn(() => query)
  query.get = jest.fn(async () => ({ docs }))
  return query
}

export function makeMissingDocCollection() {
  return {
    doc: jest.fn(() => ({
      get: jest.fn(async () => ({ exists: false })),
    })),
  }
}

export function makePortalAuthCollections(member: PortalMember, opts: PortalCollectionOptions = {}) {
  const permissions = opts.permissions ?? {}
  const orgMemberDoc = makeFirestoreDoc(`${member.orgId}_${member.uid}`, member)

  return {
    users: {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: true,
          data: () => ({ activeOrgId: member.orgId }),
        })),
      })),
    },
    orgMembers: {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: true, data: () => member })),
      })),
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ docs: [orgMemberDoc] })),
      })),
    },
    organizations: {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: true,
          data: () => ({ settings: { permissions } }),
        })),
      })),
    },
    ...(opts.collections ?? {}),
  }
}

export function installPortalAuthCollectionMock(
  collectionMock: jest.Mock,
  member: PortalMember,
  opts: PortalCollectionOptions = {},
) {
  const collections = makePortalAuthCollections(member, opts)
  collectionMock.mockImplementation((name: string) => {
    return collections[name as keyof typeof collections] ?? makeMissingDocCollection()
  })
  return collections
}
