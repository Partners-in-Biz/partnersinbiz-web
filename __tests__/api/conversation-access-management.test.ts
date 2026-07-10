import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockPatchConversation = jest.fn()
const mockResolveHumans = jest.fn()
const mockCanAccess = jest.fn(() => true)
const mockLogActivity = jest.fn()

let mockUser = { uid: 'owner-1', role: 'client' as 'client' | 'admin' | 'ai', orgId: 'org-1' }

type MockHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (req: NextRequest, context?: unknown) =>
    handler(req, mockUser, context),
}))
jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  patchConversation: mockPatchConversation,
  deleteConversation: jest.fn(),
}))
jest.mock('@/lib/conversations/access', () => ({ canAccessConversation: mockCanAccess }))
jest.mock('@/lib/conversations/participant-access', () => {
  class ConversationParticipantError extends Error {
    constructor(message: string, readonly status = 400) { super(message) }
  }
  return {
    ConversationParticipantError,
    resolveHumanConversationParticipants: mockResolveHumans,
  }
})
jest.mock('@/lib/organizations/module-policy-access', () => ({
  assertUserCanPerformOrganizationModuleAction: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: jest.fn(() => true) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: mockLogActivity }))

const baseConversation = {
  id: 'conv-1',
  orgId: 'org-1',
  startedBy: 'owner-1',
  title: 'Workspace planning',
  participants: [
    { kind: 'user' as const, uid: 'owner-1', role: 'client' as const, displayName: 'Owner' },
    { kind: 'user' as const, uid: 'member-2', role: 'client' as const, displayName: 'Member' },
    { kind: 'agent' as const, agentId: 'pip', name: 'Pip' },
  ],
  participantUids: ['owner-1', 'member-2'],
  participantAgentIds: ['pip'],
  messageCount: 0,
  archived: false,
  workspaceContext: {
    workspaceId: 'acme',
    orgId: 'org-1',
    orgName: 'Acme',
    orgSlug: 'acme',
    agentDomain: 'acme',
    vpsPath: '/var/lib/hermes/Cowork/Acme',
    localPath: '~/Cowork/Acme',
    sourceOfTruth: 'vps' as const,
    syncMode: 'hybrid',
    defaultRuntimeTarget: 'vps',
    runtimeTarget: 'vps',
    ownerUserId: 'owner-1',
    shareMode: 'shared' as const,
  },
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function context() {
  return { params: Promise.resolve({ convId: 'conv-1' }) }
}

describe('PATCH conversation Workspace access', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { uid: 'owner-1', role: 'client', orgId: 'org-1' }
    mockGetConversation.mockResolvedValue(baseConversation)
    mockPatchConversation.mockResolvedValue(undefined)
    mockLogActivity.mockResolvedValue(undefined)
    mockResolveHumans.mockImplementation(async ({ requestedUids }: { requestedUids: string[] }) =>
      requestedUids.map((uid) => ({ kind: 'user', uid, role: 'client' })),
    )
    mockGetConversation
      .mockResolvedValueOnce(baseConversation)
      .mockResolvedValue(baseConversation)
  })

  it('lets the owner make a Workspace conversation private and retains agents', async () => {
    const { PATCH } = await import('@/app/api/v1/conversations/[convId]/route')
    const response = await PATCH(request({ shareMode: 'private', participantUids: ['owner-1', 'member-2'] }), context())

    expect(response.status).toBe(200)
    expect(mockResolveHumans).toHaveBeenCalledWith(expect.objectContaining({ requestedUids: ['owner-1'] }))
    expect(mockPatchConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      participantUids: ['owner-1'],
      participants: expect.arrayContaining([expect.objectContaining({ kind: 'agent', agentId: 'pip' })]),
      workspaceContext: expect.objectContaining({ shareMode: 'private' }),
    }))
  })

  it('lets a platform admin manage access even when they did not start the conversation', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
    mockResolveHumans.mockResolvedValue([
      { kind: 'user', uid: 'owner-1', role: 'client' },
      { kind: 'user', uid: 'member-2', role: 'client' },
    ])
    const { PATCH } = await import('@/app/api/v1/conversations/[convId]/route')
    const response = await PATCH(request({ shareMode: 'org', participantUids: ['member-2'] }), context())

    expect(response.status).toBe(200)
    expect(mockPatchConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      workspaceContext: expect.objectContaining({ shareMode: 'org' }),
    }))
  })

  it('rejects access changes from a participant who is not the owner', async () => {
    mockUser = { uid: 'member-2', role: 'client', orgId: 'org-1' }
    const { PATCH } = await import('@/app/api/v1/conversations/[convId]/route')
    const response = await PATCH(request({ shareMode: 'org' }), context())

    expect(response.status).toBe(403)
    expect(mockPatchConversation).not.toHaveBeenCalled()
  })

  it('does not permit selected-people mode with only the owner', async () => {
    mockResolveHumans.mockResolvedValue([{ kind: 'user', uid: 'owner-1', role: 'client' }])
    const { PATCH } = await import('@/app/api/v1/conversations/[convId]/route')
    const response = await PATCH(request({ shareMode: 'shared', participantUids: [] }), context())

    expect(response.status).toBe(400)
    expect(mockPatchConversation).not.toHaveBeenCalled()
  })
})
