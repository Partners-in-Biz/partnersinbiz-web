import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockListConversationPresence = jest.fn()
const mockHeartbeatConversationPresence = jest.fn()
const mockCanAccessConversation = jest.fn()
const mockAuthorizeConversationProject = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, {
      uid: 'member-1',
      role: 'client',
      authKind: 'session',
      orgId: 'org-1',
      orgIds: ['org-1'],
    }, context),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
}))

jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: (...args: unknown[]) => mockCanAccessConversation(...args),
  authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
}))

jest.mock('@/lib/conversations/presence', () => ({
  listConversationPresence: (...args: unknown[]) => mockListConversationPresence(...args),
  heartbeatConversationPresence: (...args: unknown[]) => mockHeartbeatConversationPresence(...args),
}))

describe('conversation presence API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanAccessConversation.mockReturnValue(true)
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: null })
  })

  it('lists active presence for conversation participants', async () => {
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'org-1' })
    mockListConversationPresence.mockResolvedValue([{ id: 'presence-1', actorUid: 'maya' }])

    const { GET } = await import('@/app/api/v1/conversations/[convId]/presence/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/conversations/conv-1/presence?orgId=org-1'), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })
    const body = await res.json()

    expect(mockGetConversation).toHaveBeenCalledWith('conv-1')
    expect(mockCanAccessConversation).toHaveBeenCalled()
    expect(mockAuthorizeConversationProject).toHaveBeenCalled()
    expect(mockListConversationPresence).toHaveBeenCalledWith('conv-1', 'org-1')
    expect(body.data.presence).toEqual([{ id: 'presence-1', actorUid: 'maya' }])
  })

  it('heartbeats presence when user is allowed', async () => {
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'org-1' })
    mockHeartbeatConversationPresence.mockResolvedValue({ id: 'conv-1_user-1', actorUid: 'user-1' })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/presence/route')
    const res = await POST(new NextRequest('http://test.local/api/v1/conversations/conv-1/presence?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ state: 'typing' }),
    }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })
    const body = await res.json()

    expect(mockHeartbeatConversationPresence).toHaveBeenCalledWith(
      'conv-1',
      'org-1',
      { state: 'typing' },
      { uid: 'member-1', type: 'user' },
    )
    expect(body.data.presence).toEqual([{ id: 'conv-1_user-1', actorUid: 'user-1' }])
  })

  it('requires conversation membership', async () => {
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'org-1' })
    mockCanAccessConversation.mockReturnValue(false)

    const { POST } = await import('@/app/api/v1/conversations/[convId]/presence/route')
    const res = await POST(new NextRequest('http://test.local/api/v1/conversations/conv-1/presence?orgId=org-1', {
      method: 'POST',
    }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
    expect(mockHeartbeatConversationPresence).not.toHaveBeenCalled()
  })

  it('requires org id', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/presence/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/conversations/conv-1/presence'), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('orgId is required')
  })
})
