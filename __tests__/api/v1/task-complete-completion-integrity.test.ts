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
})
