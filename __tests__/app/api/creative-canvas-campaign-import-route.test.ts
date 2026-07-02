import { NextRequest } from 'next/server'

const mockCampaignGet = jest.fn()
const mockCollection = jest.fn()
const mockBuildCampaignAssets = jest.fn()
const mockCreateCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvasGraph = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/campaigns/assets', () => ({
  buildCampaignAssets: (...args: unknown[]) => mockBuildCampaignAssets(...args),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  createCreativeCanvas: (...args: unknown[]) => mockCreateCreativeCanvas(...args),
  updateCreativeCanvasGraph: (...args: unknown[]) => mockUpdateCreativeCanvasGraph(...args),
}))

function assets(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'campaign-1',
    social: [{ id: 'post-1', content: 'Hello', platforms: ['linkedin'] }],
    blogs: [{ id: 'blog-1', title: 'Blog one', excerpt: 'Excerpt', heroImageUrl: 'https://cdn.example.com/hero.png' }],
    videos: [],
    meta: {
      totals: { social: 1, blogs: 1, videos: 0 },
      byStatus: { draft: 2, pending_approval: 0, approved: 0, published: 0 },
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockImplementation((name: string) => {
    if (name === 'campaigns') return { doc: jest.fn(() => ({ get: mockCampaignGet })) }
    throw new Error(`unexpected collection ${name}`)
  })
  mockCampaignGet.mockResolvedValue({
    exists: true,
    id: 'campaign-1',
    data: () => ({
      orgId: 'org-1',
      name: 'Spring Launch',
      deleted: false,
      brandIdentity: { logoUrl: 'https://cdn.example.com/logo.png' },
    }),
  })
  mockBuildCampaignAssets.mockResolvedValue(assets())
  mockCreateCreativeCanvas.mockResolvedValue({
    id: 'canvas-1',
    orgId: 'org-1',
    title: 'Campaign: Spring Launch',
    activeVersion: 1,
  })
  mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-1', activeVersion: 2 })
})

function importRequest(body: unknown = { campaignId: 'campaign-1' }) {
  return new NextRequest('http://test.local/api/v1/creative-canvas/import/campaign?orgId=org-1', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('creative canvas campaign import API', () => {
  it('creates a draft canvas from campaign content and returns 201', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/import/campaign/route')

    const res = await POST(importRequest())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockBuildCampaignAssets).toHaveBeenCalledWith('campaign-1')

    // Canvas created with campaign title/purpose/link, org-scoped, correct actor.
    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Campaign: Spring Launch',
        purpose: expect.stringContaining('campaign-1'),
        linked: { campaignId: 'campaign-1' },
      }),
      'org-1',
      { uid: 'user-1', type: 'user' },
    )

    // Graph persisted against version 1 with the campaign_import reason.
    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'campaign-import-brand-logo', type: 'source' }),
          expect.objectContaining({ id: 'campaign-import-blog-blog-1', type: 'prompt' }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({
            sourceNodeId: 'campaign-import-hero-blog-1',
            targetNodeId: 'campaign-import-blog-blog-1',
          }),
        ]),
      }),
      { uid: 'user-1', type: 'user' },
      { expectedActiveVersion: 1, reason: 'campaign_import' },
    )

    expect(body).toMatchObject({
      success: true,
      data: {
        canvasId: 'canvas-1',
        nodeCount: 4, // logo + hero + blog + 1 social group
        edgeCount: 1,
        capped: false,
      },
    })
  })

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignGet.mockResolvedValueOnce({ exists: false, id: 'campaign-1', data: () => undefined })
    const { POST } = await import('@/app/api/v1/creative-canvas/import/campaign/route')

    const res = await POST(importRequest())
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ success: false, error: 'Campaign not found' })
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('returns 404 for a campaign owned by another org', async () => {
    mockCampaignGet.mockResolvedValueOnce({
      exists: true,
      id: 'campaign-1',
      data: () => ({ orgId: 'org-2', name: 'Foreign', deleted: false }),
    })
    const { POST } = await import('@/app/api/v1/creative-canvas/import/campaign/route')

    const res = await POST(importRequest())

    expect(res.status).toBe(404)
    expect(mockBuildCampaignAssets).not.toHaveBeenCalled()
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('returns 400 when the campaign has no importable content', async () => {
    mockCampaignGet.mockResolvedValueOnce({
      exists: true,
      id: 'campaign-1',
      data: () => ({ orgId: 'org-1', name: 'Empty', deleted: false }),
    })
    mockBuildCampaignAssets.mockResolvedValueOnce(assets({ social: [], blogs: [], videos: [] }))
    const { POST } = await import('@/app/api/v1/creative-canvas/import/campaign/route')

    const res = await POST(importRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ success: false, error: 'Campaign has no importable content' })
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('returns 400 when campaignId is missing', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/import/campaign/route')

    const res = await POST(importRequest({}))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ success: false, error: 'campaignId is required' })
    expect(mockCampaignGet).not.toHaveBeenCalled()
  })
})
