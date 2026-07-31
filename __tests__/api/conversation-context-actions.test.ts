import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockCanReplyConversation = jest.fn(() => true)
const mockAuthorizeConversationProject = jest.fn()
const mockResolveContext = jest.fn()
const mockReceiptRows = new Map<string, Record<string, unknown>>()

let mockUser = { uid: 'member-1', role: 'client' as const, orgId: 'org-1' }
type MockHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
}))
jest.mock('@/lib/conversations/access', () => ({
  canReplyConversation: (...args: unknown[]) => mockCanReplyConversation(...args),
  authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
}))
jest.mock('@/lib/chat-context/registry', () => ({
  chatContextRegistry: { resolve: (...args: unknown[]) => mockResolveContext(...args) },
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: jest.fn(async () => ({
          id,
          exists: mockReceiptRows.has(id),
          data: () => mockReceiptRows.get(id),
        })),
        update: jest.fn(async (patch: Record<string, unknown>) => {
          mockReceiptRows.set(id, { ...(mockReceiptRows.get(id) ?? {}), ...patch })
        }),
      }),
    }),
    runTransaction: async (callback: (transaction: {
      get: (ref: { id: string }) => Promise<{ id: string; exists: boolean; data: () => Record<string, unknown> | undefined }>
      create: (ref: { id: string }, value: Record<string, unknown>) => void
    }) => unknown) => callback({
      get: async (ref) => ({
        id: ref.id,
        exists: mockReceiptRows.has(ref.id),
        data: () => mockReceiptRows.get(ref.id),
      }),
      create: (ref, value) => { mockReceiptRows.set(ref.id, value) },
    }),
  },
}))

const action = {
  id: 'retry-render',
  label: 'Retry render',
  href: '/api/v1/video-editor/renders/render-1/retry',
  method: 'POST' as const,
  body: { quality: 'high' },
}
const contextModel = {
  context: { kind: 'studio_artifact', id: 'video_editor:render-1', orgId: 'org-1', label: 'Launch video', icon: 'movie' },
  pulse: { label: 'Rendering', metrics: [] },
  groups: [],
  artifacts: [{
    id: 'video_editor:render-1',
    studioKind: 'video_editor',
    resourceType: 'render',
    resourceId: 'render-1',
    title: 'Launch video',
    artifactKind: 'video',
    state: 'blocked',
    statusLabel: 'Blocked',
    version: 'v1',
    href: '/video-editor/render-1',
    actions: [action],
  }],
  attention: [],
  activity: [],
  capabilities: [],
  asOf: '2026-07-30T12:00:00.000Z',
}
const conversation = {
  id: 'conv-1',
  orgId: 'org-1',
  participants: [],
  participantUids: ['member-1'],
  participantAgentIds: [],
  startedBy: 'member-1',
  title: 'Video work',
  messageCount: 0,
  archived: false,
  contextRefs: [{
    type: 'studio_artifact',
    id: 'video_editor:render-1',
    orgId: 'org-1',
    label: 'Launch video',
    origin: 'manual',
  }],
}

function routeContext() {
  return { params: Promise.resolve({ convId: 'conv-1' }) }
}

function request(overrides: Record<string, unknown> = {}, key = 'chat-action-test-key-123') {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/context-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      context: { kind: 'studio_artifact', id: 'video_editor:render-1' },
      action,
      confirmed: false,
      ...overrides,
    }),
  })
}

