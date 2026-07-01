jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn(), verifyIdToken: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/integrations/crypto', () => ({
  encryptCredentials: jest.fn((credentials: Record<string, unknown>) => ({
    encrypted: true,
    credentials,
  })),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    now: jest.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: jest.fn((value: number) => ({ toMillis: () => value })),
  },
}))

import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

const adminUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }

function adminRequest(url: string, init?: RequestInit) {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({
      Cookie: '__session=session-token',
      ...(init?.headers ?? {}),
    }),
  })
}

function stageAdminAuth(collectionOverrides: Record<string, unknown> = {}) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: adminUser.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (collectionOverrides[name]) return collectionOverrides[name]
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => adminUser }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('admin mailbox Google linking', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('starts admin Google OAuth against the platform workspace and returns to the admin mailbox', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    stageAdminAuth({
      mailbox_oauth_states: {
        doc: jest.fn(() => ({ set })),
      },
    })

    const { GET } = await import('@/app/api/v1/admin/mailbox/google/authorize/route')
    const res = await GET(adminRequest('http://localhost/api/v1/admin/mailbox/google/authorize?emailAddress=admin%40partnersinbiz.online&displayName=Admin'))

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    const url = new URL(location!)
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      uid: adminUser.uid,
      profileId: 'pib-platform-owner_admin-1',
      emailAddress: 'admin@partnersinbiz.online',
      displayName: 'Admin',
      redirectUri: 'http://localhost:3000/api/v1/admin/mailbox/google/callback',
      returnTo: '/admin/email/mailbox',
    }))
  })

  it('can start admin Google OAuth for an existing platform mailbox account', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    stageAdminAuth({
      mailbox_accounts: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              orgId: 'pib-platform-owner',
              uid: 'shared-user-1',
              profileId: 'pib-platform-owner_shared-user-1',
              provider: 'google',
              emailAddress: 'hello@partnersinbiz.online',
              displayName: 'Partners in Biz',
              status: 'needs_setup',
            }),
          }),
        })),
      },
      mailbox_oauth_states: {
        doc: jest.fn(() => ({ set })),
      },
    })

    const { GET } = await import('@/app/api/v1/admin/mailbox/google/authorize/route')
    const res = await GET(adminRequest('http://localhost/api/v1/admin/mailbox/google/authorize?mailboxAccountId=acct-shared&returnTo=/admin/email/mailbox'))

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    const url = new URL(location!)
    expect(url.searchParams.get('login_hint')).toBe('hello@partnersinbiz.online')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      uid: 'shared-user-1',
      profileId: 'pib-platform-owner_shared-user-1',
      emailAddress: 'hello@partnersinbiz.online',
      displayName: 'Partners in Biz',
      redirectUri: 'http://localhost:3000/api/v1/admin/mailbox/google/callback',
      returnTo: '/admin/email/mailbox',
    }))
  })

  it('exchanges the admin Google callback and stores OAuth credentials on the platform profile', async () => {
    const deleteState = jest.fn().mockResolvedValue(undefined)
    const addAccount = jest.fn().mockResolvedValue({ id: 'acct-admin' })
    const getAccounts = jest.fn().mockResolvedValue({ docs: [] })
    stageAdminAuth({
      mailbox_oauth_states: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              orgId: 'pib-platform-owner',
              uid: adminUser.uid,
              profileId: 'pib-platform-owner_admin-1',
              emailAddress: 'hint@partnersinbiz.online',
              displayName: 'Hint Admin',
              redirectUri: 'http://localhost:3000/api/v1/admin/mailbox/google/callback',
              returnTo: '/admin/email/mailbox',
              expiresAt: { toMillis: () => Date.now() + 60_000 },
            }),
          }),
          delete: deleteState,
        })),
      },
      mailbox_accounts: {
        where: jest.fn().mockReturnThis(),
        get: getAccounts,
        add: addAccount,
      },
    })
    const fetchMock = jest.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return {
          ok: true,
          json: async () => ({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
            token_type: 'Bearer',
          }),
        }
      }
      if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: 'admin@partnersinbiz.online',
            name: 'Admin Person',
          }),
        }
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { GET } = await import('@/app/api/v1/admin/mailbox/google/callback/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/mailbox/google/callback?code=***&state=state-1'))

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3000/admin/email/mailbox?emailStatus=connected')
    expect(deleteState).toHaveBeenCalled()
    expect(addAccount).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      uid: adminUser.uid,
      profileId: 'pib-platform-owner_admin-1',
      provider: 'google',
      emailAddress: 'admin@partnersinbiz.online',
      displayName: 'Admin Person',
      status: 'connected',
      googleEnc: expect.objectContaining({
        credentials: expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'Bearer',
        }),
      }),
    }))
  })
})
