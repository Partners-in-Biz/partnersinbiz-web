import { NextRequest } from 'next/server'

const mockSearchContextReferences = jest.fn()
const mockPatchConversationContext = jest.fn()
const mockGetConversation = jest.fn()
const mockConvDoc = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: NextRequest, user: unknown, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, context?: unknown) => handler(req, globalThis.__contextReferenceUser, context),
}))

jest.mock('@/lib/context-references/registry', () => ({
  searchContextReferences: (input: unknown) => mockSearchContextReferences(input),
  patchConversationContextRefs: (input: unknown) => mockPatchConversationContext(input),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (id: string) => mockGetConversation(id),
  convDoc: (id: string) => mockConvDoc(id),
}))

declare global {
  var __contextReferenceUser: unknown
}

beforeEach(() => {
  jest.clearAllMocks()
  globalThis.__contextReferenceUser = {
    uid: 'admin-1',
    role: 'admin',
    authKind: 'session',
  }
  mockSearchContextReferences.mockResolvedValue([
    { type: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch Project', origin: 'mention' },
  ])
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['admin-1'],
    contextRefs: [],
  })
  mockPatchConversationContext.mockResolvedValue([
    { type: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch Project', origin: 'current_page' },
  ])
})

describe('context reference API routes', () => {
  it('searches namespaced context references through the server registry', async () => {
    const { GET } = await import('@/app/api/v1/context-references/search/route')
    const req = new NextRequest('http://localhost/api/v1/context-references/search?orgId=org-1&type=projects&q=launch')

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSearchContextReferences).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project',
      query: 'launch',
      orgId: 'org-1',
      user: expect.objectContaining({ uid: 'admin-1' }),
    }))
    expect(body.data.refs[0]).toMatchObject({ id: 'project-1' })
  })

  it('patches pinned conversation context after verifying participant access', async () => {
    const { PATCH } = await import('@/app/api/v1/conversations/[convId]/context/route')
    const req = new NextRequest('http://localhost/api/v1/conversations/conv-1/context', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'add',
        refs: [{ type: 'project', id: 'project-1', orgId: 'org-1', origin: 'current_page' }],
      }),
    })

    const res = await PATCH(req, { params: Promise.resolve({ convId: 'conv-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockPatchConversationContext).toHaveBeenCalledWith(expect.objectContaining({
      action: 'add',
      convId: 'conv-1',
      orgId: 'org-1',
    }))
    expect(body.data.contextRefs[0]).toMatchObject({ id: 'project-1' })
  })
})
