import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockApiKeyUpdate = jest.fn()
const mockTimingSafeEqual = jest.fn()
let mockApiKeyDocs: Array<{ id: string; data: () => Record<string, unknown>; ref: { update: jest.Mock } }> = []

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto')
  return {
    ...actual,
    timingSafeEqual: (...args: Parameters<typeof actual.timingSafeEqual>) =>
      mockTimingSafeEqual(...args),
  }
})

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: (token: string) => mockVerifyIdToken(token),
    verifySessionCookie: (cookie: string, checkRevoked?: boolean) => mockVerifySessionCookie(cookie, checkRevoked),
  },
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'api_keys') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                empty: mockApiKeyDocs.length === 0,
                docs: mockApiKeyDocs,
              })),
            })),
          })),
        }
      }
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({ exists: false })),
        })),
      }
    }),
  },
}))

function makeReq(token: string) {
  return new NextRequest('http://localhost/api/v1/test', {
    headers: new Headers({ authorization: `Bearer ${token}` }),
  })
}

function apiKeyDoc(rawKey: string, data: Record<string, unknown>) {
  return {
    id: 'api-key-1',
    data: () => ({
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 12),
      role: 'ai',
      permissions: [{ resource: 'ads', actions: ['read', 'write', 'spend'] }],
      agentId: 'ads',
      ...data,
    }),
    ref: { update: mockApiKeyUpdate },
  }
}

describe('agent API key auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AI_API_KEY = 'legacy-shared-key'
    mockVerifyIdToken.mockRejectedValue(new Error('not firebase'))
    mockVerifySessionCookie.mockRejectedValue(new Error('no cookie'))
    mockApiKeyUpdate.mockResolvedValue(undefined)
    mockApiKeyDocs = []
    jest.resetModules()
  })

  it('resolves a valid hashed API key to the owning agent and permissions', async () => {
    const rawKey = 'pib_ag_valid-agent-secret'
    mockApiKeyDocs = [apiKeyDoc(rawKey, { agentId: 'ads' })]

    const { resolveUser } = await import('@/lib/api/auth')
    const user = await resolveUser(makeReq(rawKey))

    expect(user).toEqual(expect.objectContaining({
      uid: 'agent:ads',
      role: 'ai',
      authKind: 'agent_api_key',
      agentId: 'ads',
      apiKeyId: 'api-key-1',
      permissions: [{ resource: 'ads', actions: ['read', 'write', 'spend'] }],
    }))
    expect(mockApiKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.anything() }))
  })

  it('uses a timing-safe comparison for the legacy AI_API_KEY path', async () => {
    const actualCrypto = jest.requireActual('crypto')
    mockTimingSafeEqual.mockImplementation(actualCrypto.timingSafeEqual)

    const { resolveUser } = await import('@/lib/api/auth')
    const user = await resolveUser(makeReq('legacy-shared-key'))

    expect(user).toEqual(expect.objectContaining({
      uid: 'ai-agent',
      role: 'ai',
      authKind: 'legacy_ai_key',
    }))
    expect(mockTimingSafeEqual).toHaveBeenCalled()
  })

  it('rejects short mismatched legacy AI_API_KEY bearers without throwing', async () => {
    const actualCrypto = jest.requireActual('crypto')
    mockTimingSafeEqual.mockImplementation(actualCrypto.timingSafeEqual)

    const { resolveUser } = await import('@/lib/api/auth')

    await expect(resolveUser(makeReq('short'))).resolves.toBeNull()
    expect(mockTimingSafeEqual).toHaveBeenCalled()
  })

  it('rejects revoked and expired agent API keys', async () => {
    const rawKey = 'pib_ag_revoked'
    mockApiKeyDocs = [apiKeyDoc(rawKey, { revokedAt: { seconds: 1770000000 } })]

    const { resolveUser } = await import('@/lib/api/auth')
    await expect(resolveUser(makeReq(rawKey))).resolves.toBeNull()

    mockApiKeyDocs = [apiKeyDoc(rawKey, {
      revokedAt: null,
      expiresAt: { toDate: () => new Date('2020-01-01T00:00:00.000Z') },
    })]
    await expect(resolveUser(makeReq(rawKey))).resolves.toBeNull()
  })
})
