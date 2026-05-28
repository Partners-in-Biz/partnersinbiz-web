import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockTaskAdd = jest.fn()
const mockTaskDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockNotificationAdd = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (
      req: NextRequest,
      user: { uid: string; role: 'admin'; authKind: 'session' },
      ctx?: unknown,
    ) => Promise<Response>,
  ) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', authKind: 'session' }, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({ orgId: 'org-1', name: 'Launch Project' }),
    },
    projectAccess: { role: 'owner', source: 'owner_org', canViewInternal: true },
  })
  mockResolveContextReferences.mockResolvedValue([
    {
      type: 'contact',
      id: 'contact-1',
      orgId: 'org-1',
      label: 'Jane Client',
      origin: 'mention',
      href: '/admin/crm/contacts/contact-1',
      summary: 'email: jane@example.com',
      resolvedAt: '2026-05-28T10:00:00.000Z',
    },
  ])
  mockTaskAdd.mockResolvedValue({ id: 'task-1' })
  mockTaskCollection.mockReturnValue({ add: mockTaskAdd })
  mockTaskDoc.mockReturnValue({ collection: mockTaskCollection })
  mockProjectDoc.mockReturnValue({ collection: mockTaskCollection })
  mockNotificationAdd.mockResolvedValue({ id: 'notification-1' })
  mockUserDoc.mockReturnValue({
    get: jest.fn(async () => ({ data: () => ({ displayName: 'Peet Stander' }) })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'notifications') return { add: mockNotificationAdd }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task context refs', () => {
  it('revalidates and stores context refs on created tasks and agent input', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Follow up with Jane',
        orgId: 'org-1',
        assigneeAgentId: 'pip',
        agentInput: {
          spec: 'Recommend the next client action.',
          context: { projectId: 'project-1' },
        },
        contextRefs: [
          { type: 'contacts', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
        ],
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [{ type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' }],
      expect.objectContaining({ uid: 'admin-1', role: 'admin' }),
      'org-1',
    )
    expect(mockTaskAdd).toHaveBeenCalledWith(expect.objectContaining({
      contextRefs: [
        expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' }),
      ],
      agentInput: expect.objectContaining({
        context: expect.objectContaining({
          projectId: 'project-1',
          contextRefs: [
            expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' }),
          ],
        }),
      }),
    }))
  })
})
