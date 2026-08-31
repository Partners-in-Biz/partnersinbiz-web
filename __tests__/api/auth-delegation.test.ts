import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockDelegationUpdate = jest.fn()
let mockDelegationDocs: Array<{ id: string; data: () => Record<string, unknown>; ref: { update: jest.Mock } }> = []

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: (token: string) => mockVerifyIdToken(token),
    verifySessionCookie: (cookie: string, checkRevoked?: boolean) => mockVerifySessionCookie(cookie, checkRevoked),
  },
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'agent_delegations') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                empty: mockDelegationDocs.length === 0,
                docs: mockDelegationDocs,
              })),
            })),
          })),
        }
      }
      if (name === 'api_keys') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({ empty: true, docs: [] })),
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
  return new NextRequest('http://localhost/api/v1/test?orgId=org-1', {
    headers: new Headers({
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    }),
  })
}

function delegationDoc(rawToken: string, data: Record<string, unknown>) {
  return {
    id: 'dlg-1',
    data: () => ({
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      actingForUserId: 'user-123',
      agentId: 'pip',
      role: 'client',
      orgId: 'org-1',
      activeOrgId: 'org-1',
      orgIds: ['org-1'],
      scopes: ['documents:create'],
      status: 'active',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ...data,
    }),
    ref: { update: mockDelegationUpdate },
  }
}

describe('user delegation auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AI_API_KEY = 'legacy-shared-key'
    mockVerifyIdToken.mockRejectedValue(new Error('not firebase'))
    mockVerifySessionCookie.mockRejectedValue(new Error('no cookie'))
    mockDelegationUpdate.mockResolvedValue(undefined)
    mockDelegationDocs = []
    jest.resetModules()
  })

  it('resolves a valid delegation token to the acting human with scoped authKind', async () => {
    const rawToken = 'pib_dlg_valid-delegation-secret'
    mockDelegationDocs = [delegationDoc(rawToken, {})]

    const { resolveUser } = await import('@/lib/api/auth')
    const user = await resolveUser(makeReq(rawToken))

    expect(user).toEqual(expect.objectContaining({
      uid: 'user-123',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'pip',
      delegationId: 'dlg-1',
      actingForUserId: 'user-123',
      delegationScopes: ['documents:create'],
      orgId: 'org-1',
      activeOrgId: 'org-1',
    }))
    expect(mockDelegationUpdate).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.anything() }))
  })

  it('narrows a stored memberAccessPolicy onto the resolved user and drops garbage', async () => {
    const rawToken = 'pib_dlg_valid-delegation-secret'
    const policy = {
      preset: 'full',
      modules: { crm: true },
      recordScopes: { crm: 'all' },
      agentRuntimeAccess: {},
      allowPersonalLlmOnOrgVps: false,
      capabilities: { invoices: true, quotes: true },
    }
    mockDelegationDocs = [delegationDoc(rawToken, { memberAccessPolicy: policy })]
    const { resolveDelegationTokenUser } = await import('@/lib/api/delegations')
    const user = await resolveDelegationTokenUser(rawToken)
    expect(user?.memberAccessPolicy).toEqual(policy)

    mockDelegationDocs = [delegationDoc(rawToken, { memberAccessPolicy: { leftover: true } })]
    const dropped = await resolveDelegationTokenUser(rawToken)
    expect(dropped?.memberAccessPolicy).toBeUndefined()
  })

  it('rejects expired or revoked delegation tokens', async () => {
    const rawToken = 'pib_dlg_expired'
    mockDelegationDocs = [delegationDoc(rawToken, { expiresAt: '2020-01-01T00:00:00.000Z' })]
    const { resolveUser } = await import('@/lib/api/auth')
    await expect(resolveUser(makeReq(rawToken))).resolves.toBeNull()

    mockDelegationDocs = [delegationDoc(rawToken, { expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: '2099-01-01T00:00:00.000Z' })]
    await expect(resolveUser(makeReq(rawToken))).resolves.toBeNull()
  })
})
