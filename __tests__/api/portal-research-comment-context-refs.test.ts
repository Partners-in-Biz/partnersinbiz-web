import { NextRequest } from 'next/server'

const mockGetResearchItem = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockCommentAdd = jest.fn()
const mockCollection = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (
    _role: string,
    handler: (
      req: NextRequest,
      uid: string,
      orgId: string,
      role: string,
      ctx?: unknown,
    ) => Promise<Response>,
  ) => async (req: NextRequest, ctx?: unknown) => handler(req, 'client-1', 'org-1', 'viewer', ctx),
}))

jest.mock('@/lib/research/store', () => ({
  getResearchItem: (...args: unknown[]) => mockGetResearchItem(...args),
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
    type: 'contact',
    id: 'contact-1',
    orgId: 'org-1',
    label: 'Jane Client',
    origin: 'mention',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockGetResearchItem.mockResolvedValue({
    id: 'research-1',
    orgId: 'org-1',
    title: 'Market Scan',
    visibility: 'client_visible',
  })
  mockResolveContextReferences.mockResolvedValue(resolvedRefs)
  mockCommentAdd.mockResolvedValue({ id: 'comment-1' })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'comments') return { add: mockCommentAdd }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('portal research comment context refs', () => {
  it('revalidates and stores context refs on portal research comments', async () => {
    const { POST } = await import('@/app/api/v1/portal/research/[id]/comments/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/research/research-1/comments', {
      method: 'POST',
      body: JSON.stringify({
        body: 'Jane has the client-visible background.',
        contextRefs: [
          { type: 'contacts', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
        ],
      }),
    }), {
      params: Promise.resolve({ id: 'research-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [
        expect.objectContaining({ type: 'research', id: 'research-1', orgId: 'org-1', origin: 'current_page' }),
        expect.objectContaining({ type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' }),
      ],
      expect.objectContaining({ uid: 'client-1', role: 'client', orgId: 'org-1' }),
      'org-1',
    )
    expect(mockCommentAdd).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'research_item',
      resourceId: 'research-1',
      contextRefs: resolvedRefs,
    }))
  })
})
