import { NextRequest } from 'next/server'

const mockCreateSupportTicket = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()

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
      role: 'viewer',
      ctx?: unknown,
    ) => Promise<Response>,
  ) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, 'client-1', 'org-1', 'viewer', ctx),
}))

jest.mock('@/lib/support/store', () => ({
  createSupportTicket: (...args: unknown[]) => mockCreateSupportTicket(...args),
  listPortalSupportTickets: jest.fn(async () => []),
  validateSupportInput: (body: Record<string, unknown>) => ({
    ok: true,
    value: {
      category: body.category ?? 'question',
      priority: body.priority ?? 'normal',
      subject: body.subject,
      description: body.description,
      sourceUrl: body.sourceUrl,
      sourcePath: body.sourcePath,
    },
  }),
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSupportTicket.mockResolvedValue('ticket-1')
  mockResolveContextReferences.mockResolvedValue([
    {
      type: 'project',
      id: 'project-1',
      orgId: 'org-1',
      label: 'Launch Project',
      origin: 'current_page',
      href: '/portal/projects/project-1',
      summary: 'status: active',
      resolvedAt: '2026-05-28T10:00:00.000Z',
    },
  ])
  mockUserDoc.mockReturnValue({
    get: jest.fn(async () => ({
      data: () => ({ displayName: 'Client User', email: 'client@example.com' }),
    })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { doc: mockUserDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('portal support context refs', () => {
  it('revalidates context refs before creating a support ticket', async () => {
    const { POST } = await import('@/app/api/v1/portal/support/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/support', {
      method: 'POST',
      body: JSON.stringify({
        category: 'question',
        priority: 'normal',
        subject: 'Need help on this project',
        description: 'What should we do next?',
        sourceUrl: 'http://localhost/portal/projects/project-1',
        sourcePath: '/portal/projects/project-1',
        contextRefs: [
          { type: 'projects', id: 'project-1', orgId: 'org-1', origin: 'current_page' },
        ],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [{ type: 'project', id: 'project-1', orgId: 'org-1', origin: 'current_page' }],
      expect.objectContaining({ uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }),
      'org-1',
    )
    expect(mockCreateSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      uid: 'client-1',
      contextRefs: [
        expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project' }),
      ],
    }))
  })
})
