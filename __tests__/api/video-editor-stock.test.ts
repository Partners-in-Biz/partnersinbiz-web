import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import type { StockResult } from '@/lib/video-editor/stock'

const mockUploadDocSet = jest.fn()
const mockEnsureOrgAccess = jest.fn()
const mockSaveVideoEditorUpload = jest.fn()

let mockUser: ApiUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'uploads') return { doc: () => ({ set: mockUploadDocSet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: (...args: unknown[]) => mockEnsureOrgAccess(...args),
}))

jest.mock('@/lib/video-editor/storage', () => ({
  saveVideoEditorUpload: (...args: unknown[]) => mockSaveVideoEditorUpload(...args),
}))

const stockResult: StockResult = {
  id: 'pexels-video-99',
  provider: 'pexels',
  mediaKind: 'video',
  title: 'Beach waves',
  thumbnailUrl: 'https://images.pexels.com/99.jpg',
  downloadUrl: 'https://videos.pexels.com/99-hd.mp4',
  attribution: 'Ann - Pexels',
  durationSeconds: 12,
}

function searchRequest(path = '/api/v1/video-editor/stock/search?q=beach&kind=all&page=1') {
  return new NextRequest(`http://localhost${path}`)
}

function importRequest(result: StockResult | Record<string, unknown> = stockResult) {
  return new NextRequest('http://localhost/api/v1/video-editor/stock/import', {
    method: 'POST',
    body: JSON.stringify({ orgId: 'org-1', result }),
    headers: { 'content-type': 'application/json' },
  })
}

