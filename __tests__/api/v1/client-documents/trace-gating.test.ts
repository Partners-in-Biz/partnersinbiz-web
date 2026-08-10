import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockDocGet = jest.fn()
const mockVersionDoc = jest.fn()
const mockVersionsGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn() })),
    runTransaction: jest.fn(),
  },
}))

jest.mock('@/lib/client-documents/canonical-grants', () => ({
  findDocumentPartnerLinkId: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/orgMembers/active-membership', () => ({
  hasActiveOrgMembership: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any, ctx?: any) => {
    const roleOk = user?.role === 'ai' || user?.role === 'admin' || (requiredRole === 'client' && user?.role === 'client')
    if (!roleOk) return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 })
    return handler(req, user, ctx)
  },
}))

const clientUser = { uid: 'client-1', role: 'client' as const, orgId: 'client-org' }

beforeEach(() => {
  jest.clearAllMocks()
  const versionRef = { id: 'version-1', update: jest.fn(), set: jest.fn() }
  const versions = { doc: mockVersionDoc.mockReturnValue(versionRef), get: mockVersionsGet }
  const documentRef = { id: 'doc-1', get: mockDocGet, update: jest.fn(), collection: jest.fn(() => versions) }
  mockCollection.mockImplementation(() => ({
    doc: jest.fn(() => documentRef),
    where: jest.fn(),
  }))
  mockVersionsGet.mockResolvedValue({ docs: [] })
  mockDocGet.mockReset()
})

it('denies a selected-version list when the active named grant forbids version access', async () => {
  mockDocGet.mockResolvedValueOnce({
    exists: true,
    id: 'doc-1',
    data: () => ({
      orgId: 'pib-platform-owner',
      title: 'Shared proposal',
      status: 'client_review',
      currentVersionId: 'version-1',
      linked: { clientOrgId: 'client-org' },
      userShares: [
        {
          userId: 'client-1',
          recipientOrgId: 'client-org',
          status: 'active',
          grantedBy: 'admin-1',
          grantedAt: '2026-08-01T00:00:00.000Z',
          permissions: { canView: true, canComment: false, canSuggest: false, canViewVersions: false, canViewAttachments: true },
        },
      ],
      deleted: false,
    }),
  })
  mockVersionDoc.mockReturnValueOnce({
    id: 'version-1',
    get: jest.fn().mockResolvedValue({ exists: true, id: 'version-1', data: () => ({ versionNumber: 1, status: 'published' }) }),
  })

  const { GET } = await import('@/app/api/v1/client-documents/[id]/versions/route')
  const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/versions')
  const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
  expect(res.status).toBe(403)
})
