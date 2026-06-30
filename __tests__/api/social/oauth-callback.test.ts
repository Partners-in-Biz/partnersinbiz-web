import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: jest.fn(), delete: jest.fn() })),
      where: jest.fn(),
    })),
  },
}))

jest.mock('@/lib/social/oauth-config', () => ({
  getOAuthConfig: jest.fn(),
  getClientCredentials: jest.fn(),
  getCallbackUrl: jest.fn(),
}))

jest.mock('@/lib/social/encryption', () => ({
  encryptTokenBlock: jest.fn(),
}))

jest.mock('@/lib/social/providers/registry', () => ({
  getProvider: jest.fn(),
}))

jest.mock('@/lib/social/instagram-oauth', () => ({
  exchangeInstagramLongLivedToken: jest.fn(),
}))

jest.mock('@/lib/social/audit', () => ({
  logAudit: jest.fn(),
}))

function encodeState(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state)).toString('base64url')
}

describe('social OAuth callback redirects', () => {
  it('keeps provider errors on the saved personal return path', async () => {
    const state = encodeState({
      orgId: 'org-1',
      nonce: 'nonce-1',
      redirectUrl: '/portal/personal/social/accounts',
      accountScope: 'personal',
      ownerUid: 'user-1',
    })

    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')
    const res = await GET(new NextRequest(`http://localhost/api/v1/social/oauth/twitter/callback?error=access_denied&state=${state}`))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/portal/personal/social/accounts?status=error&message=access_denied')
  })
})
