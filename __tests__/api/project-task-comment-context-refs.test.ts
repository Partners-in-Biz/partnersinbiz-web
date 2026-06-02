import { NextRequest } from 'next/server'
import { notifyNewComment } from '@/lib/notifications/notify'

const mockGetProjectForUser = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockCommentSet = jest.fn()
const mockCommentGet = jest.fn()
const mockCommentDoc = jest.fn()
const mockCommentsCollection = jest.fn()
const mockTaskGet = jest.fn()
const mockTaskDoc = jest.fn()
const mockTasksCollection = jest.fn()
const mockProjectGet = jest.fn()
const mockProjectDoc = jest.fn()
const mockUserDoc = jest.fn()
const mockOrganizationGet = jest.fn()
const mockOrganizationDoc = jest.fn()
const mockOrganizationWhereGet = jest.fn()
const mockOrganizationWhere = jest.fn()
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

jest.mock('@/lib/notifications/notify', () => ({
  notifyNewComment: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

const resolvedRefs = [
  {
    type: 'task',
    id: 'task-1',
    orgId: 'org-1',
    label: 'Website Launch',
    origin: 'current_page',
    metadata: { projectId: 'project-1' },
  },
  {
    type: 'contact',
    id: 'contact-1',
    orgId: 'org-1',
    label: 'Jane Client',
    origin: 'mention',
  },
]

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
  mockResolveContextReferences.mockResolvedValue(resolvedRefs)
  mockCommentSet.mockResolvedValue(undefined)
  mockCommentGet.mockResolvedValue({
    data: () => ({
      text: 'Jane confirmed the requirements.',
      userId: 'admin-1',
      userName: 'Peet Stander',
      userRole: 'admin',
      createdAt: 'SERVER_TIMESTAMP',
      agentPickedUp: false,
      agentPickedUpAt: null,
      contextRefs: resolvedRefs,
    }),
  })
  mockCommentDoc.mockReturnValue({ id: 'comment-1', set: mockCommentSet, get: mockCommentGet })
  mockCommentsCollection.mockReturnValue({ doc: mockCommentDoc })
  mockTaskGet.mockResolvedValue({
    exists: true,
    data: () => ({ title: 'Website Launch' }),
  })
  mockTaskDoc.mockReturnValue({
    get: mockTaskGet,
    collection: mockCommentsCollection,
  })
  mockTasksCollection.mockReturnValue({ doc: mockTaskDoc })
  mockProjectGet.mockResolvedValue({
    data: () => ({ orgId: 'org-1', orgSlug: 'test-org' }),
  })
  mockProjectDoc.mockReturnValue({
    get: mockProjectGet,
    collection: mockTasksCollection,
  })
  mockUserDoc.mockReturnValue({
    get: jest.fn(async () => ({ exists: true, data: () => ({ displayName: 'Peet Stander' }) })),
  })
  mockOrganizationGet.mockResolvedValue({
    exists: true,
    data: () => ({ slug: 'test-org' }),
  })
  mockOrganizationDoc.mockReturnValue({ get: mockOrganizationGet })
  mockOrganizationWhereGet.mockResolvedValue({ docs: [] })
  mockOrganizationWhere.mockReturnValue({ limit: () => ({ get: mockOrganizationWhereGet }) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'organizations') return { doc: mockOrganizationDoc, where: mockOrganizationWhere }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task comment context refs', () => {
  it('revalidates and stores context refs on task comments', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/comments/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Jane confirmed the requirements.',
        contextRefs: [
          { type: 'contacts', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
        ],
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: 'task',
          id: 'task-1',
          orgId: 'org-1',
          origin: 'current_page',
          metadata: { projectId: 'project-1' },
        }),
        expect.objectContaining({ type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' }),
      ],
      expect.objectContaining({ uid: 'admin-1', role: 'admin' }),
      'org-1',
    )
    expect(mockCommentSet).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Jane confirmed the requirements.',
      contextRefs: resolvedRefs,
    }))
  })

  it('resolves task comment notification links from orgId when the project has no orgSlug', async () => {
    mockProjectGet.mockResolvedValue({
      data: () => ({ orgId: 'org-1' }),
    })
    mockOrganizationGet.mockResolvedValue({
      exists: true,
      data: () => ({ slug: 'lumen-speeds' }),
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/comments/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({ text: 'This needs a working email link.' }),
    }), {
      params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockOrganizationDoc).toHaveBeenCalledWith('org-1')
    expect(notifyNewComment).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      viewUrl: '/admin/org/lumen-speeds/projects/project-1?taskId=task-1',
    }))
  })
})
