import { NextRequest } from 'next/server'

const mockOrganizationsGet = jest.fn()
let mockUser = {
  uid: 'former-member',
  role: 'client' as const,
  orgId: 'org-active',
  activeOrgId: 'org-active',
  orgIds: ['org-active'],
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) => handler(req, mockUser),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'organizations') throw new Error(`Unexpected collection ${name}`)
      return {
        where: () => ({ get: mockOrganizationsGet }),
      }
    },
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

describe('GET organizations canonical client scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = {
      uid: 'former-member',
      role: 'client',
      orgId: 'org-active',
      activeOrgId: 'org-active',
      orgIds: ['org-active'],
    }
    mockOrganizationsGet.mockResolvedValue({
      docs: [
        {
          id: 'org-active',
          data: () => ({
            name: 'Active organisation', slug: 'active', active: true,
            members: [{ userId: 'former-member', role: 'member' }],
          }),
        },
        {
          id: 'org-revoked',
          data: () => ({
            name: 'Revoked organisation', slug: 'revoked', active: true,
            // This stale embedded row must not override canonical auth scope.
            members: [{ userId: 'former-member', role: 'member' }],
          }),
        },
      ],
    })
  })

  it('does not list an organisation retained only in the embedded member cache', async () => {
    const { GET } = await import('@/app/api/v1/organizations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/organizations'))

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([
      expect.objectContaining({ id: 'org-active', name: 'Active organisation' }),
    ])
  })
})
