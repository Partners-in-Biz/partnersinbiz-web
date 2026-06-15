import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai' }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCallAgentPath = jest.fn()
let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: (...args: unknown[]) => mockCallAgentPath(...args),
}))

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
})

describe('POST /api/v1/admin/agents/[agentId]/runs/[runId]/actions', () => {
  it('forwards generic rich-message actions to the Hermes run action endpoint', async () => {
    mockCallAgentPath.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { run_id: 'run-1', accepted: true },
    })

    const { POST } = await import('@/app/api/v1/admin/agents/[agentId]/runs/[runId]/actions/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/agents/pip/runs/run-1/actions', {
        method: 'POST',
        body: JSON.stringify({
          actionId: 'clarify-tone',
          type: 'choose',
          value: 'Direct',
          payload: { question: 'Which tone should I use?' },
        }),
      }),
      { params: Promise.resolve({ agentId: 'pip', runId: 'run-1' }) },
    )

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ run_id: 'run-1', accepted: true })
    expect(mockCallAgentPath).toHaveBeenCalledWith(
      'pip',
      '/v1/runs/run-1/actions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_id: 'clarify-tone',
          type: 'choose',
          value: 'Direct',
          payload: { question: 'Which tone should I use?' },
        }),
      }),
    )
  })

  it('keeps approval choices on the existing approval endpoint', async () => {
    mockCallAgentPath.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { run_id: 'run-1', choice: 'once', resolved: 1 },
    })

    const { POST } = await import('@/app/api/v1/admin/agents/[agentId]/runs/[runId]/actions/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/agents/pip/runs/run-1/actions', {
        method: 'POST',
        body: JSON.stringify({
          actionId: 'approve-once',
          type: 'approve',
          value: 'once',
        }),
      }),
      { params: Promise.resolve({ agentId: 'pip', runId: 'run-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockCallAgentPath).toHaveBeenCalledWith(
      'pip',
      '/v1/runs/run-1/approval',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 'once' }),
      }),
    )
  })
})
