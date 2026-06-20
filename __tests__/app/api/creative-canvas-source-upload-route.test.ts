import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockSave = jest.fn()
const mockFile = jest.fn()
const mockBucket = jest.fn()
const mockGetStorage = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({ add: mockAdd })),
  },
  getAdminApp: jest.fn(() => ({})),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }),
}))

jest.mock('@/lib/api/actor', () => ({
  actorFrom: jest.fn(() => ({ createdBy: 'user-1', createdByType: 'user' })),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: mockGetStorage,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockSave.mockResolvedValue(undefined)
  mockFile.mockReturnValue({ save: mockSave })
  mockBucket.mockReturnValue({ name: 'test-bucket', file: mockFile })
  mockGetStorage.mockReturnValue({ bucket: mockBucket })
  mockAdd.mockResolvedValue({ id: 'upload-1' })
})

describe('creative canvas source upload API', () => {
  it('uploads an image and returns a source library item', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/sources/upload/route')
    const form = new FormData()
    form.append('orgId', 'org-1')
    form.append('canvasId', 'canvas-1')
    form.append('referenceRole', 'product')
    form.append('altText', 'Hero product bottle')
    form.append('file', new File(['fake-image'], 'product.png', { type: 'image/png' }))

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/sources/upload', {
      method: 'POST',
      body: form,
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockFile).toHaveBeenCalledWith(expect.stringMatching(/^creative-canvas\/org-1\/canvas-1\/.*\.png$/))
    expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      metadata: expect.objectContaining({ contentType: 'image/png' }),
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      name: 'product.png',
      source: 'creative_canvas',
      referenceRole: 'product',
      altText: 'Hero product bottle',
      relatedTo: { type: 'creative_canvas', id: 'canvas-1' },
      deleted: false,
    }))
    expect(body).toMatchObject({
      success: true,
      data: {
        upload: { id: 'upload-1', name: 'product.png', mimeType: 'image/png' },
        source: {
          id: 'upload:upload-1',
          title: 'product.png',
          source: {
            kind: 'upload',
            refId: 'upload-1',
            mimeType: 'image/png',
            referenceRole: 'product',
            altText: 'Hero product bottle',
          },
        },
      },
    })
  })

  it('rejects unsupported source file types', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/sources/upload/route')
    const form = new FormData()
    form.append('orgId', 'org-1')
    form.append('file', new File(['bad'], 'payload.exe', { type: 'application/x-msdownload' }))

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/sources/upload', {
      method: 'POST',
      body: form,
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ success: false, error: 'Creative Canvas sources must be image, video, audio, or PDF files' })
    expect(mockSave).not.toHaveBeenCalled()
  })
})
