import { PATCH } from '@/app/api/v1/ads/tiktok/connections/[id]/account/route'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => handler,
}))

const mockGet = jest.fn()
const mockUpdateConnection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockGet }),
    }),
  },
}))

jest.mock('@/lib/ads/connections/store', () => ({
  updateConnection: (...args: any[]) => mockUpdateConnection(...args),
}))

function makeReq(body: any, orgId = 'org-1'): any {
  return {
    headers: { get: (k: string) => (k === 'X-Org-Id' ? orgId : null) },
    json: async () => body,
  }
}

describe('PATCH /api/v1/ads/tiktok/connections/[id]/account', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockUpdateConnection.mockReset()
  })

  it('returns 400 when selectedAdvertiserId is not a string', async () => {
    const req = makeReq({ selectedAdvertiserId: 123 })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/selectedAdvertiserId/i)
  })

  it('returns 400 when selectedAdvertiserId does not match 6-20 numeric digit pattern', async () => {
    const req = makeReq({ selectedAdvertiserId: 'abc-not-numeric' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/6-20 numeric/i)
  })

  it('returns 404 when connection platform is meta, not tiktok (cross-platform leak prevention)', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'c1', orgId: 'org-1', platform: 'meta', meta: {} }),
    })

    const req = makeReq({ selectedAdvertiserId: '1234567890123456789' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockUpdateConnection).not.toHaveBeenCalled()
  })

  it('returns 200 and merges meta.tiktok preserving existing fields', async () => {
    const existingTiktokMeta = {
      advertiserIds: ['1234567890123456789'],
      tokenScope: ['1', '4'],
    }
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'c1',
        orgId: 'org-1',
        platform: 'tiktok',
        meta: { tiktok: existingTiktokMeta },
      }),
    })
    mockUpdateConnection.mockResolvedValue(undefined)

    const req = makeReq({ selectedAdvertiserId: '1234567890123456789' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.selectedAdvertiserId).toBe('1234567890123456789')
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        meta: expect.objectContaining({
          tiktok: expect.objectContaining({
            advertiserIds: ['1234567890123456789'],
            tokenScope: ['1', '4'],
            selectedAdvertiserId: '1234567890123456789',
          }),
        }),
      }),
    )
  })
})
