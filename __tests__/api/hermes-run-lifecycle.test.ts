import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()
const mockAdd = jest.fn()

let mockUser: MockUser = { uid: 'super-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }
  mockDoc.mockReturnValue({ get: mockGet, set: mockSet })
  mockSet.mockResolvedValue(undefined)
  mockAdd.mockResolvedValue({ id: 'stored-run-1' })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'hermes_profile_links') return { doc: mockDoc }
    if (name === 'hermes_runs') return { add: mockAdd }
    throw new Error(`Unexpected collection: ${name}`)
  })
  global.fetch = jest.fn()
})

afterEach(() => {
  jest.restoreAllMocks()
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

function profileDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      profile: 'client-a',
      baseUrl: 'http://127.0.0.1:8651/',
      apiKey: 'secret-key',
      enabled: true,
      capabilities: { runs: true, dashboard: true, cron: true, models: true, tools: true, files: true, terminal: true },
      permissions: { superAdmin: true, restrictedAdmin: true, client: false, allowedUserIds: [] },
      ...overrides,
    }),
  }
}

describe('GET /api/v1/admin/hermes/profiles/[orgId]/runs/[runId]', () => {
  it('stores unified-chat metadata on newly created Hermes run ledger rows', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ run_id: 'run-1', status: 'started' }),
    })

    const { createHermesRun } = await import('@/lib/hermes/server')
    const result = await createHermesRun({
      orgId: 'org-a',
      profile: 'pip',
      baseUrl: 'http://127.0.0.1:8651',
      apiKey: 'secret-key',
      enabled: true,
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: false, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    }, 'user-1', {
      prompt: 'Hello',
      conversation_id: 'conv-1',
      metadata: {
        source: 'pib-unified-chat',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        dispatchAgentId: 'pip',
      },
    })

    expect(result.runDocId).toBe('stored-run-1')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      hermesRunId: 'run-1',
      status: 'started',
      conversationId: 'conv-1',
      metadata: expect.objectContaining({
        source: 'pib-unified-chat',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        dispatchAgentId: 'pip',
      }),
    }))
  })

  it('proxies run status from Hermes', async () => {
    mockGet.mockResolvedValue(profileDoc())
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ run_id: 'run-1', status: 'running', output: 'Working...' }),
    })

    const { GET } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1'),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ run_id: 'run-1', status: 'running' })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8651/v1/runs/run-1',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': 'Bearer secret-key' }) })
    )
  })

  it('rejects clients without permission', async () => {
    // Set up a client user that passes org check but fails Hermes permission (client: false)
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-a', allowedOrgIds: ['org-a'] }
    mockGet.mockResolvedValue(profileDoc())
    const { GET } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1'),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/approval', () => {
  it('proxies approval resolution to Hermes', async () => {
    mockGet.mockResolvedValue(profileDoc())
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ object: 'hermes.run.approval_response', run_id: 'run-1', choice: 'once', resolved: 1 }),
    })

    const { POST } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/approval/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1/approval', {
        method: 'POST',
        body: JSON.stringify({ choice: 'once' }),
      }),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ choice: 'once', resolved: 1 })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8651/v1/runs/run-1/approval',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ choice: 'once' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'Authorization': 'Bearer secret-key' }),
      }),
    )
  })

  it('returns 400 for invalid choice', async () => {
    mockGet.mockResolvedValue(profileDoc())
    const { POST } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/approval/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1/approval', {
        method: 'POST',
        body: JSON.stringify({ choice: 'maybe' }),
      }),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/stop', () => {
  it('proxies stop to Hermes', async () => {
    mockGet.mockResolvedValue(profileDoc())
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ run_id: 'run-1', status: 'stopping' }),
    })

    const { POST } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/stop/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1/stop', { method: 'POST' }),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ status: 'stopping' })
  })
})

describe('GET /api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/events', () => {
  it('returns an SSE stream proxied from Hermes', async () => {
    mockGet.mockResolvedValue(profileDoc())
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {\"event\":\"tool.started\",\"tool\":\"terminal\"}\\n\\n'))
        controller.close()
      },
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    })

    const { GET } = await import('../../app/api/v1/admin/hermes/profiles/[orgId]/runs/[runId]/events/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs/run-1/events'),
      { params: Promise.resolve({ orgId: 'org-a', runId: 'run-1' }) }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
  })
})
