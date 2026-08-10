import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockCollection = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: NextRequest, user: { uid: string; role: string; allowedOrgIds: string[] }, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, context?: unknown) => handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [] }, context),
}))

jest.mock('@/lib/api/idempotency', () => ({
  withIdempotency: (handler: (req: NextRequest, user: unknown) => Promise<Response>) => handler,
}))

jest.mock('@/lib/api/actor', () => ({
  actorFrom: jest.fn(() => ({ createdBy: 'admin-1' })),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))

jest.mock('@/lib/agents/runRouting', () => ({
  cleanAgentEffort: jest.fn(() => null),
  VALID_AGENT_EFFORTS: ['low', 'medium', 'high'],
  resolveAgentTaskModelEligibility: jest.fn(() => ({ ok: true, model: { id: 'gpt-5.6-terra' } })),
}))

jest.mock('@/lib/client-documents/linkedValidation', () => ({
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS: [],
  RESOURCE_RELATIONSHIP_STRING_FIELDS: [],
  normalizeResourceRelationshipLinks: jest.fn(() => ({ ok: true, value: {} })),
}))

describe('POST /api/v1/tasks completion integrity', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockAdd.mockResolvedValue({ id: 'task-created' })
    mockCollection.mockReturnValue({ add: mockAdd })
  })

  it.each([
    { agentAssignment: { assigneeAgentId: 'theo' }, terminalState: { status: 'done' } },
    { agentAssignment: { assignedTo: { type: 'agent', id: 'theo' } }, terminalState: { agentStatus: 'done' } },
    { agentAssignment: { assigneeAgentId: 'theo' }, terminalState: { columnId: 'done' } },
    { agentAssignment: { assigneeAgentId: 'theo' }, terminalState: { reviewStatus: 'approved' } },
  ])('rejects an agent task created directly in a terminal state without verifier evidence: %j', async ({ agentAssignment, terminalState }) => {
    const { POST } = await import('@/app/api/v1/tasks/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        title: 'Narrative-only completion',
        ...agentAssignment,
        ...terminalState,
      }),
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'completion_integrity_verification_required' })
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
