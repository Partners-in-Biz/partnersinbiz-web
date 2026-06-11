import { POST } from '@/app/api/v1/ads/creatives/import/route'

const mockCreateCreative = jest.fn()
const mockCollection = jest.fn()
const mockNow = { seconds: 1, nanoseconds: 0 }

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/creatives/store', () => ({ createCreative: (...args: unknown[]) => mockCreateCreative(...args) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('firebase-admin/firestore', () => ({ Timestamp: { now: jest.fn(() => mockNow) } }))

const approvedSocialPost = {
  orgId: 'org_1',
  status: 'approved',
  approvedAt: { seconds: 100 },
  approvedBy: 'maya',
  sourceVersionId: 'post_v1',
  projectId: 'proj_ads',
  approvalTaskId: 'task_approved',
  approvalDocumentId: 'doc_approved',
  approvalVersionId: 'doc_ver_1',
  approvalCommentId: 'comment_approved',
  thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
  placementSuitability: [{ platform: 'meta', placement: 'feed', status: 'suitable' }],
  specValidation: { status: 'valid', checkedAt: '2026-06-11T00:00:00.000Z', issues: [] },
  content: { text: 'Approved caption' },
  landingUrl: 'https://example.com/offer',
  utm: { source: 'linkedin', campaign: 'launch' },
  media: [
    {
      type: 'image',
      url: 'https://cdn.example.com/hero.jpg',
      storagePath: 'orgs/org_1/social/post_1/hero.jpg',
      mimeType: 'image/jpeg',
      fileSize: 123456,
      width: 1200,
      height: 628,
      alt: 'Hero asset',
    },
  ],
}

function request(body: unknown, orgId = 'org_1') {
  return new Request('http://localhost/api/v1/ads/creatives/import', {
    method: 'POST',
    headers: { 'X-Org-Id': orgId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateCreative.mockImplementation(async ({ orgId, input }) => ({
    id: 'crv_imported',
    orgId,
    platformRefs: {},
    ...input,
  }))
  mockCollection.mockImplementation((collectionName: string) => ({
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => ({
        exists: collectionName === 'social_posts' && id === 'post_1',
        id,
        data: () => approvedSocialPost,
      })),
    })),
  }))
})

describe('POST /api/v1/ads/creatives/import', () => {
  it('imports an approved social asset as a READY ad creative with source snapshot', async () => {
    const res = await POST(request({ sourceType: 'social_post', sourceId: 'post_1' }), { uid: 'theo' } as any)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(mockCreateCreative).toHaveBeenCalledWith({
      orgId: 'org_1',
      createdBy: 'theo',
      input: expect.objectContaining({
        type: 'image',
        name: 'Hero asset',
        sourceUrl: 'https://cdn.example.com/hero.jpg',
        storagePath: 'orgs/org_1/social/post_1/hero.jpg',
        mimeType: 'image/jpeg',
        fileSize: 123456,
        width: 1200,
        height: 628,
        status: 'READY',
        copy: expect.objectContaining({ primaryText: 'Approved caption', destinationUrl: 'https://example.com/offer' }),
        source: expect.objectContaining({
          type: 'social_post',
          id: 'post_1',
          collection: 'social_posts',
          approvedBy: 'maya',
          snapshot: expect.objectContaining({
            copy: 'Approved caption',
            landingUrl: 'https://example.com/offer',
            utm: { source: 'linkedin', campaign: 'launch' },
          }),
        }),
        sourceType: 'social_post',
        sourceId: 'post_1',
        sourceVersionId: 'post_v1',
        sourceOrgId: 'org_1',
        projectId: 'proj_ads',
        approvalStatus: 'approved',
        approvalTaskId: 'task_approved',
        approvalDocumentId: 'doc_approved',
        approvalVersionId: 'doc_ver_1',
        approvalCommentId: 'comment_approved',
        landingUrl: 'https://example.com/offer',
        utmDefaults: { source: 'linkedin', campaign: 'launch' },
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        placementSuitability: [{ platform: 'meta', placement: 'feed', status: 'suitable' }],
        specValidation: { status: 'valid', checkedAt: '2026-06-11T00:00:00.000Z', issues: [] },
      }),
    })
    expect(body.data.id).toBe('crv_imported')
  })

  it('blocks imports when the source asset is not approved', async () => {
    mockCollection.mockImplementationOnce((collectionName: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: collectionName === 'social_posts',
          id: 'post_1',
          data: () => ({ ...approvedSocialPost, status: 'draft', approvedAt: null }),
        })),
      })),
    }))

    const res = await POST(request({ sourceType: 'social_post', sourceId: 'post_1' }), { uid: 'theo' } as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/approved/i)
    expect(mockCreateCreative).not.toHaveBeenCalled()
  })

  it('rejects org mismatches before creating an ad creative', async () => {
    mockCollection.mockImplementationOnce((collectionName: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: collectionName === 'social_posts',
          id: 'post_1',
          data: () => ({ ...approvedSocialPost, orgId: 'other_org' }),
        })),
      })),
    }))

    const res = await POST(request({ sourceType: 'social_post', sourceId: 'post_1' }), { uid: 'theo' } as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/org/i)
    expect(mockCreateCreative).not.toHaveBeenCalled()
  })

  it('blocks imports when required landing, UTM, copy, or asset fields are missing', async () => {
    mockCollection.mockImplementationOnce((collectionName: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: collectionName === 'social_posts',
          id: 'post_1',
          data: () => ({ ...approvedSocialPost, landingUrl: '', utm: {}, media: [] }),
        })),
      })),
    }))

    const res = await POST(request({ sourceType: 'social_post', sourceId: 'post_1' }), { uid: 'theo' } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/required/i)
    expect(mockCreateCreative).not.toHaveBeenCalled()
  })
})
