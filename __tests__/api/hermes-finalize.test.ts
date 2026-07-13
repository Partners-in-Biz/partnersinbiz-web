import { NextRequest } from 'next/server'
import type { ChatEvent } from '@/lib/hermes/types'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCallHermesJson = jest.fn()
const mockRequireAccess = jest.fn()
const mockGetConversation = jest.fn()
const mockMessagesDoc = jest.fn()
const mockUpdateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockRunQueryGet = jest.fn()

let mockUser: MockUser = { uid: 'u1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/hermes/server', () => ({
  HERMES_RUNS_COLLECTION: 'hermes_runs',
  requireHermesProfileAccess: (...args: unknown[]) => mockRequireAccess(...args),
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({ limit: () => ({ get: mockRunQueryGet }) }),
    }),
  },
}))

jest.mock('@/lib/hermes/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  messagesCollection: () => ({ doc: () => ({ get: mockMessagesDoc }) }),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
}))

jest.mock('@/lib/api/response', () => ({
  apiError: (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  apiSuccess: (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200 }),
}))

const baseLink = { orgId: 'org1', profile: 'p1', baseUrl: 'http://vps', enabled: true }
const baseConv = { id: 'conv1', orgId: 'org1', profile: 'p1', participantUids: ['u1'] }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org1/conversations/conv1/messages/msg1/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'u1', role: 'admin' }
  mockRequireAccess.mockResolvedValue({ link: baseLink })
  mockGetConversation.mockResolvedValue(baseConv)
  mockMessagesDoc.mockResolvedValue({ exists: true, data: () => ({ role: 'assistant', runId: 'run-1' }) })
  mockRunQueryGet.mockResolvedValue({
    docs: [{ data: () => ({ orgId: 'org1', profile: 'p1', conversationId: 'conv1', messageId: 'msg1' }) }],
  })
  mockUpdateMessage.mockResolvedValue(undefined)
  mockTouchConversation.mockResolvedValue(undefined)
})

describe('finalize route', () => {
  it('ignores client events when a bound run completes', async () => {
    const events: ChatEvent[] = [
      { event: 'tool.call', tool: 'list_tasks', preview: '12 results', timestamp: 1000 },
    ]
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'completed', output: 'Done!' },
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const res = await POST(
      makeRequest({ runId: 'run-1', events }),
      { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) },
    )
    const body = await res.json()

    expect(body.data.status).toBe('completed')
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1', 'msg1',
      expect.objectContaining({ status: 'completed', runId: 'run-1' }),
    )
    expect(mockUpdateMessage.mock.calls[0][2]).not.toHaveProperty('events')
  })

  it('returns waitingForApproval when Hermes status is waiting_for_approval', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'waiting_for_approval' },
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const res = await POST(
      makeRequest({ runId: 'run-1' }),
      { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) },
    )
    const body = await res.json()

    expect(body.data.pending).toBe(false)
    expect(body.data.waitingForApproval).toBe(true)
    expect(mockUpdateMessage).not.toHaveBeenCalled()
  })

  it('rejects messages, run ids, and run-ledger records that are not exactly bound', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const params = { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) }

    mockMessagesDoc.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'user', runId: 'run-1' }) })
    expect((await POST(makeRequest({ runId: 'run-1' }), params)).status).toBe(409)

    mockMessagesDoc.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'assistant', runId: 'run-1' }) })
    expect((await POST(makeRequest({ runId: 'other-run' }), params)).status).toBe(409)

    mockMessagesDoc.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'assistant', runId: 'run-1' }) })
    mockRunQueryGet.mockResolvedValueOnce({
      docs: [{ data: () => ({ orgId: 'other-org', profile: 'p1', conversationId: 'conv1', messageId: 'msg1' }) }],
    })
    expect((await POST(makeRequest({ runId: 'run-1' }), params)).status).toBe(409)
    expect(mockCallHermesJson).not.toHaveBeenCalled()
  })

  it('marks missing Hermes runs as interrupted instead of returning a transient upstream error', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: false, status: 404 },
      data: { detail: 'run not found' },
    })
    mockMessagesDoc.mockResolvedValue({ exists: true, data: () => ({ role: 'assistant', runId: 'run-missing' }) })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const res = await POST(
      makeRequest({ runId: 'run-missing', events: [{ event: 'assistant.text_delta', delta: 'partial', timestamp: 1000 }] }),
      { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('interrupted')
    expect(body.data.error).toContain('gateway lost this run')
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1', 'msg1',
      expect.objectContaining({
        status: 'failed',
        runId: 'run-missing',
        error: expect.stringContaining('gateway lost this run'),
      }),
    )
  })

  it('returns pending:true for other in-progress statuses', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'running' },
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const res = await POST(
      makeRequest({ runId: 'run-1' }),
      { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) },
    )
    const body = await res.json()

    expect(body.data.pending).toBe(true)
    expect(mockUpdateMessage).not.toHaveBeenCalled()
  })

  it('marks interrupted Hermes runs as failed with a stable safe reason', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'interrupted', error: 'POST https://gateway.example apiKey=super-secret /Users/peet/private' },
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/[msgId]/finalize/route'
    )
    const res = await POST(
      makeRequest({ runId: 'run-1', events: [{ event: 'run.interrupted', timestamp: 1000 }] }),
      { params: Promise.resolve({ orgId: 'org1', convId: 'conv1', msgId: 'msg1' }) },
    )
    const body = await res.json()

    expect(body.data.status).toBe('interrupted')
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1', 'msg1',
      expect.objectContaining({
        content: 'The agent run was interrupted before completion.',
        status: 'failed',
        error: 'The agent run was interrupted before completion.',
        runId: 'run-1',
      }),
    )
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        lastMessagePreview: '[run interrupted] The agent run was interrupted before completion.',
        lastMessageRole: 'assistant',
      }),
    )
    expect(JSON.stringify(body) + JSON.stringify(mockUpdateMessage.mock.calls)).not.toMatch(/super-secret|gateway\.example|Users\/peet/)
  })
})
