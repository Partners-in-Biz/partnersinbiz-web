import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCreateHermesRun = jest.fn()
const mockRequireAccess = jest.fn()
const mockGetConversation = jest.fn()
const mockAppendMessage = jest.fn()
const mockUpdateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockListMessages = jest.fn()
const mockOrgDocGet = jest.fn()
const mockProjectDocGet = jest.fn()
const mockTasksGet = jest.fn()

let mockUser: MockUser = { uid: 'u1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/hermes/server', () => ({
  requireHermesProfileAccess: (...args: unknown[]) => mockRequireAccess(...args),
  createHermesRun: (...args: unknown[]) => mockCreateHermesRun(...args),
}))

jest.mock('@/lib/hermes/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  appendMessage: (...args: unknown[]) => mockAppendMessage(...args),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
  listMessages: (...args: unknown[]) => mockListMessages(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get:
          name === 'organizations'
            ? () => mockOrgDocGet(id)
            : () => mockProjectDocGet(id),
        collection: () => ({
          orderBy: () => ({ limit: () => ({ get: () => mockTasksGet() }) }),
        }),
      }),
    }),
  },
}))

jest.mock('@/lib/api/response', () => ({
  apiError: (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  apiSuccess: (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200 }),
}))

const baseLink = { orgId: 'org1', profile: 'pip', baseUrl: 'http://vps', enabled: true }
const baseConv = {
  id: 'conv1',
  orgId: 'org1',
  profile: 'pip',
  participantUids: ['u1'],
  messageCount: 0,
  projectId: undefined as string | undefined,
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost/api/v1/admin/hermes/profiles/org1/conversations/conv1/messages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'u1', role: 'admin' }
  mockRequireAccess.mockResolvedValue({ link: baseLink })
  mockGetConversation.mockResolvedValue({ ...baseConv })
  mockAppendMessage.mockImplementation(async (_convId, msg) => ({ id: 'm1', ...msg }))
  mockTouchConversation.mockResolvedValue(undefined)
  mockListMessages.mockResolvedValue([])
  mockCreateHermesRun.mockResolvedValue({
    ok: true,
    status: 202,
    data: { runId: 'run-1' },
    runDocId: 'rd-1',
    executionReceipt: { requestedRuntimeTargetId: 'legacy-profile', acceptedRuntimeTargetId: 'legacy-profile', requestedAt: '2026-07-12T20:00:00.000Z', acceptedAt: '2026-07-12T20:00:00.001Z', outcome: 'accepted' },
  })
  mockOrgDocGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockProjectDocGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockTasksGet.mockResolvedValue({ docs: [] })
})

describe('messages route — org context injection', () => {
  it('returns only safe accepted-run fields from an arbitrary upstream payload', async () => {
    mockCreateHermesRun.mockResolvedValue({
      ok: true,
      status: 202,
      data: { runId: 'run-1', status: 'started' },
      runDocId: 'rd-1',
      executionReceipt: { requestedRuntimeTargetId: 'vps', acceptedRuntimeTargetId: 'vps', outcome: 'accepted' },
    })
    const { POST } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/route')
    const res = await POST(makeRequest({ content: 'safe' }), { params: Promise.resolve({ orgId: 'org1', convId: 'conv1' }) })
    const serialized = await res.text()
    expect(serialized).toContain('"runId":"run-1"')
    expect(serialized).toContain('"executionReceipt"')
    expect(serialized).not.toMatch(/super-secret|gateway\.example|Users\/peet|working_directory/)
  })

  it('prepends org context block to the first user message', async () => {
    mockOrgDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Loyalty Plus',
        slug: 'loyalty-plus',
        industry: 'Aviation loyalty',
        website: 'https://loyaltyplus.aero',
        description: 'Frequent-flyer programme platform for airlines.',
        brandProfile: {
          tagline: 'Loyalty, simplified.',
          toneOfVoice: 'Confident, expert, never salesy',
          targetAudience: 'Airline programme managers',
          doWords: ['programme', 'member', 'reward'],
          dontWords: ['cheap', 'discount'],
        },
      }),
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/route'
    )
    await POST(makeRequest({ content: 'hello pip' }), {
      params: Promise.resolve({ orgId: 'org1', convId: 'conv1' }),
    })

    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const sentPrompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(sentPrompt).toContain('[Client context')
    expect(sentPrompt).toContain('orgId: org1')
    expect(sentPrompt).toContain('name: Loyalty Plus')
    expect(sentPrompt).toContain('voice: Confident, expert, never salesy')
    expect(sentPrompt).toContain('do-words: programme, member, reward')
    expect(sentPrompt).toContain('dont-words: cheap, discount')
    expect(sentPrompt.endsWith('hello pip')).toBe(true)
  })

  it('does NOT prepend org context on subsequent messages in a conversation', async () => {
    mockGetConversation.mockResolvedValue({ ...baseConv, messageCount: 4 })
    mockOrgDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Loyalty Plus' }),
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/route'
    )
    await POST(makeRequest({ content: 'follow-up' }), {
      params: Promise.resolve({ orgId: 'org1', convId: 'conv1' }),
    })

    const sentPrompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(sentPrompt).not.toContain('[Client context')
    expect(sentPrompt).toBe('follow-up')
  })

  it('gracefully omits org context when org doc is missing', async () => {
    mockOrgDocGet.mockResolvedValue({ exists: false, data: () => undefined })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/route'
    )
    await POST(makeRequest({ content: 'hi' }), {
      params: Promise.resolve({ orgId: 'org1', convId: 'conv1' }),
    })

    const sentPrompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(sentPrompt).not.toContain('[Client context')
    expect(sentPrompt).toBe('hi')
  })

  it('only renders fields that exist on the org doc', async () => {
    mockOrgDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Minimal Co' }),
    })

    const { POST } = await import(
      '@/app/api/v1/admin/hermes/profiles/[orgId]/conversations/[convId]/messages/route'
    )
    await POST(makeRequest({ content: 'go' }), {
      params: Promise.resolve({ orgId: 'org1', convId: 'conv1' }),
    })

    const sentPrompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(sentPrompt).toContain('name: Minimal Co')
    expect(sentPrompt).not.toContain('industry:')
    expect(sentPrompt).not.toContain('voice:')
    expect(sentPrompt).not.toContain('do-words:')
  })
})
