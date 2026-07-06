import { NextRequest } from 'next/server'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

let mockUser: Record<string, unknown> = { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest) =>
    handler(req, mockUser),
}))

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }
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
          youtube_render_jobs: [
            doc('render-job-1', {
              orgId: 'org-1',
              title: 'Launch trailer cut',
              status: 'rendered',
              versionNumber: 2,
              output: {
                previewUrl: 'https://cdn.example.com/render-1-preview.mp4',
                downloadUrl: 'https://cdn.example.com/render-1.mp4',
                storage: { mimeType: 'video/mp4', storagePath: 'youtube-render-jobs/org-1/render-1.mp4' },
              },
            }),
            doc('render-job-2', {
              orgId: 'org-1',
              title: 'QA review cut',
              status: 'qa_review',
              output: {
                previewUrl: 'https://cdn.example.com/render-2-preview.mp4',
              },
            }),
            doc('render-job-planning', {
              orgId: 'org-1',
              title: 'Not ready yet',
              status: 'planning',
              output: { previewUrl: 'https://cdn.example.com/render-planning.mp4' },
            }),
            doc('render-job-blocked', {
              orgId: 'org-1',
              title: 'Blocked cut',
              status: 'blocked',
              output: { previewUrl: 'https://cdn.example.com/render-blocked.mp4' },
            }),
            doc('render-job-no-url', {
              orgId: 'org-1',
              title: 'Rendered but no output yet',
              status: 'rendered',
            }),
            doc('render-job-storage-only', {
              orgId: 'org-1',
              title: 'Rendered but storage path only',
              status: 'rendered',
              output: {
                storage: { mimeType: 'video/mp4', storagePath: 'youtube-render-jobs/org-1/render-storage-only.mp4' },
              },
            }),
            doc('render-job-portal-visible', {
              orgId: 'org-1',
              title: 'Client-approved cut',
              status: 'approved',
              output: { previewUrl: 'https://cdn.example.com/render-portal-visible.mp4' },
              visibility: { showOutputsInPortal: true },
            }),
            doc('render-job-internal-only', {
              orgId: 'org-1',
              title: 'Internal-only cut',
              status: 'approved',
              output: { previewUrl: 'https://cdn.example.com/render-internal-only.mp4' },
              visibility: { showOutputsInPortal: false, showInClientPortal: false },
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
      expect.objectContaining({
        id: 'youtube_asset:render-job-1',
        title: 'Launch trailer cut',
        description: 'YouTube render / rendered v2',
        sourceCollection: 'youtube_render_jobs',
        source: expect.objectContaining({
          kind: 'youtube_asset',
          refId: 'render-job-1',
          url: 'https://cdn.example.com/render-1-preview.mp4',
          mimeType: 'video/mp4',
        }),
      }),
      expect.objectContaining({
        id: 'youtube_asset:render-job-2',
        title: 'QA review cut',
        description: 'YouTube render / qa_review',
        sourceCollection: 'youtube_render_jobs',
        source: expect.objectContaining({
          kind: 'youtube_asset',
          refId: 'render-job-2',
          url: 'https://cdn.example.com/render-2-preview.mp4',
          mimeType: 'video/mp4',
        }),
      }),
      expect.objectContaining({ id: 'youtube_asset:render-job-portal-visible' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-internal-only' }),
    ]))
    expect(body.data.sources).toHaveLength(11)
    expect(body.data.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'youtube_asset:render-job-planning' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-blocked' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-no-url' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-storage-only' }),
    ]))
  })

  it('excludes admin-role rendered jobs that only have a storage path (no http url)', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1'))
    const body = await res.json()

    expect(body.data.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'youtube_asset:render-job-storage-only' }),
    ]))
  })

  it('gates render job visibility by portal flags for client-role callers', async () => {
    mockUser = { uid: 'client-user-1', role: 'client', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1'))
    const body = await res.json()

    expect(body.data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'youtube_asset:render-job-portal-visible' }),
    ]))
    expect(body.data.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'youtube_asset:render-job-1' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-2' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-internal-only' }),
    ]))
  })

  it('does not restrict render job visibility for admin-role callers (regression)', async () => {
    mockUser = { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1'))
    const body = await res.json()

    expect(body.data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'youtube_asset:render-job-1' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-2' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-portal-visible' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-internal-only' }),
    ]))
  })

  it('filters source references by query text', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1&q=competitor'))
    const body = await res.json()

    expect(body.data.sources).toEqual([
      expect.objectContaining({ id: 'research_item:research-1', title: 'Competitor creative patterns' }),
    ])
  })

  it('filters source references by source kind, reference role, and media type', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/sources/route')
    const productRes = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1&sourceKind=upload&referenceRole=product&mediaType=image'))
    const productBody = await productRes.json()

    expect(productBody.data.sources).toEqual([
      expect.objectContaining({
        id: 'upload:upload-1',
        title: 'Product bottle.png',
        source: expect.objectContaining({
          kind: 'upload',
          referenceRole: 'product',
          mimeType: 'image/png',
        }),
      }),
    ])

    const videoRes = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/sources?orgId=org-1&mediaType=video'))
    const videoBody = await videoRes.json()
    expect(videoBody.data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'social_post:media-1' }),
      expect.objectContaining({ id: 'youtube_asset:youtube-1' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-1' }),
      expect.objectContaining({ id: 'youtube_asset:render-job-2' }),
    ]))
    expect(videoBody.data.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'upload:upload-1' }),
    ]))
  })
})