describe('stock search route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.PEXELS_API_KEY = 'pexels-key'
    process.env.PIXABAY_API_KEY = 'pixabay-key'
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.pexels.com/v1/search')) {
        expect(init?.headers).toEqual({ Authorization: 'pexels-key' })
        return new Response(JSON.stringify({
          photos: [{
            id: 1,
            alt: 'Beach',
            photographer: 'Ann',
            src: { large2x: 'https://images.pexels.com/1.jpg', medium: 'https://images.pexels.com/1-m.jpg' },
          }],
        }), { status: 200 })
      }
      if (url.includes('api.pexels.com/videos/search')) {
        expect(init?.headers).toEqual({ Authorization: 'pexels-key' })
        return new Response(JSON.stringify({
          videos: [{
            id: 2,
            image: 'https://images.pexels.com/v2.jpg',
            duration: 12,
            user: { name: 'Bo' },
            video_files: [{ link: 'https://videos.pexels.com/2.mp4', height: 1080 }],
          }],
        }), { status: 200 })
      }
      if (url.includes('pixabay.com/api/videos')) {
        expect(url).toContain('key=pixabay-key')
        return new Response(JSON.stringify({
          hits: [{
            id: 4,
            tags: 'shore',
            previewURL: 'https://cdn.pixabay.com/4-p.jpg',
            videos: { large: { url: 'https://cdn.pixabay.com/4.mp4' } },
            user: 'Dee',
          }],
        }), { status: 200 })
      }
      if (url.includes('pixabay.com/api/')) {
        expect(url).toContain('key=pixabay-key')
        return new Response(JSON.stringify({
          hits: [{
            id: 3,
            tags: 'sky',
            previewURL: 'https://cdn.pixabay.com/3-p.jpg',
            largeImageURL: 'https://cdn.pixabay.com/3.jpg',
            user: 'Cy',
          }],
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    delete process.env.PEXELS_API_KEY
    delete process.env.PIXABAY_API_KEY
  })

  it('returns 400 when q is missing', async () => {
    const { GET } = await import('@/app/api/v1/video-editor/stock/search/route')
    const res = await GET(searchRequest('/api/v1/video-editor/stock/search?kind=video'))
    expect(res.status).toBe(400)
  })

  it('merges pexels and pixabay results', async () => {
    const { GET } = await import('@/app/api/v1/video-editor/stock/search/route')
    const res = await GET(searchRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.results.map((result: StockResult) => result.id).sort()).toEqual([
      'pexels-photo-1',
      'pexels-video-2',
      'pixabay-image-3',
      'pixabay-video-4',
    ])
  })

  it('omits a provider whose API key env is unset', async () => {
    delete process.env.PIXABAY_API_KEY
    const { GET } = await import('@/app/api/v1/video-editor/stock/search/route')
    const res = await GET(searchRequest('/api/v1/video-editor/stock/search?q=beach&kind=image&page=1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.results).toHaveLength(1)
    expect(body.data.results[0]).toMatchObject({ id: 'pexels-photo-1', provider: 'pexels', mediaKind: 'image' })
    expect((global.fetch as jest.Mock).mock.calls.some(([input]) => String(input).includes('pixabay'))).toBe(false)
  })
})

describe('stock import route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser
    mockEnsureOrgAccess.mockResolvedValue(null)
    mockUploadDocSet.mockResolvedValue(undefined)
    mockSaveVideoEditorUpload.mockResolvedValue({
      id: 'upload-1',
      url: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/video.mp4?alt=media&token=t',
      storagePath: 'video-editor/org-1/stock/pexels-video-99.mp4',
      sizeBytes: 5,
    })
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://videos.pexels.com/99-hd.mp4')
      expect(init).toMatchObject({ redirect: 'manual' })
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '4' },
      })
    }) as unknown as typeof fetch
  })

  it('rejects non-allowlisted URLs with 400', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const res = await POST(importRequest({ ...stockResult, downloadUrl: 'https://evil.example.com/x.mp4' }))
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()
  })

  it('downloads the asset server-side and stores it via the platform upload path', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const res = await POST(importRequest())
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(mockEnsureOrgAccess).toHaveBeenCalledWith(mockUser, 'org-1')
    expect(mockSaveVideoEditorUpload).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3, 4]),
      expect.objectContaining({
        orgId: 'org-1',
        folder: 'video-editor/org-1/stock',
        filename: 'pexels-video-99.mp4',
        mimeType: 'video/mp4',
        user: mockUser,
      }),
    )
    expect(mockUploadDocSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Beach waves',
      filename: 'pexels-video-99.mp4',
      source: 'stock',
      attribution: 'Ann - Pexels',
      thumbnailUrl: 'https://images.pexels.com/99.jpg',
      stock: expect.objectContaining({ provider: 'pexels', sourceId: 'pexels-video-99' }),
      provenance: expect.objectContaining({
        source: 'stock',
        provider: 'pexels',
        sourceId: 'pexels-video-99',
        attribution: 'Ann - Pexels',
      }),
    }), { merge: true })
    expect(body.data.upload).toEqual({
      fileId: 'upload-1',
      url: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/video.mp4?alt=media&token=t',
      mediaKind: 'video',
    })
  })

  it('rejects media kind mismatches and non-media downloads from allowlisted hosts', async () => {
    global.fetch = jest.fn(async () => new Response(new Uint8Array([1, 2]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })) as unknown as typeof fetch
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const mismatch = await POST(importRequest(stockResult))
    expect(mismatch.status).toBe(400)
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()

    global.fetch = jest.fn(async () => new Response(new Uint8Array([60, 33]), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch
    const nonMedia = await POST(importRequest(stockResult))
    expect(nonMedia.status).toBe(400)
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()
  })

  it('rejects untrusted thumbnail URLs and caps persisted text fields', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const badThumb = await POST(importRequest({ ...stockResult, thumbnailUrl: 'https://evil.example.com/thumb.jpg' }))
    expect(badThumb.status).toBe(400)
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()

    const longTitle = 'Title '.repeat(60)
    const longAttribution = 'Attribution '.repeat(60)
    const ok = await POST(importRequest({ ...stockResult, title: longTitle, attribution: longAttribution }))
    expect(ok.status).toBe(201)
    const patch = mockUploadDocSet.mock.calls[0][0]
    expect(patch.name).toHaveLength(160)
    expect(patch.attribution).toHaveLength(200)
    expect(patch.provenance.attribution).toHaveLength(200)
  })

  it('rejects redirects that leave the stock import allowlist', async () => {
    global.fetch = jest.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example.com/asset.mp4' },
    })) as unknown as typeof fetch
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const res = await POST(importRequest())
    expect(res.status).toBe(400)
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()
  })

  it('rejects oversized assets while streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(49 * 1024 * 1024))
        controller.enqueue(new Uint8Array(2 * 1024 * 1024))
        controller.close()
      },
    })
    global.fetch = jest.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })) as unknown as typeof fetch
    const { POST } = await import('@/app/api/v1/video-editor/stock/import/route')
    const res = await POST(importRequest())
    expect(res.status).toBe(400)
    expect(mockSaveVideoEditorUpload).not.toHaveBeenCalled()
  })
})
