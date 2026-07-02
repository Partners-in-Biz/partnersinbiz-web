import { NextRequest } from 'next/server'
import sharp from 'sharp'

const mockAdd = jest.fn()
const mockCollection = jest.fn()
const mockUploadMediaToStorage = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: NextRequest, user: { uid: string; role: string }, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, context?: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, context),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (
    handler: (req: NextRequest, user: { uid: string; role: string }, orgId: string, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, user: { uid: string; role: string }, context?: unknown) =>
    handler(req, user, 'pib-platform-owner', context),
}))

jest.mock('@/lib/social/storage', () => ({
  uploadMediaToStorage: mockUploadMediaToStorage,
}))

async function makeImageFile(width: number, height: number): Promise<File> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#f97316' },
  }).png().toBuffer()
  return new File([buffer], 'pin.png', { type: 'image/png' })
}

function requestWithFile(file: File) {
  const form = new FormData()
  form.set('file', file)
  form.set('altText', 'Alt text')
  return new NextRequest('http://localhost/api/v1/social/media/upload', {
    method: 'POST',
    body: form,
  })
}

describe('POST /api/v1/social/media/upload', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockAdd.mockResolvedValue({ id: 'media-1' })
    mockCollection.mockReturnValue({ add: mockAdd })
    mockUploadMediaToStorage.mockResolvedValue({
      publicUrl: 'https://storage.example.com/media.png',
      storagePath: 'social-media/pib-platform-owner/media.png',
    })
  })

  it('stores image width and height from uploaded bytes', async () => {
    const { POST } = await import('@/app/api/v1/social/media/upload/route')

    const res = await POST(requestWithFile(await makeImageFile(9, 16)))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('media-1')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'image',
      width: 9,
      height: 16,
      duration: null,
      altText: 'Alt text',
    }))
  })
})
