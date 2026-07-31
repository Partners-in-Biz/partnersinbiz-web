import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockCreateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockCanAccessConversation = jest.fn()
const mockCanReplyConversation = jest.fn()
const mockAuthorizeConversationProject = jest.fn()
const mockSpawnObservableDelegations = jest.fn()
const mockAttachDelegationBranchMessage = jest.fn()
const mockObserveDelegation = jest.fn()
const mockListDelegations = jest.fn()
const mockFinalizeDelegationChildRun = jest.fn()

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
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
}))

jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: (...args: unknown[]) => mockCanAccessConversation(...args),
  canReplyConversation: (...args: unknown[]) => mockCanReplyConversation(...args),
  authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
  publicConversationMessageView: (message: unknown) => message,
}))

jest.mock('@/lib/hermes-features/service', () => ({
  hermesFeaturesService: {
    spawnObservableDelegations: (...args: unknown[]) => mockSpawnObservableDelegations(...args),
    attachDelegationBranchMessage: (...args: unknown[]) => mockAttachDelegationBranchMessage(...args),
    observeDelegation: (...args: unknown[]) => mockObserveDelegation(...args),
    repository: {
      listDelegations: (...args: unknown[]) => mockListDelegations(...args),
    },
  },
}))

jest.mock('@/lib/conversations/delegation-finalizer', () => ({
  finalizeDelegationChildRun: (...args: unknown[]) => mockFinalizeDelegationChildRun(...args),
}))

describe('conversation delegations API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanAccessConversation.mockReturnValue(true)
    mockCanReplyConversation.mockReturnValue(true)
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: null })
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'org-1' })
  })

  it('POST spawn creates branch message and attaches branchMessageId', async () => {
    mockSpawnObservableDelegations.mockResolvedValue({
      id: 'del_1',
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
      parentRunHint: 'messages:conv-1',
      maxConcurrent: 3,
      children: [{ id: 'child_1', goal: 'g', status: 'running', agentId: 'maya', runId: 'run-1' }],
      createdAt: 't',
      updatedAt: 't',
    })
    mockCreateMessage.mockResolvedValue({
      id: 'branch-msg-1',
      conversationId: 'conv-1',
      role: 'system',
      content: 'Subagent branch opened',
      richParts: [{ type: 'agent_delegation_branch', status: 'running' }],
      authorKind: 'system',
      authorId: 'system',
      authorDisplayName: 'Delegation',
    })
    mockAttachDelegationBranchMessage.mockResolvedValue({
      id: 'del_1',
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-1',
      parentRunHint: 'messages:conv-1',
      maxConcurrent: 3,
      children: [{ id: 'child_1', goal: 'g', status: 'running', agentId: 'maya', runId: 'run-1' }],
      createdAt: 't',
      updatedAt: 't',
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/delegations/route')
    const res = await POST(new NextRequest('http://test.local/api/v1/conversations/conv-1/delegations?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({
        action: 'spawn',
        agentIds: ['maya'],
        messageContent: 'Please handle social @agent:maya',
        parentAgentId: 'pip',
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockSpawnObservableDelegations).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      conversationId: 'conv-1',
      agentId: 'pip',
      goals: expect.arrayContaining([expect.objectContaining({ agentId: 'maya' })]),
    }))
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'system',
      richParts: expect.any(Array),
    }))
    expect(mockAttachDelegationBranchMessage).toHaveBeenCalledWith('org-1', 'del_1', 'branch-msg-1')
    expect(body.data.delegation.branchMessageId).toBe('branch-msg-1')
    expect(body.data.branch.status).toBe('running')
  })

  it('POST complete drives finalizeDelegationChildRun (real completion entry)', async () => {
    mockFinalizeDelegationChildRun.mockResolvedValue({
      status: 'completed',
      orgId: 'org-1',
      delegationId: 'del_1',
      childId: 'child_1',
      summaryMessageId: 'sum-1',
      summaryMessage: {
        id: 'sum-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: '@maya finished their branch\n\nDone.',
        authorKind: 'agent',
        authorId: 'maya',
        authorDisplayName: 'maya',
        status: 'completed',
      },
      record: {
        id: 'del_1',
        orgId: 'org-1',
        agentId: 'pip',
        conversationId: 'conv-1',
        branchMessageId: 'branch-msg-1',
        parentRunHint: 'p',
        maxConcurrent: 1,
        children: [{ id: 'child_1', goal: 'g', status: 'done', agentId: 'maya', result: 'Done.' }],
        createdAt: 't',
        updatedAt: 't',
      },
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/delegations/route')
    const res = await POST(new NextRequest('http://test.local/api/v1/conversations/conv-1/delegations?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({
        action: 'complete',
        delegationId: 'del_1',
        childId: 'child_1',
        result: 'Done.',
        ok: true,
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockFinalizeDelegationChildRun).toHaveBeenCalledWith({
      orgId: 'org-1',
      delegationId: 'del_1',
      childId: 'child_1',
      result: 'Done.',
      ok: true,
      conversationId: 'conv-1',
      runId: undefined,
    })
    expect(body.data.branch.status).toBe('done')
    expect(body.data.summaryMessage.content).toContain('@maya finished')
    expect(body.data.finalize.status).toBe('completed')
  })

  it('GET observes a single delegation branch', async () => {
    mockObserveDelegation.mockResolvedValue({
      id: 'del_1',
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
      parentRunHint: 'p',
      maxConcurrent: 1,
      children: [{ id: 'child_1', goal: 'g', status: 'running', agentId: 'maya' }],
      createdAt: 't',
      updatedAt: 't',
    })

    const { GET } = await import('@/app/api/v1/conversations/[convId]/delegations/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/conversations/conv-1/delegations?orgId=org-1&id=del_1'), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.branch.status).toBe('running')
    expect(body.data.delegation.id).toBe('del_1')
  })
})
