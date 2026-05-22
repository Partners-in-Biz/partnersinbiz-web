import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockProjectGet = jest.fn()
const mockDocsGet = jest.fn()
const mockTasksGet = jest.fn()
const mockCommentsGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', orgId: 'platform' }, ctx),
}))

const ts = (millis: number) => ({
  toMillis: () => millis,
  toDate: () => new Date(millis),
})

beforeEach(() => {
  jest.clearAllMocks()

  const commentsCollection = {
    orderBy: jest.fn(() => ({
      limit: jest.fn(() => ({ get: mockCommentsGet })),
    })),
  }

  const taskDocRef = { collection: jest.fn(() => commentsCollection) }
  const tasksCollection = {
    orderBy: jest.fn(() => ({ get: mockTasksGet })),
    doc: jest.fn(() => taskDocRef),
  }
  const docsCollection = {
    orderBy: jest.fn(() => ({ get: mockDocsGet })),
  }
  const projectDocRef = {
    get: mockProjectGet,
    collection: jest.fn((name: string) => {
      if (name === 'docs') return docsCollection
      if (name === 'tasks') return tasksCollection
      throw new Error(`unexpected subcollection ${name}`)
    }),
  }
  mockCollection.mockReturnValue({ doc: jest.fn(() => projectDocRef) })

  mockProjectGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-1', name: 'QC project', status: 'active', description: 'desc', brief: 'brief' }),
  })
  mockDocsGet.mockResolvedValue({ docs: [] })
  mockCommentsGet.mockResolvedValue({ docs: [] })
})

describe('GET /api/v1/agent/project/[projectId]', () => {
  it('includes operational task fields needed for agent QC and handoff', async () => {
    mockTasksGet.mockResolvedValue({
      docs: [
        {
          id: 'task-1',
          data: () => ({
            orgId: 'org-1',
            projectId: 'project-1',
            title: 'Implement endpoint',
            description: 'Add handoff context',
            priority: 'high',
            columnId: 'review',
            status: 'in_progress',
            assigneeAgentId: 'theo',
            agentStatus: 'done',
            agentInput: { spec: 'Ship it', context: { source: 'kanban' } },
            agentOutput: {
              summary: 'Done',
              artifacts: [{ type: 'commit', ref: 'abc123', label: 'implementation' }],
              completedAt: ts(1_700_000_000_000),
            },
            dependsOn: ['task-0'],
            labels: ['qc', 'handoff'],
            reviewStatus: 'pending',
            agentConversationId: 'run-123',
            agentHeartbeatAt: ts(1_700_000_100_000),
            attachments: [{ name: 'secret-not-needed.txt', url: 'https://example.test/file' }],
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/agent/project/[projectId]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/agent/project/project-1'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        orgId: 'org-1',
        projectId: 'project-1',
        columnId: 'review',
        status: 'in_progress',
        assigneeAgentId: 'theo',
        agentStatus: 'done',
        agentInput: { spec: 'Ship it', context: { source: 'kanban' } },
        agentOutput: expect.objectContaining({
          summary: 'Done',
          artifacts: [{ type: 'commit', ref: 'abc123', label: 'implementation' }],
        }),
        dependsOn: ['task-0'],
        labels: ['qc', 'handoff'],
        reviewStatus: 'pending',
        agentConversationId: 'run-123',
        agentHeartbeatAt: expect.any(Object),
      }),
    ])
  })
})
