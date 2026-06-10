jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
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
import { installPortalAuthCollectionMock } from '../../../../helpers/firebase-admin'

const member = { uid: 'uid-1', orgId: 'org-1', role: 'member' }

function portalRequest(url: string, init?: RequestInit) {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({
      Cookie: '__session=session-token',
      ...(init?.headers ?? {}),
    }),
  })
}

function stagePortalAuth(collectionOverrides: Record<string, unknown> = {}) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  installPortalAuthCollectionMock(adminDb.collection as jest.Mock, member, {
    collections: collectionOverrides,
  })
}

describe('portal email Google linking', () => {
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

  it('rejects direct Google account creation without a real OAuth callback', async () => {
    const add = jest.fn()
    stagePortalAuth({
      mailbox_accounts: {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
        add,
      },
    })

    const { POST } = await import('@/app/api/v1/portal/email/accounts/route')
    const res = await POST(portalRequest('http://localhost/api/v1/portal/email/accounts', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'google',
        emailAddress: 'hello@partnersinbiz.online',
        displayName: 'Hello',
        googleOAuth: true,
      }),
    }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/OAuth/i)
    expect(add).not.toHaveBeenCalled()
  })

  it('starts Google OAuth with Gmail scopes and a single-use state record', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    stagePortalAuth({
      mailbox_oauth_states: {
        doc: jest.fn(() => ({ set })),
      },
    })

    const { GET } = await import('@/app/api/v1/portal/email/google/authorize/route')
    const res = await GET(portalRequest('http://localhost/api/v1/portal/email/google/authorize?emailAddress=hello%40partnersinbiz.online&displayName=Hello'))

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
      orgId: member.orgId,
      uid: member.uid,
      emailAddress: 'hello@partnersinbiz.online',
      displayName: 'Hello',
      redirectUri: 'http://localhost:3000/api/v1/portal/email/google/callback',
    }))
  })

  it('exchanges the Google callback code and stores real mailbox OAuth credentials', async () => {
    const deleteState = jest.fn().mockResolvedValue(undefined)
    const addAccount = jest.fn().mockResolvedValue({ id: 'acct-1' })
    const getAccounts = jest.fn().mockResolvedValue({ docs: [] })
    stagePortalAuth({
      mailbox_oauth_states: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              orgId: member.orgId,
              uid: member.uid,
              profileId: `${member.orgId}_${member.uid}`,
              emailAddress: 'hint@partnersinbiz.online',
              displayName: 'Hint Name',
              redirectUri: 'http://localhost:3000/api/v1/portal/email/google/callback',
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
            email: 'hello@partnersinbiz.online',
            name: 'Hello Person',
          }),
        }
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { GET } = await import('@/app/api/v1/portal/email/google/callback/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/email/google/callback?code=abc&state=state-1'))

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3000/portal/email?emailStatus=connected')
    expect(deleteState).toHaveBeenCalled()
    expect(addAccount).toHaveBeenCalledWith(expect.objectContaining({
      orgId: member.orgId,
      uid: member.uid,
      provider: 'google',
      emailAddress: 'hello@partnersinbiz.online',
      displayName: 'Hello Person',
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
