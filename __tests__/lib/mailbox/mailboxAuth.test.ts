import { NextRequest } from 'next/server'

const mockResolveDelegationTokenUser = jest.fn()
const mockRemintExpiredMessagesDelegation = jest.fn()
const mockResolveUser = jest.fn()

jest.mock('@/lib/api/delegations', () => {
  const actual = jest.requireActual('@/lib/api/delegations') as typeof import('@/lib/api/delegations')
  return {
    ...actual,
    resolveDelegationTokenUser: (...args: unknown[]) => mockResolveDelegationTokenUser(...args),
    remintExpiredMessagesDelegation: (...args: unknown[]) => mockRemintExpiredMessagesDelegation(...args),
  }
})

jest.mock('@/lib/api/auth', () => {
  const actual = jest.requireActual('@/lib/api/auth') as typeof import('@/lib/api/auth')
  return {
    ...actual,
    resolveUser: (...args: unknown[]) => mockResolveUser(...args),
  }
})

function req(token: string) {
  return new NextRequest('http://localhost/api/v1/agent/email/messages?orgId=org-1&uid=staff-1', {
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
  })
}

describe('mailbox request auth remint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AI_API_KEY = 'legacy-god-key'
    mockResolveUser.mockResolvedValue({ uid: 'ai-agent', role: 'ai', authKind: 'legacy_ai_key' })
  })

  it('remints an expired dlg token once and returns the acting staff user', async () => {
    mockResolveDelegationTokenUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        uid: 'staff-1',
        role: 'admin',
        authKind: 'user_delegation',
        actingForUserId: 'staff-1',
        agentId: 'pip',
        orgId: 'org-1',
        activeOrgId: 'org-1',
        orgIds: ['org-1'],
      })
    mockRemintExpiredMessagesDelegation.mockResolvedValue({
      id: 'dlg-new',
      token: 'pib_dlg_new',
      expiresAt: '2099-01-01T00:00:00.000Z',
      actingForUserId: 'staff-1',
      agentId: 'pip',
      orgIds: ['org-1'],
      scopes: [],
    })

    const { resolveMailboxRequestUser } = await import('@/lib/mailbox/mailboxAuth')
    const user = await resolveMailboxRequestUser(req('pib_dlg_expired'))

    expect(mockRemintExpiredMessagesDelegation).toHaveBeenCalledTimes(1)
    expect(mockRemintExpiredMessagesDelegation).toHaveBeenCalledWith('pib_dlg_expired')
    expect(user).toEqual(expect.objectContaining({
      uid: 'staff-1',
      authKind: 'user_delegation',
    }))
    expect(mockResolveUser).not.toHaveBeenCalled()
  })

  it('does not fall back to AI_API_KEY when remint fails for a dlg bearer', async () => {
    mockResolveDelegationTokenUser.mockResolvedValue(null)
    mockRemintExpiredMessagesDelegation.mockResolvedValue(null)

    const { resolveMailboxRequestUser } = await import('@/lib/mailbox/mailboxAuth')
    const user = await resolveMailboxRequestUser(req('pib_dlg_expired'))

    expect(user).toBeNull()
    expect(mockResolveUser).not.toHaveBeenCalled()
  })
})
