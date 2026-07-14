import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockListMessages = jest.fn()
const mockAuthorizeConversationProject = jest.fn()

const mockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (
    req: NextRequest,
    context?: unknown,
  ) => handler(req, mockUser, context),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  listMessages: mockListMessages,
}))

jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: jest.fn(() => true),
  authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
  publicConversationMessageView: (message: unknown) => message,
}))

const conversation = {
  id: 'conv-1',
  orgId: 'org-1',
  startedBy: 'owner-1',
  participantUids: ['member-1'],
  participantAgentIds: ['pip'],
  participants: [],
  archived: false,
  messageCount: 1,
  scope: 'project',
  scopeRefId: 'project-1',
}

const context = { params: Promise.resolve({ convId: 'conv-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetConversation.mockResolvedValue(conversation)
  mockListMessages.mockResolvedValue([{ id: 'message-1', content: 'secret project history' }])
  mockAuthorizeConversationProject.mockResolvedValue({
    ok: false,
    status: 403,
    error: 'Project is outside this organisation',
  })
})

describe.each([
  ['chat-feed', () => import('@/app/api/v1/chat-feed/[convId]/route')],
  ['thread-data', () => import('@/app/api/v1/thread-data/[convId]/route')],
] as const)('%s conversation message alias', (_name, loadRoute) => {
  it('revalidates durable project access before returning message history', async () => {
    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/v1/conversation-message-alias/conv-1'), context)

    expect(response.status).toBe(403)
    expect(mockAuthorizeConversationProject).toHaveBeenCalledWith(mockUser, conversation)
    expect(mockListMessages).not.toHaveBeenCalled()
  })
})
