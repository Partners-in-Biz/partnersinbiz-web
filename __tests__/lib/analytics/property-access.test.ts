import { adminDb } from '@/lib/firebase/admin'
import { AnalyticsPropertyAccessError, requireAnalyticsProperty } from '@/lib/analytics/property-access'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

function mockPropertyDoc(data: Record<string, unknown> | null) {
  ;(adminDb.collection as jest.Mock).mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(data
        ? { exists: true, id: data.id ?? 'prop-1', data: () => data }
        : { exists: false, data: () => null }),
    }),
  })
}

describe('requireAnalyticsProperty', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the property when it belongs to the requested organization', async () => {
    mockPropertyDoc({ id: 'prop-1', orgId: 'org-1', name: 'Client Site', deleted: false })

    const property = await requireAnalyticsProperty(
      { uid: 'admin-1', role: 'admin', authKind: 'session' },
      { propertyId: 'prop-1', orgId: 'org-1' },
    )

    expect(property).toMatchObject({ id: 'prop-1', orgId: 'org-1', name: 'Client Site' })
  })

  it('rejects a property that belongs to a different organization than the requested report scope', async () => {
    mockPropertyDoc({ id: 'prop-1', orgId: 'org-other', name: 'Other Site', deleted: false })

    await expect(requireAnalyticsProperty(
      { uid: 'admin-1', role: 'admin', authKind: 'session' },
      { propertyId: 'prop-1', orgId: 'org-1' },
    )).rejects.toMatchObject({
      status: 400,
      message: 'propertyId does not belong to orgId',
    })
  })

  it('rejects restricted admins when the property belongs to an unassigned organization', async () => {
    mockPropertyDoc({ id: 'prop-1', orgId: 'org-2', name: 'Other Site', deleted: false })

    await expect(requireAnalyticsProperty(
      { uid: 'admin-1', role: 'admin', authKind: 'session', allowedOrgIds: ['org-1'] },
      { propertyId: 'prop-1' },
    )).rejects.toBeInstanceOf(AnalyticsPropertyAccessError)
  })

  it('rejects missing or deleted properties', async () => {
    mockPropertyDoc({ id: 'prop-1', orgId: 'org-1', deleted: true })

    await expect(requireAnalyticsProperty(
      { uid: 'admin-1', role: 'admin', authKind: 'session' },
      { propertyId: 'prop-1' },
    )).rejects.toMatchObject({
      status: 404,
      message: 'Property not found',
    })
  })
})
