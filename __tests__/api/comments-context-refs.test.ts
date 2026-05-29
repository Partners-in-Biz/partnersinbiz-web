import { NextRequest } from 'next/server'

const mockResolveContextReferences = jest.fn()
const mockCommentAdd = jest.fn()
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
    ) => Promise<Response>,
  ) => async (req: NextRequest) => handler(req, { uid: 'admin-1', role: 'admin', authKind: 'session' }),
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/comments/mentions', () => ({
  parseMentions: jest.fn(() => []),
  notifyMentions: jest.fn(() => Promise.resolve()),
}))

const resolvedRefs = [
  {
    type: 'research',
    id: 'research-1',
    orgId: 'org-1',
    label: 'Market Scan',
    origin: 'current_page',
  },
  {
    type: 'project',
    id: 'project-1',
    orgId: 'org-1',
    label: 'Launch Project',
    origin: 'mention',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveContextReferences.mockResolvedValue(resolvedRefs)
  mockCommentAdd.mockResolvedValue({ id: 'comment-1' })
  mockUserDoc.mockReturnValue({
    get: jest.fn(async () => ({ data: () => ({ displayName: 'Peet Stander' }) })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'comments') return { add: mockCommentAdd }
    if (name === 'users') return { doc: mockUserDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('unified comment context refs', () => {
  it('revalidates and stores context refs on research item comments', async () => {
    const { POST } = await import('@/app/api/v1/comments/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/comments', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        resourceType: 'research_item',
        resourceId: 'research-1',
        body: 'Use this launch project as evidence.',
        contextRefs: [
          { type: 'projects', id: 'project-1', orgId: 'org-1', origin: 'mention' },
        ],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [
        expect.objectContaining({ type: 'research', id: 'research-1', orgId: 'org-1', origin: 'current_page' }),
        expect.objectContaining({ type: 'project', id: 'project-1', orgId: 'org-1', origin: 'mention' }),
      ],
      expect.objectContaining({ uid: 'admin-1', role: 'admin' }),
      'org-1',
    )
    expect(mockCommentAdd).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'research_item',
      resourceId: 'research-1',
      contextRefs: resolvedRefs,
    }))
  })
})
