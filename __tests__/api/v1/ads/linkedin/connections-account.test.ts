import { PATCH } from '@/app/api/v1/ads/linkedin/connections/[id]/account/route'

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

describe('PATCH /api/v1/ads/linkedin/connections/[id]/account', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockUpdateConnection.mockReset()
  })

  it('returns 400 when selectedAdAccountUrn is not a string', async () => {
    const req = makeReq({ selectedAdAccountUrn: 123 })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/urn/i)
  })

  it('returns 400 when URN format is invalid', async () => {
    const req = makeReq({ selectedAdAccountUrn: 'not-a-urn' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/urn:li:sponsoredAccount/i)
  })

  it('returns 404 when connection platform is meta, not linkedin (cross-platform leak prevention)', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'c1', orgId: 'org-1', platform: 'meta', meta: {} }),
    })

    const req = makeReq({ selectedAdAccountUrn: 'urn:li:sponsoredAccount:9876543210' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockUpdateConnection).not.toHaveBeenCalled()
  })

  it('returns 200 and merges meta.linkedin preserving existing fields', async () => {
    const existingLinkedinMeta = {
      memberUrn: 'urn:li:person:ABC123',
      refreshTokenExpiresAt: { seconds: 9999999, nanoseconds: 0 },
    }
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'c1',
        orgId: 'org-1',
        platform: 'linkedin',
        meta: { linkedin: existingLinkedinMeta },
      }),
    })
    mockUpdateConnection.mockResolvedValue(undefined)

    const req = makeReq({ selectedAdAccountUrn: 'urn:li:sponsoredAccount:9876543210' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.selectedAdAccountUrn).toBe('urn:li:sponsoredAccount:9876543210')
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        meta: expect.objectContaining({
          linkedin: expect.objectContaining({
            memberUrn: 'urn:li:person:ABC123',
            selectedAdAccountUrn: 'urn:li:sponsoredAccount:9876543210',
          }),
        }),
      }),
    )
  })
})
