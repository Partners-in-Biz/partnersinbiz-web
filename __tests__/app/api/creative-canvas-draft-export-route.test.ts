import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockCollection = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockCreateClientDocument = jest.fn()
const mockListChannelWorkspaces = jest.fn()
const mockCreateYouTubeVideoProject = jest.fn()

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

jest.mock('@/lib/client-documents/store', () => ({
  createClientDocument: mockCreateClientDocument,
}))

jest.mock('@/lib/youtube-studio/api', () => ({
  listChannelWorkspaces: mockListChannelWorkspaces,
  createYouTubeVideoProject: mockCreateYouTubeVideoProject,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockReturnValue({ add: mockAdd })
  mockAdd.mockResolvedValue({ id: 'export-1' })
  mockCreateClientDocument.mockResolvedValue({ id: 'client-doc-1', versionId: 'version-1', shareToken: 'token-1' })
  mockListChannelWorkspaces.mockResolvedValue([{ id: 'workspace-1', title: 'Main Channel' }])
  mockCreateYouTubeVideoProject.mockResolvedValue('video-project-new')
  mockGetCreativeCanvas.mockResolvedValue({
    id: 'canvas-1',
    orgId: 'org-1',
    title: 'Launch Canvas',
    purpose: 'Product launch',
    linked: { campaignId: 'campaign-1', clientDocumentId: 'doc-1', adCreativeId: 'creative-1', seoContentId: 'seo-content-1', youtubeVideoProjectId: 'video-project-1' },
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

function unlinkedCanvas() {
  return {
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
  }
}

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

  function bookStudioCollectionMocks(overrides: { projectAdd?: jest.Mock; exportAdd?: jest.Mock; canvasUpdate?: jest.Mock; seriesDocGet?: jest.Mock; existingProjectDocGet?: jest.Mock } = {}) {
    const projectAdd = overrides.projectAdd ?? jest.fn().mockResolvedValue({ id: 'book-project-1' })
    const exportAdd = overrides.exportAdd ?? jest.fn().mockResolvedValue({ id: 'export-2' })
    const canvasUpdate = overrides.canvasUpdate ?? jest.fn().mockResolvedValue(undefined)
    const seriesDocGet = overrides.seriesDocGet ?? jest.fn().mockResolvedValue({ exists: false })
    const existingProjectDocGet = overrides.existingProjectDocGet ?? jest.fn().mockResolvedValue({ exists: false })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'book_studio_projects') {
        return {
          add: projectAdd,
          doc: jest.fn(() => ({ get: existingProjectDocGet })),
        }
      }
      if (name === 'book_studio_series') return { doc: jest.fn(() => ({ get: seriesDocGet })) }
      if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
      return { add: exportAdd }
    })
    return { projectAdd, exportAdd, canvasUpdate, seriesDocGet, existingProjectDocGet }
  }

  it('auto-creates and links a Book Studio project when publishing to book_studio from an unlinked canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { projectAdd, exportAdd, canvasUpdate } = bookStudioCollectionMocks()
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
      body: JSON.stringify({ nodeId: 'chapter-1', target: 'book_studio', format: 'story' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Book Canvas',
      status: 'draft',
      stage: 'intake',
      format: 'story',
      trim: expect.objectContaining({ presetId: '6x9' }),
      creativeCanvasId: 'canvas-1',
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
        projectId: 'book-project-1',
        created: true,
        draft: { target: 'book_studio', textPreview: 'It was a dark and stormy night.' },
      },
    })
  })

  it('falls back to the canvas title when no title is given, and honors an explicit title', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { projectAdd } = bookStudioCollectionMocks({ projectAdd: jest.fn().mockResolvedValue({ id: 'book-project-2' }) })
    mockGetCreativeCanvas.mockResolvedValueOnce({
      ...unlinkedCanvas(),
      title: 'Untitled canvas',
      nodes: [{
        id: 'chapter-1',
        orgId: 'org-1',
        type: 'prompt',
        title: 'Chapter 1',
        position: { x: 0, y: 0 },
        data: { presentationType: 'chapter', text: 'Once upon a time.' },
      }],
      edges: [],
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'chapter-1', target: 'book_studio', format: 'story', title: 'My Great Novel' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Great Novel',
    }))
  })

  it('uses the default trim for the chosen format', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { projectAdd } = bookStudioCollectionMocks({ projectAdd: jest.fn().mockResolvedValue({ id: 'book-project-3' }) })
    mockGetCreativeCanvas.mockResolvedValueOnce({
      ...unlinkedCanvas(),
      nodes: [{
        id: 'chapter-1',
        orgId: 'org-1',
        type: 'prompt',
        title: 'Chapter 1',
        position: { x: 0, y: 0 },
        data: { presentationType: 'chapter', text: 'Sudoku time.' },
      }],
      edges: [],
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'chapter-1', target: 'book_studio', format: 'puzzle_sudoku' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalledWith(expect.objectContaining({
      format: 'puzzle_sudoku',
      trim: expect.objectContaining({ presetId: '8.5x11' }),
    }))
  })

  it('rejects a missing format with a 400 listing valid format ids', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    bookStudioCollectionMocks()
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('story')
    expect(body.error).toContain('colouring')
  })

  it('rejects an unknown format with a 400 listing valid format ids', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    bookStudioCollectionMocks()
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio', format: 'not_a_real_format' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('story')
    expect(body.error).toContain('colouring')
  })

  it('rejects a bogus seriesId with a 400', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { seriesDocGet } = bookStudioCollectionMocks({ seriesDocGet: jest.fn().mockResolvedValue({ exists: false }) })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio', format: 'story', seriesId: 'series-missing' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('seriesId')
    expect(seriesDocGet).toHaveBeenCalled()
  })

  it('rejects a seriesId belonging to another org with a 400', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    bookStudioCollectionMocks({
      seriesDocGet: jest.fn().mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', deleted: false }) }),
    })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio', format: 'story', seriesId: 'series-1' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('seriesId')
  })

  it('creates the project with a live, same-org seriesId attached', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { projectAdd } = bookStudioCollectionMocks({
      projectAdd: jest.fn().mockResolvedValue({ id: 'book-project-series-1' }),
      seriesDocGet: jest.fn().mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) }),
    })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio', format: 'story', seriesId: 'series-1' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalledWith(expect.objectContaining({ seriesId: 'series-1' }))
  })

  it('is idempotent: a second publish reuses the already-linked live book project and returns created:false', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const projectAdd = jest.fn()
    const { exportAdd } = bookStudioCollectionMocks({
      projectAdd,
      existingProjectDocGet: jest.fn().mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) }),
    })
    mockGetCreativeCanvas.mockResolvedValueOnce({
      ...unlinkedCanvas(),
      linked: { bookStudioProjectId: 'book-project-existing' },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(projectAdd).not.toHaveBeenCalled()
    expect(exportAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'book_studio',
      downstreamDraftId: 'book-project-existing',
    }))
    expect(body).toMatchObject({
      success: true,
      data: { projectId: 'book-project-existing', created: false },
    })
  })

  it('re-creates the project when the linked book project was soft-deleted', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const { projectAdd } = bookStudioCollectionMocks({
      projectAdd: jest.fn().mockResolvedValue({ id: 'book-project-fresh' }),
      existingProjectDocGet: jest.fn().mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: true }) }),
    })
    mockGetCreativeCanvas.mockResolvedValueOnce({
      ...unlinkedCanvas(),
      linked: { bookStudioProjectId: 'book-project-deleted' },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'book_studio', format: 'story' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(projectAdd).toHaveBeenCalled()
    expect(body).toMatchObject({
      success: true,
      data: { projectId: 'book-project-fresh', created: true },
    })
  })

  it('auto-creates and links a canvas_draft client document when publishing client_document from an unlinked canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const canvasUpdate = jest.fn().mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
      return { add: mockAdd }
    })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'client_document' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockCreateClientDocument).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Canvas draft: Launch Canvas',
      type: 'canvas_draft',
      orgId: 'org-1',
    }))
    expect(canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.clientDocumentId': 'client-doc-1',
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'client_document',
      downstreamDraftId: 'client-doc-1',
      categoryKey: 'blog_document',
    }))
    expect(body).toMatchObject({
      success: true,
      data: { draft: { target: 'client_document', status: 'internal_draft' } },
    })
  })

  it('auto-creates a canvas_draft client document for blog_post publishes from an unlinked canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const canvasUpdate = jest.fn().mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
      return { add: mockAdd }
    })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'blog_post' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateClientDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'canvas_draft' }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'blog_post',
      downstreamDraftId: 'client-doc-1',
    }))
  })

  it('auto-creates and links an email snippet when publishing email_block from an unlinked canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
    const snippetAdd = jest.fn().mockResolvedValue({ id: 'snippet-1' })
    const canvasUpdate = jest.fn().mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'email_snippets') return { add: snippetAdd }
      if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
      return { add: mockAdd }
    })
    mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'output-1', target: 'email_block' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(snippetAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      name: 'Canvas draft: Launch Canvas',
      category: 'custom',
      isStarter: false,
      deleted: false,
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: 'paragraph', props: expect.objectContaining({ html: 'Launch image' }) }),
        expect.objectContaining({ type: 'image', props: expect.objectContaining({ src: 'https://cdn.example.com/image.png' }) }),
      ]),
    }))
    expect(canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.emailSnippetId': 'snippet-1',
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      target: 'email_block',
      downstreamDraftId: 'snippet-1',
      categoryKey: 'blog_document',
    }))
    expect(body).toMatchObject({
      success: true,
      data: { draft: { target: 'email_block', status: 'internal_draft' } },
    })
  })

  it('exports ads_creative, seo_content, and youtube_studio drafts when the canvas is linked to downstream records', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

    for (const [target, downstreamDraftId] of [
      ['ads_creative', 'creative-1'],
      ['seo_content', 'seo-content-1'],
      ['youtube_studio', 'video-project-1'],
    ] as const) {
      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })

      expect(res.status).toBe(201)
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        target,
        downstreamDraftId,
        status: 'drafted',
      }))
    }
  })

  it('rejects unlinked ads_creative and seo_content publishes with actionable errors instead of auto-creating', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

    for (const [target, message] of [
      ['ads_creative', 'Link an ad creative first'],
      ['seo_content', 'Link an SEO content item first'],
    ] as const) {
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())
      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body).toMatchObject({
        success: false,
        error: expect.stringContaining(message),
      })
    }
    expect(mockAdd).not.toHaveBeenCalled()
  })

  describe('youtube_studio auto-create', () => {
    it('auto-creates a linked YouTube video project when the org has exactly one channel workspace', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
      const canvasUpdate = jest.fn().mockResolvedValue(undefined)
      mockCollection.mockImplementation((name: string) => {
        if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
        return { add: mockAdd }
      })
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })
      const body = await res.json()

      expect(res.status).toBe(201)
      expect(mockCreateYouTubeVideoProject).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          channelWorkspaceId: 'workspace-1',
          title: 'Launch Canvas',
          creativeCanvasId: 'canvas-1',
        }),
        expect.objectContaining({ uid: 'user-1' }),
      )
      expect(canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({
        'linked.youtubeVideoProjectId': 'video-project-new',
      }))
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        target: 'youtube_studio',
        downstreamDraftId: 'video-project-new',
        status: 'drafted',
      }))
      expect(body).toMatchObject({
        success: true,
        data: { draft: { target: 'youtube_studio', status: 'internal_draft' } },
      })
    })

    it('uses an explicit channelWorkspaceId when provided', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
      const canvasUpdate = jest.fn().mockResolvedValue(undefined)
      mockCollection.mockImplementation((name: string) => {
        if (name === 'creative_canvases') return { doc: jest.fn(() => ({ update: canvasUpdate })) }
        return { add: mockAdd }
      })
      mockListChannelWorkspaces.mockResolvedValueOnce([
        { id: 'workspace-1', title: 'Main Channel' },
        { id: 'workspace-2', title: 'Second Channel' },
      ])
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio', channelWorkspaceId: 'workspace-2' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })

      expect(res.status).toBe(201)
      expect(mockCreateYouTubeVideoProject).toHaveBeenCalledWith(
        expect.objectContaining({ channelWorkspaceId: 'workspace-2' }),
        expect.anything(),
      )
    })

    it('rejects with 400 when the org has no channel workspaces', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
      mockListChannelWorkspaces.mockResolvedValueOnce([])
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body).toMatchObject({
        success: false,
        error: expect.stringContaining('Create a YouTube channel workspace first'),
      })
      expect(mockCreateYouTubeVideoProject).not.toHaveBeenCalled()
      expect(mockAdd).not.toHaveBeenCalled()
    })

    it('rejects with 400 listing workspace ids when multiple exist and none is specified', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
      mockListChannelWorkspaces.mockResolvedValueOnce([
        { id: 'workspace-1', title: 'Main Channel' },
        { id: 'workspace-2', title: 'Second Channel' },
      ])
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toContain('Multiple channel workspaces')
      expect(body.error).toContain('workspace-1')
      expect(body.error).toContain('workspace-2')
      expect(mockCreateYouTubeVideoProject).not.toHaveBeenCalled()
    })

    it('rejects with 400 when an explicit channelWorkspaceId is not found in-org', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')
      mockListChannelWorkspaces.mockResolvedValueOnce([{ id: 'workspace-1', title: 'Main Channel' }])
      mockGetCreativeCanvas.mockResolvedValueOnce(unlinkedCanvas())

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio', channelWorkspaceId: 'workspace-999' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toContain('Channel workspace not found')
      expect(mockCreateYouTubeVideoProject).not.toHaveBeenCalled()
    })

    it('does not auto-create when the canvas is already linked to a video project (regression)', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/draft/route')

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'output-1', target: 'youtube_studio' }),
      }), { params: Promise.resolve({ id: 'canvas-1' }) })

      expect(res.status).toBe(201)
      expect(mockListChannelWorkspaces).not.toHaveBeenCalled()
      expect(mockCreateYouTubeVideoProject).not.toHaveBeenCalled()
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        target: 'youtube_studio',
        downstreamDraftId: 'video-project-1',
      }))
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
