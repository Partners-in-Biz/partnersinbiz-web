import { NextRequest } from 'next/server'

const mockSet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'uid-1'),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

type ProfileMember = {
  uid: string
  orgId: string
  role?: string
  firstName?: string
  lastName?: string
  jobTitle?: string
  phone?: string
  avatarUrl?: string
  profileBannerDismissed?: boolean
}

function installProfileCollections({
  userData = { activeOrgId: 'org-1' },
  members = [],
  orgData = { members: [] },
}: {
  userData?: Record<string, unknown> | null
  members?: ProfileMember[]
  orgData?: Record<string, unknown>
} = {}) {
  const memberByDocId = new Map(members.map((member) => [`${member.orgId}_${member.uid}`, member]))
  const memberDocs = members.map((member) => ({
    id: `${member.orgId}_${member.uid}`,
    data: () => member,
  }))

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({
            exists: Boolean(userData),
            data: () => userData ?? undefined,
          })),
        })),
      }
    }

    if (name === 'orgMembers') {
      return {
        doc: jest.fn((id: string) => ({
          get: jest.fn(async () => ({
            exists: memberByDocId.has(id),
            data: () => memberByDocId.get(id),
          })),
          set: mockSet,
        })),
        where: jest.fn((field: string, op: string, value: unknown) => ({
          get: jest.fn(async () => ({
            docs: memberDocs.filter((doc) => {
              const data = doc.data()
              if (op !== '==') return true
              return data[field as keyof ProfileMember] === value
            }),
          })),
        })),
      }
    }

    if (name === 'organizations') {
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({
            exists: true,
            data: () => orgData,
          })),
        })),
      }
    }

    return {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false })),
      })),
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSet.mockResolvedValue(undefined)
})

describe('GET /api/v1/portal/settings/profile', () => {
  it('returns empty profile when no orgMembers doc exists', async () => {
    installProfileCollections({ members: [], orgData: { members: [] } })

    const { GET } = await import('@/app/api/v1/portal/settings/profile/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/profile', {
      headers: { Cookie: '__session=valid' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toEqual({ firstName: '', lastName: '', jobTitle: '', phone: '', avatarUrl: '', role: null, profileBannerDismissed: false })
  })

  it('returns profile fields when doc exists', async () => {
    installProfileCollections({
      members: [
        {
          uid: 'uid-1',
          orgId: 'org-1',
          firstName: 'Peet',
          lastName: 'Stander',
          jobTitle: 'CEO',
          phone: '',
          avatarUrl: '',
          role: 'owner',
          profileBannerDismissed: false,
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/portal/settings/profile/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/profile', {
      headers: { Cookie: '__session=valid' },
    })
    const res = await GET(req)
    const body = await res.json()
    expect(body.profile.firstName).toBe('Peet')
    expect(body.profile.role).toBe('owner')
  })
})

describe('PATCH /api/v1/portal/settings/profile', () => {
  it('upserts profile and returns updated fields', async () => {
    installProfileCollections({ members: [{ uid: 'uid-1', orgId: 'org-1', role: 'owner' }] })

    const { PATCH } = await import('@/app/api/v1/portal/settings/profile/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/profile', {
      method: 'PATCH',
      headers: { Cookie: '__session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Peet', lastName: 'Stander', jobTitle: 'CEO' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Peet', lastName: 'Stander', jobTitle: 'CEO' }),
      { merge: true }
    )
  })

  it('returns 400 when firstName is missing and banner not being dismissed', async () => {
    installProfileCollections({ members: [{ uid: 'uid-1', orgId: 'org-1', role: 'member' }] })

    const { PATCH } = await import('@/app/api/v1/portal/settings/profile/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/profile', {
      method: 'PATCH',
      headers: { Cookie: '__session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastName: 'Stander' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('allows empty firstName when profileBannerDismissed is true', async () => {
    installProfileCollections({ members: [{ uid: 'uid-1', orgId: 'org-1', role: 'member' }] })

    const { PATCH } = await import('@/app/api/v1/portal/settings/profile/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/profile', {
      method: 'PATCH',
      headers: { Cookie: '__session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: '', lastName: '', profileBannerDismissed: true }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ profileBannerDismissed: true }),
      { merge: true }
    )
  })
})
