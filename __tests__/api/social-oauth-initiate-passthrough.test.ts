import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockSet = jest.fn()
const mockCollection = jest.fn(() => ({ doc: () => ({ set: mockSet }) }))

type MockAuthHandler = (req: NextRequest, user: ApiUser, orgId: string) => Promise<Response>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest) => Promise<Response>) => handler,
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: MockAuthHandler) => (req: NextRequest) =>
    handler(req, { uid: 'user-1', role: 'client' } as ApiUser, 'org-1'),
}))

jest.mock('@/lib/social/oauth-config', () => ({
  getOAuthConfig: () => ({
    platform: 'youtube',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    usePKCE: false,
  }),
  getClientCredentials: () => ({ clientId: 'cid', clientSecret: 'secret' }),
  getCallbackUrl: () => 'https://partnersinbiz.online/api/v1/social/oauth/youtube/callback',
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => 'NOW_TS',
    fromDate: (d: Date) => ({ __ts: d.toISOString() }),
  },
}))

describe('OAuth initiation feature/prompt passthrough', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockSet.mockResolvedValue(undefined)
  })

  it('stores feature=youtube_studio in the OAuth state document', async () => {
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest(
      'http://localhost/api/v1/social/oauth/youtube?redirectUrl=%2Fportal%2Fyoutube-studio&feature=youtube_studio',
    ))

    expect(res.status).toBe(307)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'youtube',
      orgId: 'org-1',
      feature: 'youtube_studio',
    }))
  })

  it('ignores unknown feature values', async () => {
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    await GET(new NextRequest('http://localhost/api/v1/social/oauth/youtube?feature=evil'))

    expect(mockSet).toHaveBeenCalledWith(expect.not.objectContaining({ feature: expect.anything() }))
  })

  it('forwards prompt=select_account to Google merged with consent', async () => {
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest(
      'http://localhost/api/v1/social/oauth/youtube?prompt=select_account',
    ))

    const location = res.headers.get('location') ?? ''
    const authUrl = new URL(location)
    expect(authUrl.searchParams.get('prompt')).toBe('consent select_account')
  })

  it('leaves the default prompt untouched when no prompt param is sent', async () => {
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/oauth/youtube'))

    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.searchParams.get('prompt')).toBe('consent')
  })
})
