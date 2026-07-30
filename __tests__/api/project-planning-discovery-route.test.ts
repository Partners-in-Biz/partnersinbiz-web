import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockRunTransaction = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockEventDoc = jest.fn()

let mockUser: {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  authKind?: 'session' | 'firebase' | 'agent_api_key' | 'user_delegation'
  agentId?: string
} = { uid: 'peet', role: 'admin', orgId: 'owner-org', authKind: 'session' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'peet', role: 'admin', orgId: 'owner-org', authKind: 'session' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => ({ orgId: 'owner-org' }) },
    projectAccess: { role: 'owner' },
  })
  mockEventDoc.mockReturnValue({ id: 'event-1' })
  mockProjectDoc.mockReturnValue({
    collection: jest.fn(() => ({ doc: mockEventDoc })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/planning-discovery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'owner-org' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/projects/[projectId]/planning-discovery', () => {
  it('rejects unknown actions with 400 before opening a write transaction', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({ type: 'force_confirm', expectedRevision: 1 }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it.each([
    { uid: 'agent:pip', role: 'ai' as const, authKind: 'agent_api_key' as const },
    { uid: 'peet', role: 'admin' as const, authKind: 'user_delegation' as const },
  ])('rejects non-direct-human terminal transitions for $authKind', async (user) => {
    mockUser = { ...user, orgId: 'owner-org' }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({ type: 'confirm', expectedRevision: 3, expectedDigest: 'digest' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('allows only Pip to inspect, ask, or submit planning discovery', async () => {
    mockUser = { uid: 'agent:theo', role: 'ai', orgId: 'owner-org', authKind: 'agent_api_key', agentId: 'theo' }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({
      type: 'ask_question',
      expectedRevision: 2,
      question: 'Which outcome matters most for this implementation?',
      currentGuess: 'Safe development delivery',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it.each([
    { uid: 'agent:pip', role: 'ai' as const, authKind: 'agent_api_key' as const, agentId: 'pip' },
    { uid: 'peet', role: 'admin' as const, authKind: 'user_delegation' as const, agentId: 'pip' },
  ])('requires a direct human to answer Pip for $authKind', async (user) => {
    mockUser = { ...user, orgId: 'owner-org' }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({
      type: 'answer_question',
      expectedRevision: 2,
      expectedQuestionId: 'q-2',
      answer: 'Ship safely on development.',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })
})
