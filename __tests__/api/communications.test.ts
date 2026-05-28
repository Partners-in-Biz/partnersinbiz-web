import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth:
    (_role: string, handler: (req: NextRequest, user: Record<string, unknown>) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, { uid: 'admin-1', role: 'admin', orgId: 'org-default' }),
}))

const resolveOrgScopeMock = jest.fn((_: unknown, requestedOrgId: string | null) => {
  if (requestedOrgId === 'blocked-org') return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, orgId: requestedOrgId ?? 'org-default' }
})

jest.mock('@/lib/api/orgScope', () => ({
  resolveOrgScope: (user: unknown, requestedOrgId: string | null) =>
    resolveOrgScopeMock(user, requestedOrgId),
}))

const listConversationsMock = jest.fn()
const createConversationMock = jest.fn()

jest.mock('@/lib/communications/store', () => ({
  listConversations: (...args: unknown[]) => listConversationsMock(...args),
  createConversation: (...args: unknown[]) => createConversationMock(...args),
}))

describe('/api/v1/communications/conversations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    listConversationsMock.mockResolvedValue({ items: [], total: 0 })
    createConversationMock.mockResolvedValue({ id: 'conv-1', orgId: 'org-1', status: 'open' })
  })

  it('lists conversations with tenant-scoped filters', async () => {
    const { GET } = await import('@/app/api/v1/communications/conversations/route')
    const req = new NextRequest(
      'http://localhost/api/v1/communications/conversations?orgId=org-1&status=open&channel=whatsapp&assignee=unassigned&campaignId=campaign-1&limit=25',
    )

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(listConversationsMock).toHaveBeenCalledWith('org-1', {
      status: 'open',
      channel: 'whatsapp',
      assignee: 'unassigned',
      campaignId: 'campaign-1',
      queueId: null,
      priority: null,
      label: null,
      limit: 25,
    })
  })

  it('creates a conversation tied to a contact', async () => {
    const { POST } = await import('@/app/api/v1/communications/conversations/route')
    const req = new NextRequest('http://localhost/api/v1/communications/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        channel: 'whatsapp',
        contactId: 'contact-1',
        body: 'Hi, I need help',
        queueId: 'support',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'conv-1', orgId: 'org-1', status: 'open' })
    expect(createConversationMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        channel: 'whatsapp',
        contactId: 'contact-1',
        body: 'Hi, I need help',
        queueId: 'support',
        createdBy: 'admin-1',
        createdByType: 'user',
      }),
    )
  })

  it('blocks cross-organisation access', async () => {
    const { GET } = await import('@/app/api/v1/communications/conversations/route')
    const req = new NextRequest(
      'http://localhost/api/v1/communications/conversations?orgId=blocked-org',
    )

    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(listConversationsMock).not.toHaveBeenCalled()
  })
})
