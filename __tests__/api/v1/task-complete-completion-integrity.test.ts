import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockCollection = jest.fn()
const mockDispatchWebhook = jest.fn()
const mockLogActivity = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: NextRequest, user: { uid: string; role: string }, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, context?: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, context),
}))

jest.mock('@/lib/api/actor', () => ({
  lastActorFrom: jest.fn(() => ({ updatedBy: 'admin-1', updatedByType: 'user' })),
}))

jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: mockDispatchWebhook }))
jest.mock('@/lib/activity/log', () => ({ logActivity: mockLogActivity }))

describe('POST /api/v1/tasks/[id]/complete completion integrity', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Agent-built control',
        status: 'in_progress',
        assigneeAgentId: 'theo',
        agentStatus: 'in-progress',
        agentOutput: { summary: 'Implementation complete.' },
        completionVerification: null,
      }),
    })
    mockUpdate.mockResolvedValue(undefined)
    mockDispatchWebhook.mockResolvedValue(undefined)
    mockLogActivity.mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name !== 'tasks') throw new Error(`Unexpected collection: ${name}`)
      return { doc: () => ({ get: mockGet, update: mockUpdate }) }
    })
  })

  it('fails closed instead of letting a standalone agent task complete without watcher verification', async () => {
    const { POST } = await import('@/app/api/v1/tasks/[id]/complete/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/tasks/task-1/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'task-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'in_progress',
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
    }))
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('does not let the legacy route bypass a pending reviewer after watcher verification', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Agent-built control',
        status: 'in_progress',
        assigneeAgentId: 'theo',
        agentStatus: 'done',
        reviewerAgentId: 'qa-release',
        reviewStatus: 'pending',
        completionEvidence: {
          schemaVersion: 1,
          workKind: 'code',
          commitSha: 'a'.repeat(40),
          changedFiles: ['app/api/v1/tasks/[id]/complete/route.ts'],
          testCommand: 'npx jest --runInBand task-complete-completion-integrity.test.ts',
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
      }),
    })
    const { POST } = await import('@/app/api/v1/tasks/[id]/complete/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/tasks/task-1/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'task-1' }) },
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'completion_integrity_reviewer_handoff_required' })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('blocks an unbound passed verifier result rather than trusting narrative-shaped metadata', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Agent-built control',
        status: 'in_progress',
        assigneeAgentId: 'theo',
        agentStatus: 'in-progress',
        completionVerification: { verifierResult: 'passed' },
      }),
    })
    const { POST } = await import('@/app/api/v1/tasks/[id]/complete/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/tasks/task-1/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'task-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
    }))
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('blocks legacy assignedTo-only agent tasks on the convenience complete route', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Legacy agent task',
        status: 'in_progress',
        assignedTo: { type: 'agent', id: 'theo' },
        agentStatus: 'in-progress',
        agentOutput: { summary: 'Looks complete.' },
        completionVerification: null,
      }),
    })
    const { POST } = await import('@/app/api/v1/tasks/[id]/complete/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/tasks/task-1/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'task-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
    }))
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })
})