describe('conversation context action receipts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReceiptRows.clear()
    mockGetConversation.mockResolvedValue(conversation)
    mockCanReplyConversation.mockReturnValue(true)
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: null })
    mockResolveContext.mockResolvedValue({ ok: true, model: contextModel })
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { runId: 'run-1', href: '/video-editor/render-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as jest.Mock
  })

  it('executes an attached authoritative action and returns durable evidence', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const response = await POST(request(), routeContext())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.receipt).toEqual(expect.objectContaining({
      status: 'succeeded',
      canonicalStatus: 200,
      beforeVersion: 'v1',
      afterVersion: 'v1',
      resultHref: '/video-editor/render-1',
      referenceIds: { runId: 'run-1' },
    }))
    expect(body.data.receipt.idempotencyKey).toBeUndefined()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/v1/video-editor/renders/render-1/retry' }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ quality: 'high' }),
        headers: expect.any(Headers),
      }),
    )
  })

  it('replays the same receipt without dispatching twice', async () => {
    const { GET, POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const first = await POST(request(), routeContext())
    const firstBody = await first.json()
    const second = await POST(request(), routeContext())
    const secondBody = await second.json()
    const readback = await GET(new NextRequest(
      `http://localhost/api/v1/conversations/conv-1/context-actions?receiptId=${firstBody.data.receipt.id}`,
    ), routeContext())
    const readbackBody = await readback.json()

    expect(second.status).toBe(200)
    expect(secondBody.data.receipt.id).toBe(firstBody.data.receipt.id)
    expect(readback.status).toBe(200)
    expect(readbackBody.data.receipt).toEqual(expect.objectContaining({
      id: firstBody.data.receipt.id,
      status: 'succeeded',
    }))
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects action forgery, detached contexts, and members who cannot reply', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const forged = await POST(request({ action: { ...action, href: '/api/v1/admin/users/delete' } }), routeContext())
    expect(forged.status).toBe(409)

    const detached = await POST(request({
      context: { kind: 'studio_artifact', id: 'video_editor:other' },
    }, 'chat-action-detached-123'), routeContext())
    expect(detached.status).toBe(404)

    mockCanReplyConversation.mockReturnValue(false)
    const forbidden = await POST(request({}, 'chat-action-forbidden-123'), routeContext())
    expect(forbidden.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation for approval-gated actions', async () => {
    const gatedAction = { ...action, requiresApproval: true }
    mockResolveContext.mockResolvedValue({
      ok: true,
      model: {
        ...contextModel,
        artifacts: [{ ...contextModel.artifacts[0], actions: [gatedAction] }],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const response = await POST(request({ action: gatedAction }), routeContext())
    expect(response.status).toBe(428)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails closed for a cross-tenant authoritative model', async () => {
    mockResolveContext.mockResolvedValue({
      ok: true,
      model: {
        ...contextModel,
        context: { ...contextModel.context, orgId: 'org-2' },
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const response = await POST(request({}, 'chat-action-cross-tenant-123'), routeContext())
    expect(response.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('matches colliding task ids to the attached project metadata', async () => {
    const taskAction = { ...action, href: '/api/v1/projects/project-2/tasks/shared-task/complete' }
    mockGetConversation.mockResolvedValue({
      ...conversation,
      contextRefs: [
        { type: 'task', id: 'shared-task', orgId: 'org-1', label: 'Project one task', origin: 'manual', metadata: { projectId: 'project-1' } },
        { type: 'task', id: 'shared-task', orgId: 'org-1', label: 'Project two task', origin: 'manual', metadata: { projectId: 'project-2' } },
      ],
    })
    mockResolveContext.mockResolvedValue({
      ok: true,
      model: {
        ...contextModel,
        context: { kind: 'task', id: 'shared-task', orgId: 'org-1', label: 'Project two task', icon: 'task_alt' },
        artifacts: [{ ...contextModel.artifacts[0], actions: [taskAction] }],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/context-actions/route')
    const response = await POST(request({
      context: { kind: 'task', id: 'shared-task', projectId: 'project-2' },
      action: taskAction,
    }, 'chat-action-task-project-123'), routeContext())

    expect(response.status).toBe(200)
    expect(mockResolveContext).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'task',
      id: 'shared-task',
      projectId: 'project-2',
      contextReference: expect.objectContaining({ label: 'Project two task' }),
    }))
  })
})
