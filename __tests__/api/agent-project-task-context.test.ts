import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetProjectForUser = jest.fn()
const mockTaskGet = jest.fn()
const mockDependencyGet = jest.fn()
const mockCommentsGet = jest.fn()
const mockPermissionsGet = jest.fn()
const mockSourceGet = jest.fn()
let fixtureProjectDoc: { ref: unknown; data: () => Record<string, unknown> }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', orgId: 'org-1' }, ctx),
}))

jest.mock('@/lib/projects/access', () => ({ getProjectForUser: mockGetProjectForUser }))

beforeEach(() => {
  jest.clearAllMocks()

  const comments = {
    orderBy: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockCommentsGet })) })),
  }
  const activeTaskRef = { collection: jest.fn(() => comments), get: mockTaskGet }
  const dependencyTaskRef = { get: mockDependencyGet }
  const tasks = {
    doc: jest.fn((id: string) => id === 'task-1' ? activeTaskRef : dependencyTaskRef),
  }
  const permissions = { get: mockPermissionsGet }
  const docs = { doc: jest.fn(() => ({ get: mockSourceGet })) }
  const projectRef = {
    data: () => ({ orgId: 'org-1', name: 'Context budget', status: 'active' }),
    collection: jest.fn((name: string) => {
      if (name === 'tasks') return tasks
      if (name === 'permissions') return permissions
      if (name === 'docs') return docs
      throw new Error(`unexpected collection ${name}`)
    }),
  }
  fixtureProjectDoc = { ref: projectRef, data: projectRef.data }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: fixtureProjectDoc,
    projectAccess: { role: 'owner', canViewInternal: true },
  })
  mockTaskGet.mockResolvedValue({
    exists: true,
    id: 'task-1',
    ref: activeTaskRef,
    data: () => ({
      orgId: 'org-1', projectId: 'project-1', title: 'Implement bounded context',
      description: 'Only hydrate what this task needs.', assigneeAgentId: 'theo',
      agentStatus: 'pending', riskLevel: 'high', requiredCapability: 'platform-engineering',
      sourceDocumentId: 'spec-1', sourceSpecVersion: 'v3',
      agentInput: { spec: 'Add the minimal endpoint.', constraints: ['No broad project fetch'] },
      dependsOn: ['dependency-1'], approvalGateTaskId: 'approval-1',
      expectedArtifacts: ['commit'], verifierChecklist: ['Run focused tests'],
    }),
  })
  mockDependencyGet.mockImplementation(async () => ({
    exists: true,
    id: 'dependency-1',
    data: () => ({ title: 'Dependency', agentStatus: 'done', agentOutput: { summary: 'Ready', artifacts: ['artifact-1'] } }),
  }))
  mockCommentsGet.mockResolvedValue({
    docs: [
      { id: 'comment-2', data: () => ({ text: 'Second comment', userName: 'Quinn', userRole: 'qa' }) },
      { id: 'comment-1', data: () => ({ text: 'First comment', userName: 'Theo', userRole: 'engineering' }) },
    ],
  })
  mockPermissionsGet.mockResolvedValue({ docs: [] })
  mockSourceGet.mockResolvedValue({
    exists: true,
    id: 'spec-1',
    data: () => ({ title: 'Approved implementation spec', type: 'requirements', versionId: 'v3', content: 'Use bounded task context only.' }),
  })
})

describe('GET /api/v1/agent/project/[projectId]/task/[taskId]/context', () => {
  it('returns only the active task, direct dependencies, and task comments', async () => {
    const { GET } = await import('@/app/api/v1/agent/project/[projectId]/task/[taskId]/context/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/agent/project/project-1/task/task-1/context'),
      { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(expect.objectContaining({
      contextVersion: 1,
      project: expect.objectContaining({ id: 'project-1', name: 'Context budget' }),
      task: expect.objectContaining({
        id: 'task-1',
        agentInput: expect.objectContaining({ spec: 'Add the minimal endpoint.' }),
        expectedArtifacts: ['commit'],
        verifierChecklist: ['Run focused tests'],
      }),
      source: expect.objectContaining({ id: 'spec-1', versionId: 'v3', excerpt: 'Use bounded task context only.' }),
      dependencies: expect.arrayContaining([expect.objectContaining({ id: 'dependency-1' })]),
      comments: [expect.objectContaining({ id: 'comment-1' }), expect.objectContaining({ id: 'comment-2' })],
    }))
    expect(body.data).not.toHaveProperty('plan')
    expect(body.data).not.toHaveProperty('documents')
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', expect.any(Object), 'org-1')
    expect(mockTaskGet).toHaveBeenCalledTimes(1)
  })

  it('returns 404 without leaking a task hidden by a project permission policy', async () => {
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: fixtureProjectDoc,
      projectAccess: { role: 'contributor', canViewInternal: false },
    })
    mockPermissionsGet.mockResolvedValue({
      docs: [{ id: 'policy-hidden', data: () => ({ itemType: 'task', itemId: 'task-1', visibility: 'restricted', allowedUserIds: ['other-user'] }) }],
    })
    const { GET } = await import('@/app/api/v1/agent/project/[projectId]/task/[taskId]/context/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/agent/project/project-1/task/task-1/context'),
      { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) },
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: 'Task not found' }))
  })

  it('projects completionEvidence, completionVerification, and completionIntegrityFailureReasons', async () => {
    mockTaskGet.mockResolvedValue({
      exists: true,
      id: 'task-1',
      ref: { collection: jest.fn(() => ({ orderBy: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockCommentsGet })) })) })), get: mockTaskGet },
      data: () => ({
        orgId: 'org-1', projectId: 'project-1', title: 'Completion evidence task',
        assigneeAgentId: 'theo', agentStatus: 'in-progress',
        completionEvidence: {
          schemaVersion: 1,
          workKind: 'code',
          commitSha: 'abc1234',
          changedFiles: ['lib/example.ts'],
          testCommand: 'npm test',
          testResult: 'passed',
          worktreeState: 'clean',
        },
        completionVerification: {
          verifierIdentity: 'agent-watcher',
          verifierResult: 'passed',
          commitReachable: true,
          changedFilesMatch: true,
          worktreeClean: true,
        },
        completionIntegrityFailureReasons: null,
      }),
    })
    const { GET } = await import('@/app/api/v1/agent/project/[projectId]/task/[taskId]/context/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/agent/project/project-1/task/task-1/context'),
      { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) },
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.task.completionEvidence).toEqual(expect.objectContaining({
      schemaVersion: 1,
      workKind: 'code',
      commitSha: 'abc1234',
      changedFiles: ['lib/example.ts'],
      testResult: 'passed',
      worktreeState: 'clean',
    }))
    expect(body.data.task.completionVerification).toEqual(expect.objectContaining({
      verifierIdentity: 'agent-watcher',
      verifierResult: 'passed',
    }))
    expect(body.data.task.completionIntegrityFailureReasons).toBeNull()
  })

  it('projects null completion fields when absent from the task document', async () => {
    const { GET } = await import('@/app/api/v1/agent/project/[projectId]/task/[taskId]/context/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/agent/project/project-1/task/task-1/context'),
      { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) },
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.task.completionEvidence).toBeNull()
    expect(body.data.task.completionVerification).toBeNull()
    expect(body.data.task.completionIntegrityFailureReasons).toBeNull()
  })
})
