import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()
const mockBookStudioGet = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest) => handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'viewer'),
}))

function stageCollections(settings: Record<string, unknown> = {}, docs: Array<{ id: string; data: () => Record<string, unknown> }> = []) {
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings }),
  })
  mockBookStudioGet.mockResolvedValue({ docs })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
    if (name === 'book_studio_projects') {
      return { where: jest.fn().mockReturnValue({ get: mockBookStudioGet }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('GET /api/v1/portal/book-studio', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageCollections()
  })

  it('blocks Book Studio portal access by default when no module setting is stored', async () => {
    const { GET } = await import('@/app/api/v1/portal/book-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/book-studio'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, moduleDisabled: true, module: 'bookStudio' })
    expect(mockCollection).not.toHaveBeenCalledWith('book_studio_projects')
    expect(mockBookStudioGet).not.toHaveBeenCalled()
  })

  it('returns the Book Studio portal foundation payload when the organisation enables the module', async () => {
    stageCollections({ portalModules: { bookStudio: true } })

    const { GET } = await import('@/app/api/v1/portal/book-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/book-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockBookStudioGet).toHaveBeenCalledTimes(1)
    expect(body.data).toMatchObject({ projects: [], portalModule: 'bookStudio' })
  })

  it('blocks Book Studio when the organisation role policy denies visibility', async () => {
    stageCollections({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            visibility: { owner: true, admin: true, member: false },
          },
        },
      },
    })

    const { GET } = await import('@/app/api/v1/portal/book-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/book-studio'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, moduleDisabled: true, module: 'bookStudio' })
    expect(mockBookStudioGet).not.toHaveBeenCalled()
  })

  it('returns sanitized review packets and gates for the portal review surface', async () => {
    stageCollections(
      { portalModules: { bookStudio: true } },
      [
        {
          id: 'book-1',
          data: () => ({
            title: 'Ocean Growth Playbook',
            status: 'client_review',
            stage: 'publishing_packet',
            reviewStatus: 'awaiting_client_review',
            nextAction: 'Review the packet.',
            safeSummary: 'Client-safe summary.',
            reviewPackets: [
              {
                id: 'packet-1',
                title: 'KDP proof',
                status: 'client_review',
                summary: 'Check the PDF.',
                artifacts: [
                  { label: 'Cover proof', href: 'https://example.com/cover.pdf' },
                  { label: 'Missing link' },
                ],
              },
            ],
            gates: [{ id: 'release', label: 'Human release review', status: 'blocked' }],
          }),
        },
      ],
    )

    const { GET } = await import('@/app/api/v1/portal/book-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/book-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.projects).toEqual([
      {
        id: 'book-1',
        title: 'Ocean Growth Playbook',
        status: 'client_review',
        stage: 'publishing_packet',
        reviewStatus: 'awaiting_client_review',
        nextAction: 'Review the packet.',
        safeSummary: 'Client-safe summary.',
        reviewPackets: [
          {
            id: 'packet-1',
            title: 'KDP proof',
            status: 'client_review',
            summary: 'Check the PDF.',
            artifacts: [{ label: 'Cover proof', href: 'https://example.com/cover.pdf' }],
          },
        ],
        gates: [{ id: 'release', label: 'Human release review', status: 'blocked' }],
      },
    ])
  })

  it('filters review packets and gates when the organisation role policy denies those views', async () => {
    stageCollections(
      {
        portalModules: { bookStudio: true },
        modulePolicies: {
          bookStudio: {
            actions: {
              publishingPackets: { owner: true, admin: true, member: false },
              approvalGates: { owner: true, admin: true, member: false },
            },
          },
        },
      },
      [
        {
          id: 'book-1',
          data: () => ({
            title: 'Ocean Growth Playbook',
            status: 'client_review',
            reviewPackets: [{ id: 'packet-1', title: 'KDP proof', status: 'client_review' }],
            gates: [{ id: 'release', label: 'Human release review', status: 'blocked' }],
          }),
        },
      ],
    )

    const { GET } = await import('@/app/api/v1/portal/book-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/book-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.projects[0]).toMatchObject({
      id: 'book-1',
      reviewPackets: [],
      gates: [],
    })
  })
})
