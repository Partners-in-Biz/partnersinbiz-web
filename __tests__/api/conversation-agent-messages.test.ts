import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  agentId?: string
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockCreateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockCreateHermesRun = jest.fn()

let mockUser: MockUser = { uid: 'agent:qa-release', role: 'ai', agentId: 'qa-release' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  createMessage: mockCreateMessage,
  touchConversation: mockTouchConversation,
}))

jest.mock('@/lib/hermes/server', () => ({
  createHermesRun: mockCreateHermesRun,
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'agent:qa-release', role: 'ai', agentId: 'qa-release' }
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'pib-platform-owner',
    participantUids: ['admin-1'],
    participantAgentIds: ['pip', 'qa-release'],
    participants: [
      { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Peet' },
      { kind: 'agent', agentId: 'pip', name: 'Pip' },
      { kind: 'agent', agentId: 'qa-release', name: 'Quinn' },
    ],
  })
  mockCreateMessage.mockImplementation(async (_convId: string, input: Record<string, unknown>) => ({
    id: 'agent-message-1',
    ...input,
  }))
  mockTouchConversation.mockResolvedValue(undefined)
})

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/agent-messages', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('POST /api/v1/conversations/[convId]/agent-messages', () => {
  it('appends a completed assistant agent message with rich parts without dispatching Hermes', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'qa-release',
      content: 'Quinn QA report is ready.',
      rich_parts: [{
        type: 'approval-card',
        title: 'Chat output quality gate',
        body: 'Agents need a no-dispatch append route.',
        status_label: 'Shipped to development',
        evidence: ['No user-message dispatch should happen.'],
        decisions: [{ label: 'Use dynamic Messages' }],
      }],
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      authorKind: 'agent',
      authorId: 'agent:qa-release',
      authorDisplayName: 'Quinn',
      dispatchAgentId: 'qa-release',
      status: 'completed',
      richParts: [expect.objectContaining({
        type: 'approval_card',
        title: 'Chat output quality gate',
        statusLabel: 'Shipped to development',
      })],
      rich_parts: [expect.objectContaining({ type: 'approval_card' })],
    }))
    expect(mockTouchConversation).toHaveBeenCalledWith('conv-1', 'Quinn QA report is ready.', 'assistant', 'agent-message-1')
    const body = await readJson(res)
    expect(body.data.message.id).toBe('agent-message-1')
  })

  it('normalizes table rows into Firestore-safe objects before appending rich parts', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'qa-release',
      content: 'Structured SEO ledger readback attached.',
      richParts: [{
        type: 'table',
        title: 'SEO sprint ledger after this pass',
        columns: ['Item', 'State', 'Evidence'],
        rows: [
          ['Metric pull task', 'Done', 'kPy9r23lXeA3dDguu3gI'],
          ['Bing', 'Blocked', 'slDXFmpzWt8dc3DCDcti'],
        ],
      }],
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      richParts: [expect.objectContaining({
        type: 'table',
        columns: ['Item', 'State', 'Evidence'],
        rows: [
          { Item: 'Metric pull task', State: 'Done', Evidence: 'kPy9r23lXeA3dDguu3gI' },
          { Item: 'Bing', State: 'Blocked', Evidence: 'slDXFmpzWt8dc3DCDcti' },
        ],
      })],
    }))
  })

  it('accepts parts as an agent-friendly alias for rich parts', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'qa-release',
      content: 'CEO operating readback attached.',
      parts: [{
        type: 'approval-card',
        title: 'Dynamic chat output',
        body: 'Agent updates should render as structured cards even when the payload uses parts.',
        status_label: 'Verified',
      }],
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      richParts: [expect.objectContaining({
        type: 'approval_card',
        title: 'Dynamic chat output',
        statusLabel: 'Verified',
      })],
      rich_parts: [expect.objectContaining({ type: 'approval_card' })],
    }))
  })

  it('preserves run id and ui actions for executable completed agent outputs', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'qa-release',
      content: 'Approval action is attached.',
      runId: 'run_action_123',
      ui_actions: [{
        id: 'approve-once',
        action_id: 'approval-1',
        type: 'approve',
        label: 'Allow once',
        value: 'once',
        endpoint: '/api/v1/admin/agents/qa-release/runs/run_action_123/actions',
      }],
      richParts: [{
        type: 'approval_card',
        title: 'Executable approval',
        body: 'This card has a matching action.',
      }],
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      runId: 'run_action_123',
      uiActions: [expect.objectContaining({
        id: 'approve-once',
        actionId: 'approval-1',
        type: 'approve',
        label: 'Allow once',
        value: 'once',
        endpoint: '/api/v1/admin/agents/qa-release/runs/run_action_123/actions',
      })],
    }))
  })

  it('rejects client callers even if the auth wrapper is misconfigured', async () => {
    mockUser = { uid: 'client-1', role: 'client' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({ agentId: 'qa-release', content: 'Nope' }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('does not let an agent append as another non-Pip agent', async () => {
    mockUser = { uid: 'agent:qa-release', role: 'ai', agentId: 'qa-release' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({ agentId: 'maya', content: 'Wrong agent.' }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('lets Pip relay completed output for a non-participant specialist agent', async () => {
    mockUser = { uid: 'agent:pip', role: 'ai', agentId: 'pip' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'data',
      content: 'Pip relay: Vera/Data analysis is ready.',
      richParts: [{
        type: 'status',
        title: 'Vera/Data relay',
        status: 'completed',
        body: 'Vera completed the stored-data analysis and Pip is relaying it to the CEO thread.',
      }],
    }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      authorId: 'agent:data',
      dispatchAgentId: 'data',
      authorDisplayName: 'data',
      status: 'completed',
    }))
  })

  it('lets admins relay completed output for a non-participant specialist agent', async () => {
    mockUser = { uid: 'admin-1', role: 'admin' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({
      agentId: 'data',
      content: 'Admin relay: Vera/Data analysis is ready.',
      richParts: [{
        type: 'status',
        title: 'Admin specialist relay',
        status: 'completed',
      }],
    }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      authorId: 'agent:data',
      dispatchAgentId: 'data',
      status: 'completed',
    }))
  })

  it('rejects agents that are not conversation participants unless the author is Pip', async () => {
    mockUser = { uid: 'ai-agent', role: 'ai' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/agent-messages/route')

    const res = await POST(request({ agentId: 'maya', content: 'Not in this conversation.' }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })
})
