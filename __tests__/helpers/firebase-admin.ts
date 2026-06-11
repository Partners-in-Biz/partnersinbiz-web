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
  return makePortalAuthCollectionsForMembers([member], opts)
}

export function makePortalAuthCollectionsForMembers(members: PortalMember[], opts: PortalCollectionOptions = {}) {
  const permissions = opts.permissions ?? {}
  const orgMemberDocs = members.map((member) => makeFirestoreDoc(`${member.orgId}_${member.uid}`, member))
  const memberByUid = new Map(members.map((member) => [member.uid, member]))
  const memberByDocId = new Map(members.map((member) => [`${member.orgId}_${member.uid}`, member]))

  return {
    users: {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(async () => ({
          exists: memberByUid.has(uid),
          data: () => {
            const member = memberByUid.get(uid)
            return member ? { activeOrgId: member.orgId } : undefined
          },
        })),
      })),
    },
    orgMembers: {
      doc: jest.fn((id: string) => ({
        get: jest.fn(async () => ({
          exists: memberByDocId.has(id),
          data: () => memberByDocId.get(id),
        })),
      })),
      where: jest.fn((field: string, op: string, value: unknown) => ({
        get: jest.fn(async () => ({
          docs: orgMemberDocs.filter((doc) => {
            const data = doc.data()
            if (op !== '==') return true
            return data[field] === value
          }),
        })),
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
