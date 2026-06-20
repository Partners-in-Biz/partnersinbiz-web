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
    linked: {},
    nodes: [{
      id: 'output-1',
      orgId: 'org-1',
      type: 'output',
      title: 'Output',
      position: { x: 0, y: 0 },
      data: {},
      review: { status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed', syntheticMediaDisclosure: true },
      output: { kind: 'image', url: 'https://cdn.example.com/image.png', textPreview: 'Launch image' },
    }],
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
      status: 'drafted',
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        exportId: 'export-1',
        draft: { target: 'campaign_asset', status: 'internal_draft' },
      },
    })
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
      payload: expect.objectContaining({
        title: 'Launch package',
        status: 'internal_package',
        assetCount: 1,
        clientVisible: false,
        publishEnabled: false,
      }),
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        exportId: 'export-1',
        package: { assetCount: 1, status: 'internal_package' },
      },
    })
  })
})
