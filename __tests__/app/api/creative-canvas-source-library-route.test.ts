import { NextRequest } from 'next/server'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }),
}))

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockImplementation((name: string) => ({
    where: jest.fn(() => ({
      get: jest.fn(async () => {
        const docsByCollection: Record<string, unknown[]> = {
          uploads: [
            doc('upload-1', {
              orgId: 'org-1',
              name: 'Product bottle.png',
              mimeType: 'image/png',
              url: 'https://cdn.example.com/product.png',
              thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
              storagePath: 'uploads/org-1/product.png',
            }),
          ],
          workspace_artifacts: [
            doc('artifact-1', {
              orgId: 'org-1',
              title: 'Campaign direction',
              mimeType: 'application/vnd.google-apps.document',
              google: { webViewLink: 'https://docs.google.com/document/d/doc-1/edit' },
              visibility: 'admin_agents',
              lifecycleStatus: 'draft',
              deleted: false,
            }),
          ],
          research_items: [
            doc('research-1', {
              orgId: 'org-1',
              title: 'Competitor creative patterns',
              summary: 'Three hooks and visual angles for launch assets.',
              deleted: false,
            }),
          ],
          social_media: [
            doc('media-1', {
              orgId: 'org-1',
              title: 'UGC clip',
              type: 'video',
              url: 'https://cdn.example.com/ugc.mp4',
              thumbnailUrl: 'https://cdn.example.com/ugc.jpg',
              storagePath: 'social-media/org-1/ugc.mp4',
            }),
          ],
          social_posts: [
            doc('post-1', {
              orgId: 'org-1',
              title: 'Launch post',
              platform: 'instagram',
              media: [{ url: 'https://cdn.example.com/post.png', thumbnailUrl: 'https://cdn.example.com/post-thumb.png', type: 'image' }],
              deleted: false,
            }),
          ],
          youtube_source_assets: [
            doc('youtube-1', {
              orgId: 'org-1',
              title: 'Founder raw footage',
              sourceUrl: 'https://cdn.example.com/founder.mp4',
              storagePath: 'youtube/org-1/founder.mp4',
              mediaFormat: 'video',
              deleted: false,
            }),
          ],
          book_studio_artifact_links: [
            doc('book-1', {
              orgId: 'org-1',
              label: 'Cover proof',
              href: 'https://cdn.example.com/cover.pdf',
              deleted: false,
            }),
          ],
        }
        return { docs: docsByCollection[name] ?? [] }
      }),
    })),
  }))
})

describe('creative canvas source library API', () => {
  it('returns normalized safe source references from platform asset collections', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'upload:upload-1',
        title: 'Product bottle.png',
        source: expect.objectContaining({
          kind: 'upload',
          refId: 'upload-1',
          url: 'https://cdn.example.com/product.png',
          thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
          storagePath: 'uploads/org-1/product.png',
          referenceRole: 'product',
        }),
      }),
      expect.objectContaining({
        id: 'workspace_artifact:artifact-1',
        title: 'Campaign direction',
        source: expect.objectContaining({
          kind: 'workspace_artifact',
          refId: 'artifact-1',
          url: 'https://docs.google.com/document/d/doc-1/edit',
        }),
      }),
      expect.objectContaining({
        id: 'youtube_asset:youtube-1',
        source: expect.objectContaining({
          kind: 'youtube_asset',
          refId: 'youtube-1',
          url: 'https://cdn.example.com/founder.mp4',
        }),
      }),
      expect.objectContaining({
        id: 'book_studio_record:book-1',
        source: expect.objectContaining({
          kind: 'book_studio_record',
          refId: 'book-1',
          url: 'https://cdn.example.com/cover.pdf',
        }),
      }),
    ]))
    expect(body.data.sources).toHaveLength(7)
  })

  it('filters source references by query text', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1&q=competitor'))
    const body = await res.json()

    expect(body.data.sources).toEqual([
      expect.objectContaining({ id: 'research_item:research-1', title: 'Competitor creative patterns' }),
    ])
  })
})
