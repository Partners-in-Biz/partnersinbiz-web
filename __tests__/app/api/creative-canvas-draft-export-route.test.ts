import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockCollection = jest.fn()
const mockGetCreativeCanvas = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
  CREATIVE_CANVAS_COLLECTION: 'creative_canvases',
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockReturnValue({ add: mockAdd })
  mockAdd.mockResolvedValue({ id: 'export-1' })
  mockGetCreativeCanvas.mockResolvedValue({
    id: 'canvas-1',
    orgId: 'org-1',
    title: 'Launch Canvas',
    purpose: 'Product launch',
    linked: { campaignId: 'campaign-1', clientDocumentId: 'doc-1' },
    nodes: [
      {
        id: 'source-1',
        orgId: 'org-1',
        type: 'source',
        title: 'Source',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'output-1',
        orgId: 'org-1',
        type: 'output',
        title: 'Output',
        position: { x: 0, y: 0 },
        data: {},
        review: { status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed', syntheticMediaDisclosure: true },
        output: { kind: 'image', url: 'https://cdn.example.com/image.png', textPreview: 'Launch image' },
      },
    ],
    edges: [{ id: 'edge-1', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-1' }],
  })
})

describe('creative canvas generic draft export API', () => {
  it('persists a draft export record and returns draft payload', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'campaign_asset' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_exports')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'output-1',
      target: 'campaign_asset',
      categoryKey: 'image',
      downstreamDraftId: 'campaign-1',
      lineageSourceNodeIds: ['source-1'],
      outputNodeId: 'output-1',
      outputKind: 'image',
      reviewStatus: 'passed',
      status: 'drafted',
      createdAt: expect.any(String),
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        exportId: 'export-1',
        export: {
          id: 'export-1',
          categoryKey: 'image',
          downstreamDraftId: 'campaign-1',
          lineageSourceNodeIds: ['source-1'],
          outputNodeId: 'output-1',
        },
        draft: { target: 'campaign_asset', status: 'internal_draft' },
      },
    })
  })

  it('auto-creates and links a Book Studio project when publishing to book_studio from an unlinked canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const projectAdd = jest.fn().mockResolvedValue({ id: 'book-project-1' })
    const exportAdd = jest.fn().mockResolvedValue({ id: 'export-2' })
    const canvasUpdate = jest.fn().mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'book_studio_projects') return { add: projectAdd }
      if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
      return { add: exportAdd }
    })
    // Text-bearing chapter node on a canvas with NO linked book studio project.
    mockGetCreativeCanvas.mockResolvedValueOnce({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Book Canvas',
      purpose: 'Book board',
      linked: {},
      nodes: [{
        id: 'chapter-1',
        orgId: 'org-1',
        type: 'prompt',
        title: 'Chapter 1',
        position: { x: 0, y: 0 },
        data: { presentationType: 'chapter', text: 'It was a dark and stormy night.' },
      }],
      edges: [],
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'chapter-1', target: 'book_studio' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Book Canvas',
      status: 'draft',
    }))
    expect(canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.bookStudioProjectId': 'book-project-1',
    }))
    expect(exportAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'book_studio',
      downstreamDraftId: 'book-project-1',
      outputKind: 'copy',
      reviewStatus: 'warning',
      lineageSourceNodeIds: ['chapter-1'],
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        exportId: 'export-2',
        draft: { target: 'book_studio', textPreview: 'It was a dark and stormy night.' },
      },
    })
  })

  it('allows blog post draft exports with durable category evidence fields', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'blog_post', downstreamDraftId: 'blog-draft-1' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'blog_post',
      categoryKey: 'blog_document',
      downstreamDraftId: 'blog-draft-1',
      lineageSourceNodeIds: ['source-1'],
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        export: {
          target: 'blog_post',
          categoryKey: 'blog_document',
          downstreamDraftId: 'blog-draft-1',
        },
      },
    })
  })

  it('rejects draft exports without a real downstream draft id before persisting', async () => {
    mockGetCreativeCanvas.mockResolvedValueOnce({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
      linked: {},
      nodes: [
        {
          id: 'source-1',
          orgId: 'org-1',
          type: 'source',
          title: 'Source',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'output-1',
          orgId: 'org-1',
          type: 'output',
          title: 'Output',
          position: { x: 0, y: 0 },
          data: {},
          review: { status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed', syntheticMediaDisclosure: true },
          output: { kind: 'image', url: 'https://cdn.example.com/image.png', textPreview: 'Launch image' },
        },
      ],
      edges: [{ id: 'edge-1', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-1' }],
    })
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'campaign_asset' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      error: expect.stringContaining('requires downstream draft id'),
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('persists a multi-asset export package manifest', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/package/route')

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/package?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeIds: ['output-1'], title: 'Launch package' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_export_packages')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeIds: ['output-1'],
      packageAssetCount: 1,
      exportRecords: [
        expect.objectContaining({
          categoryKey: 'image',
          downstreamDraftId: 'campaign-1',
          lineageSourceNodeIds: ['source-1'],
          outputNodeId: 'output-1',
        }),
      ],
      payload: expect.objectContaining({
        title: 'Launch package',
        status: 'internal_package',
        assetCount: 1,
        clientVisible: false,
        publishEnabled: false,
        downstreamDrafts: [
          expect.objectContaining({
            sourceNodeId: 'output-1',
            publishEnabled: false,
          }),
        ],
        manifest: expect.objectContaining({
          lineage: [
            expect.objectContaining({
              outputNodeId: 'output-1',
            }),
          ],
        }),
      }),
      createdAt: expect.any(String),
    }))
    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_exports')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      packageExportId: 'export-1',
      categoryKey: 'image',
      downstreamDraftId: 'campaign-1',
      lineageSourceNodeIds: ['source-1'],
      outputNodeId: 'output-1',
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        exportId: 'export-1',
        exportRecords: [
          expect.objectContaining({
            categoryKey: 'image',
            downstreamDraftId: 'campaign-1',
          }),
        ],
        package: { assetCount: 1, status: 'internal_package' },
      },
    })
  })
})
