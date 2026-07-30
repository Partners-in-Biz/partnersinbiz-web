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
  actingForUserId?: string
  delegationId?: string
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
    { uid: 'agent:pip', role: 'ai' as const, authKind: 'agent_api_key' as const, agentId: 'pip' },
    { uid: 'peet', role: 'admin' as const, authKind: 'user_delegation' as const, agentId: 'pip' },
  ])('rejects pure agent keys and incomplete delegations for terminal transitions ($authKind)', async (user) => {
    mockUser = { ...user, orgId: 'owner-org' }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({ type: 'confirm', expectedRevision: 3, expectedDigest: 'digest' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('allows complete Messages user-delegation to answer a planning question (chat-native)', async () => {
    mockUser = {
      uid: 'peet',
      role: 'admin',
      orgId: 'owner-org',
      authKind: 'user_delegation',
      agentId: 'pip',
      actingForUserId: 'peet',
      delegationId: 'dlg-chat-1',
    }
    mockRunTransaction.mockImplementation(async (fn: (tx: {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      update: jest.Mock
      set: jest.Mock
    }) => Promise<unknown>) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => ({
            orgId: 'owner-org',
            planningDiscovery: {
              schemaVersion: 1,
              revision: 3,
              status: 'interviewing',
              mode: 'interview',
              enforced: true,
              inspection: {
                brief: ['b'], docs: ['d'], files: ['f'], plan: ['p'], tasks: ['t'],
                tools: ['to'], agents: ['a'], skills: ['s'],
                inspectedBy: 'pip', inspectedAt: '2026-07-30T00:00:00.000Z',
              },
              turns: [{
                id: 'q-3',
                question: 'Which matrix should we adopt?',
                currentGuess: 'Recommended matrix',
                askedBy: 'pip',
                askedAt: '2026-07-30T00:01:00.000Z',
              }],
              pendingQuestionId: 'q-3',
            },
          }),
        }),
        update: jest.fn(),
        set: jest.fn(),
      }
      return fn(tx)
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({
      type: 'answer_question',
      expectedRevision: 3,
      expectedQuestionId: 'q-3',
      answer: 'Yes, adopt the recommended matrix',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(200)
    expect(mockRunTransaction).toHaveBeenCalled()
  })

  it('allows complete Messages user-delegation to open confirm transaction', async () => {
    mockUser = {
      uid: 'peet',
      role: 'admin',
      orgId: 'owner-org',
      authKind: 'user_delegation',
      agentId: 'pip',
      actingForUserId: 'peet',
      delegationId: 'dlg-chat-1',
    }
    mockRunTransaction.mockImplementation(async () => ({
      ok: false,
      error: 'Submit the Decision Brief before confirming it',
      status: 409,
    }))

    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({ type: 'confirm', expectedRevision: 3, expectedDigest: 'digest' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    // Auth passed; business rule from planning state machine may still 409.
    expect(res.status).toBe(409)
    expect(mockRunTransaction).toHaveBeenCalled()
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

  it('rejects non-Pip user-delegation for interview actions', async () => {
    mockUser = {
      uid: 'peet',
      role: 'admin',
      orgId: 'owner-org',
      authKind: 'user_delegation',
      agentId: 'theo',
    }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({
      type: 'record_inspection',
      expectedRevision: 1,
      evidence: {
        brief: ['none observed'],
        docs: ['none observed'],
        files: ['none observed'],
        plan: ['none observed'],
        tasks: ['none observed'],
        tools: ['none observed'],
        agents: ['none observed'],
        skills: ['none observed'],
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it.each([
    { uid: 'agent:pip', role: 'ai' as const, authKind: 'agent_api_key' as const, agentId: 'pip' },
    { uid: 'peet', role: 'admin' as const, authKind: 'user_delegation' as const, agentId: 'pip' },
  ])('lets Pip interview via $authKind (opens transaction for ask_question)', async (user) => {
    mockUser = { ...user, orgId: 'owner-org' }
    mockRunTransaction.mockImplementation(async (fn: (tx: {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      update: jest.Mock
      set: jest.Mock
    }) => Promise<unknown>) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => ({
            orgId: 'owner-org',
            planningDiscovery: {
              schemaVersion: 1,
              revision: 2,
              status: 'interviewing',
              mode: 'mandatory',
              enforced: true,
              inspection: { completed: true, evidence: {} },
              turns: [],
              pendingQuestionId: null,
              predictedNextAnswers: [],
              intentBlockingUnknowns: [],
              confidence: null,
              brief: null,
              digest: null,
              snapshots: [],
            },
          }),
        }),
        update: jest.fn(),
        set: jest.fn(),
      }
      return fn(tx)
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
    const res = await POST(request({
      type: 'ask_question',
      expectedRevision: 2,
      question: 'Which outcome matters most for this implementation?',
      currentGuess: 'Safe development delivery',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    // Must not fail the Pip identity gate (403 "Pip is required…").
    // Transition may still fail with 4xx if state machine rejects, but transaction runs.
    expect(res.status).not.toBe(403)
    if (res.status === 403) {
      const body = await res.json()
      expect(body.error).not.toMatch(/Pip is required/i)
    }
    expect(mockRunTransaction).toHaveBeenCalled()
  })

  it('rejects agent API keys from answering Pip’s planning questions', async () => {
    mockUser = { uid: 'agent:pip', role: 'ai', orgId: 'owner-org', authKind: 'agent_api_key', agentId: 'pip' }
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
