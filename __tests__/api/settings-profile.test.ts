import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockSet = jest.fn()
const mockDoc = jest.fn()
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

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ get: mockGet, set: mockSet })
  mockCollection.mockReturnValue({ doc: mockDoc })
})

describe('GET /api/v1/portal/settings/profile', () => {
  it('returns empty profile when no orgMembers doc exists', async () => {
    // users doc
    mockGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })
      // orgMembers doc
      .mockResolvedValueOnce({ exists: false })
      // organization fallback role lookup
      .mockResolvedValueOnce({ exists: true, data: () => ({ members: [] }) })

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
    mockGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ firstName: 'Peet', lastName: 'Stander', jobTitle: 'CEO', phone: '', avatarUrl: '', role: 'owner', profileBannerDismissed: false }),
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
    mockGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })
      // existingDoc read for role
      .mockResolvedValueOnce({ exists: true, data: () => ({ role: 'owner' }) })
    mockSet.mockResolvedValue(undefined)

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
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })

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
    mockGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })
      // existingDoc read for role
      .mockResolvedValueOnce({ exists: true, data: () => ({ role: 'member' }) })
    mockSet.mockResolvedValue(undefined)

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
