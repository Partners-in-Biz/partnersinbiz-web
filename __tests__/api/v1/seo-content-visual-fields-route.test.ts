import { NextRequest } from 'next/server'

const mockUpdate = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }))
const mockCollection = jest.fn((name: string) => {
  if (name === 'seo_content') return { doc: mockDoc }
  if (name === 'api_keys') {
    return {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    }
  }
  throw new Error(`Unexpected collection ${name}`)
})

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

describe('PATCH /api/v1/seo/content/:id campaign visual fields', () => {
  const oldEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...oldEnv, AI_API_KEY: 'test-ai-key' }
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'pib-platform-owner', title: 'Campaign blog' }),
    })
  })

  afterEach(() => {
    process.env = oldEnv
  })

  it('allows agents to attach campaign blog hero images and source draft links through the API', async () => {
    const { PATCH } = await import('@/app/api/v1/seo/content/[id]/route')

    const res = await PATCH(new NextRequest('http://localhost/api/v1/seo/content/blog-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-ai-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        heroImageUrl: 'https://cdn.partnersinbiz.online/blog-hero.png',
        draftPostId: 'social-post-1',
      }),
    }), { params: Promise.resolve({ id: 'blog-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      heroImageUrl: 'https://cdn.partnersinbiz.online/blog-hero.png',
      draftPostId: 'social-post-1',
    }))
    expect(body.data.updated).toEqual(expect.arrayContaining(['heroImageUrl', 'draftPostId']))
  })
})
