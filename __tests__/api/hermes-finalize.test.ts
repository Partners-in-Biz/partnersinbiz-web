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

let mockUser: MockUser = { uid: 'u1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/hermes/server', () => ({
  requireHermesProfileAccess: (...args: unknown[]) => mockRequireAccess(...args),
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
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
const baseConv = { id: 'conv1', orgId: 'org1', participantUids: ['u1'] }

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
  mockMessagesDoc.mockResolvedValue({ exists: true, data: () => ({}) })
  mockUpdateMessage.mockResolvedValue(undefined)
  mockTouchConversation.mockResolvedValue(undefined)
})

describe('finalize route', () => {
  it('saves events to message when run completes', async () => {
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
      expect.objectContaining({ events, status: 'completed' }),
    )
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

  it('marks interrupted Hermes runs as failed with the preserved reason', async () => {
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true },
      data: { status: 'interrupted', error: 'gateway restarted while run was active' },
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
        content: 'gateway restarted while run was active',
        status: 'failed',
        error: 'gateway restarted while run was active',
        runId: 'run-1',
        events: [{ event: 'run.interrupted', timestamp: 1000 }],
      }),
    )
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        lastMessagePreview: '[run interrupted] gateway restarted while run was active',
        lastMessageRole: 'assistant',
      }),
    )
  })
})
