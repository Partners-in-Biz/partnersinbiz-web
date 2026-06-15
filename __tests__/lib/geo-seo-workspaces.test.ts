var mockWhere = jest.fn()
var mockGet = jest.fn()
var mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { loadGeoSeoWorkspaces } from '@/lib/geo-seo/workspaces'

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
})

describe('loadGeoSeoWorkspaces', () => {
  it('filters deleted workspaces before mapping Marketing Hub list records', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'active-workspace',
          data: () => ({
            orgId: 'pib-platform-owner',
            siteName: 'Active GEO workspace',
            siteUrl: 'https://active.example',
            status: 'active',
            deleted: false,
            lastAuditAt: '2026-06-12T10:00:00.000Z',
          }),
        },
        {
          id: 'deleted-workspace',
          data: () => ({
            orgId: 'pib-platform-owner',
            siteName: 'Deleted GEO workspace',
            siteUrl: 'https://deleted.example',
            status: 'active',
            deleted: true,
            lastAuditAt: '2026-06-13T10:00:00.000Z',
          }),
        },
      ],
    })

    const workspaces = await loadGeoSeoWorkspaces('pib-platform-owner')

    expect(mockCollection).toHaveBeenCalledWith('geo_workspaces')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(workspaces).toEqual([
      expect.objectContaining({ id: 'active-workspace', siteName: 'Active GEO workspace' }),
    ])
  })
})
