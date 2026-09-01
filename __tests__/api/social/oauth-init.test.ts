import { NextRequest } from 'next/server'

const mockSet = jest.fn(async () => undefined)
const mockDoc = jest.fn(() => ({ set: mockSet }))
const mockCollection = jest.fn(() => ({ doc: mockDoc }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'user-1', role: 'client', orgId: 'org-1' }, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => (req: NextRequest, user: any, ctx?: unknown) =>
    handler(req, user, 'org-1', ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 123 })),
    fromDate: jest.fn((date: Date) => ({ toDate: () => date })),
  },
}))

describe('GET /api/v1/social/oauth/[platform]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.LINKEDIN_CMA_ENABLED
    process.env.YOUTUBE_CLIENT_ID = 'youtube-client-id'
    process.env.YOUTUBE_CLIENT_SECRET = 'youtube-client-secret'
  })

  it('stores org-scoped YouTube OAuth state with a safe portal redirect', async () => {
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/social/oauth/youtube?redirectUrl=https%3A%2F%2Fevil.example%2Fsteal'))

    expect(res.status).toBe(307)
    expect(mockCollection).toHaveBeenCalledWith('social_oauth_states')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      platform: 'youtube',
      redirectUrl: '/portal/social',
      accountScope: 'org',
      ownerUid: 'user-1',
    }))
    expect(String(res.headers.get('location'))).toContain('accounts.google.com/o/oauth2/v2/auth')
  })

  it('requests company-page scopes for org LinkedIn connect', async () => {
    delete process.env.LINKEDIN_CMA_ENABLED
    process.env.LINKEDIN_CLIENT_ID = 'li-id'
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret'
    delete process.env.LINKEDIN_PERSONAL_CLIENT_ID
    delete process.env.LINKEDIN_PERSONAL_CLIENT_SECRET

    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/oauth/linkedin?redirectUrl=%2Fportal%2Fsocial%2Faccounts'))

    expect(res.status).toBe(307)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'linkedin',
      accountScope: 'org',
      linkedinMode: 'organization',
    }))
    const location = String(res.headers.get('location'))
    expect(location).toContain('linkedin.com')
    expect(location).toContain('rw_organization_admin')
    expect(location).toContain('w_organization_social')
    expect(location).not.toContain('w_organization_social_feed')
    expect(location).not.toContain('w_member_social')
    expect(decodeURIComponent(location)).toContain('client_id=li-id')
  })

  it('requests company-page scopes when CMA is on and organization mode is asked', async () => {
    process.env.LINKEDIN_CMA_ENABLED = 'true'
    process.env.LINKEDIN_CLIENT_ID = 'li-id'
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret'

    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/oauth/linkedin?redirectUrl=%2Fportal%2Fsocial%2Faccounts&linkedinMode=organization'))

    expect(res.status).toBe(307)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'linkedin',
      linkedinMode: 'organization',
    }))
    const location = String(res.headers.get('location'))
    expect(location).toContain('rw_organization_admin')
    expect(location).toContain('w_organization_social')
    expect(location).not.toContain('w_organization_social_feed')
  })

  it('keeps explicit personal LinkedIn mode on the personal path', async () => {
    delete process.env.LINKEDIN_CMA_ENABLED
    process.env.LINKEDIN_CLIENT_ID = 'li-id'
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret'

    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/oauth/linkedin?scope=personal&linkedinMode=personal'))

    expect(res.status).toBe(307)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'linkedin',
      accountScope: 'personal',
      linkedinMode: 'personal',
    }))
  })
})
