import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockLutAdd = jest.fn()
const mockLutGet = jest.fn()
const mockLutDocGet = jest.fn()
const mockLutDocSet = jest.fn()
const mockSave = jest.fn()

const mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_luts') {
        return {
          add: mockLutAdd,
          doc: () => ({ get: mockLutDocGet, set: mockLutDocSet }),
          where: () => ({ get: mockLutGet }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
  getAdminApp: () => ({}),
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ name: 'test-bucket', file: () => ({ save: mockSave }) }) }),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  actorFields: () => ({ createdBy: 'admin-1', createdByType: 'user' }),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))

const VALID_CUBE = 'TITLE "Test"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n'

function uploadReq(content: string, filename = 'grade.cube') {
  const form = new FormData()
  form.set('orgId', 'org-1')
  form.set('title', 'Teal & Orange')
  form.set('file', new File([content], filename, { type: 'text/plain' }))
  return new NextRequest('http://localhost/api/v1/video-editor/luts', { method: 'POST', body: form })
}

describe('video-editor LUT library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockLutAdd.mockResolvedValue({ id: 'lut-1' })
    mockSave.mockResolvedValue(undefined)
  })

  it('POST validates the .cube header and stores the LUT', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/luts/route')
    const res = await POST(uploadReq(VALID_CUBE))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.lut).toMatchObject({ id: 'lut-1', title: 'Teal & Orange' })
    expect(body.data.lut.url).toContain('https://firebasestorage.googleapis.com/')
    expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      metadata: expect.objectContaining({ contentType: 'text/plain' }),
    }))
    expect(mockLutAdd.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      title: 'Teal & Orange',
      deleted: false,
      createdBy: 'admin-1',
    })
  })

  it('POST rejects malformed .cube files and invalid extensions', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/luts/route')

    const invalidExt = await POST(uploadReq(VALID_CUBE, 'grade.txt'))
    expect(invalidExt.status).toBe(400)

    for (const content of [
      'not a lut at all',
      'LUT_3D_SIZE 0\n',
      'LUT_3D_SIZE 65\n',
      'LUT_3D_SIZE 2\n',
      'LUT_3D_SIZE 2 garbage\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'DOMAIN_MIN nope\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'DOMAIN_MAX 0 0\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'LUT_1D_SIZE bananas\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'TITLE no-quotes\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'LUT_3D_SIZE 2\n0 0 0\n',
      'LUT_3D_SIZE 2\n0 0 nope\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
      'LUT_3D_SIZE 2\n0 0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
    ]) {
      const res = await POST(uploadReq(content))
      expect(res.status).toBe(400)
    }
  })

  it('GET lists org LUTs and hides deleted ones', async () => {
    mockLutGet.mockResolvedValue({
      docs: [
        { id: 'lut-2', data: () => ({ orgId: 'org-1', title: 'B', url: 'https://x/b.cube', storagePath: 'b', sizeBytes: 1, deleted: true }) },
        { id: 'lut-1', data: () => ({ orgId: 'org-1', title: 'A', url: 'https://x/a.cube', storagePath: 'a', sizeBytes: 1, deleted: false }) },
      ],
    })
    const { GET } = await import('@/app/api/v1/video-editor/luts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/luts?orgId=org-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.luts).toEqual([expect.objectContaining({ id: 'lut-1', title: 'A' })])
  })

  it('DELETE soft-deletes an org LUT and 404s on cross-org access', async () => {
    mockLutDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
    const { DELETE } = await import('@/app/api/v1/video-editor/luts/[id]/route')
    const context = { params: Promise.resolve({ id: 'lut-1' }) }
    const res = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/luts/lut-1?orgId=org-1', { method: 'DELETE' }), context)

    expect(res.status).toBe(200)
    expect(mockLutDocSet).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, updatedBy: 'admin-1' }), { merge: true })

    mockLutDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-OTHER', deleted: false }) })
    const res2 = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/luts/lut-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res2.status).toBe(404)
  })
})
