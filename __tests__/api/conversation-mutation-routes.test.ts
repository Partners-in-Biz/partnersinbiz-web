import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  allowedOrgIds?: string[]
  agentId?: string
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockDeleteConversation = jest.fn()
const mockLogActivity = jest.fn()
const mockMessageGet = jest.fn()
const mockMessageUpdate = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'owner-1', role: 'client', orgId: 'org-1' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  deleteConversation: mockDeleteConversation,
  patchConversation: jest.fn(),
  updateConversationAccess: jest.fn(),
  messagesCollection: jest.fn(() => ({
    doc: jest.fn(() => ({ get: mockMessageGet, update: mockMessageUpdate })),
  })),
}))

jest.mock('@/lib/activity/log', () => ({ logActivity: mockLogActivity }))
jest.mock('@/lib/agents/team', () => ({ callAgentPath: mockCallAgentPath }))
jest.mock('@/lib/organizations/module-policy-access', () => ({
  assertUserCanPerformOrganizationModuleAction: jest.fn(),
}))
jest.mock('@/lib/conversations/participant-access', () => ({
  ConversationParticipantError: class extends Error {},
  resolveHumanConversationParticipants: jest.fn(),
}))

function conversation(shareMode: 'private' | 'shared' | 'org') {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    title: 'Mutation policy',
    startedBy: 'owner-1',
    participantUids: ['owner-1', 'member-1'],
    participantAgentIds: ['pip'],
    participants: [],
    archived: false,
    messageCount: 1,
    workspaceContext: { shareMode, ownerUserId: 'owner-1' },
  }
}

const ctx = { params: Promise.resolve({ convId: 'conv-1', msgId: 'msg-1' }) }

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'owner-1', role: 'client', orgId: 'org-1' }
  mockGetConversation.mockResolvedValue(conversation('private'))
  mockDeleteConversation.mockResolvedValue(undefined)
  mockLogActivity.mockResolvedValue(undefined)
  mockMessageGet.mockResolvedValue({
    exists: true,
    data: () => ({ runId: 'run-1', authorId: 'pip' }),
  })
  mockMessageUpdate.mockResolvedValue(undefined)
  mockCallAgentPath.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    data: {},
  })
})

describe('conversation mutation route policies', () => {
  it('allows the client owner to delete and audits the real client role', async () => {
    const { DELETE } = await import('@/app/api/v1/conversations/[convId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/conversations/conv-1', {
      method: 'DELETE',
    }), ctx)

    expect(response.status).toBe(200)
    expect(mockDeleteConversation).toHaveBeenCalledWith('conv-1')
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'owner-1',
      actorRole: 'client',
    }))
  })

  it('allows an explicit client participant to stop a run with actor-neutral status text', async () => {
    mockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }
    mockGetConversation.mockResolvedValue(conversation('shared'))
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/[msgId]/stop/route')
    const response = await POST(new NextRequest(
      'http://localhost/api/v1/conversations/conv-1/messages/msg-1/stop',
      { method: 'POST' },
    ), ctx)

    expect(response.status).toBe(200)
    expect(mockCallAgentPath).toHaveBeenCalled()
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Agent run stopped by an authorised conversation actor',
    }))
  })

  it('denies an org-visible nonparticipant through both mutation routes', async () => {
    mockUser = { uid: 'member-2', role: 'client', orgId: 'org-1' }
    mockGetConversation.mockResolvedValue(conversation('org'))
    const [{ DELETE }, { POST }] = await Promise.all([
      import('@/app/api/v1/conversations/[convId]/route'),
      import('@/app/api/v1/conversations/[convId]/messages/[msgId]/stop/route'),
    ])

    const deleteResponse = await DELETE(new NextRequest('http://localhost/api/v1/conversations/conv-1', {
      method: 'DELETE',
    }), ctx)
    const stopResponse = await POST(new NextRequest(
      'http://localhost/api/v1/conversations/conv-1/messages/msg-1/stop',
      { method: 'POST' },
    ), ctx)

    expect(deleteResponse.status).toBe(403)
    expect(stopResponse.status).toBe(403)
    expect(mockDeleteConversation).not.toHaveBeenCalled()
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })
})
