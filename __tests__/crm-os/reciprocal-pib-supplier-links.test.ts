const mockCollection = jest.fn()
const mockOrgDoc = jest.fn()
const mockCompanyWhere = jest.fn()
const mockCompanyLimit = jest.fn()
const mockCompanyGet = jest.fn()
const mockCompanyDoc = jest.fn()
const mockCompanySet = jest.fn()
const mockRelationshipWhere = jest.fn()
const mockRelationshipLimit = jest.fn()
const mockRelationshipGet = jest.fn()
const mockRelationshipAdd = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/pipelines/store', () => ({
  bootstrapDefaultPipeline: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    now: jest.fn(() => 'NOW_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()

  mockOrgDoc.mockImplementation((orgId: string) => ({
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => orgId === 'pib-platform-owner'
        ? { name: 'Partners in Biz', domain: 'partnersinbiz.online' }
        : { name: 'Covalonic', domain: 'covalonic.com' },
    }),
  }))

  const companyQuery = { limit: mockCompanyLimit }
  mockCompanyWhere.mockReturnValue(companyQuery)
  mockCompanyLimit.mockReturnValue({ get: mockCompanyGet })
  mockCompanyGet
    .mockResolvedValueOnce({ docs: [] })
    .mockResolvedValueOnce({ docs: [] })

  const companyRefs = [
    { id: 'platform-company', set: mockCompanySet },
    { id: 'supplier-company', set: mockCompanySet },
  ]
  mockCompanyDoc.mockImplementation(() => companyRefs.shift())
  mockCompanySet.mockResolvedValue(undefined)

  const relationshipQuery = { limit: mockRelationshipLimit }
  mockRelationshipWhere.mockReturnValue(relationshipQuery)
  mockRelationshipLimit.mockReturnValue({ get: mockRelationshipGet })
  mockRelationshipGet
    .mockResolvedValueOnce({ docs: [] })
    .mockResolvedValueOnce({ docs: [] })
  mockRelationshipAdd.mockImplementation(async (data: Record<string, unknown>) => ({
    id: `relationship-${mockRelationshipAdd.mock.calls.length}`,
    get: jest.fn().mockResolvedValue({ data: () => data }),
  }))

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: mockOrgDoc }
    if (name === 'companies') return { where: mockCompanyWhere, doc: mockCompanyDoc }
    if (name === 'businessRelationships') return { where: mockRelationshipWhere, add: mockRelationshipAdd }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('reciprocal Partners in Biz supplier links', () => {
  it('creates the client CRM company, client-side PiB supplier company, and reciprocal relationship records', async () => {
    const { ensurePlatformCompanyForOrg } = await import('@/lib/platform-owner/relationships')

    const result = await ensurePlatformCompanyForOrg({
      clientOrgId: 'client-org',
      platformOrgId: 'pib-platform-owner',
    })

    expect(result).toEqual({
      platformOrgId: 'pib-platform-owner',
      companyId: 'platform-company',
      companyName: 'Covalonic',
    })
    expect(mockCompanyWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockCompanyWhere).toHaveBeenCalledWith('orgId', '==', 'client-org')
    expect(mockCompanySet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orgId: 'pib-platform-owner',
      name: 'Covalonic',
      linkedOrgId: 'client-org',
      lifecycleStage: 'customer',
      tags: ['client-org'],
    }))
    expect(mockCompanySet).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orgId: 'client-org',
      name: 'Partners in Biz',
      linkedOrgId: 'pib-platform-owner',
      source: 'reciprocal_platform_supplier',
      visibility: 'client_visible',
      allowedOrgIds: ['client-org', 'pib-platform-owner'],
      approvalState: 'approved',
      tags: ['supplier', 'partners-in-biz'],
    }))
    expect(mockRelationshipAdd).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceOrgId: 'pib-platform-owner',
      sourceCompanyId: 'platform-company',
      targetOrgId: 'client-org',
      targetCompanyId: 'supplier-company',
      relationshipType: 'customer',
      visibility: 'client_visible',
      allowedOrgIds: ['pib-platform-owner', 'client-org'],
      portalVisible: true,
    }))
    expect(mockRelationshipAdd).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceOrgId: 'client-org',
      sourceCompanyId: 'supplier-company',
      targetOrgId: 'pib-platform-owner',
      targetCompanyId: 'platform-company',
      relationshipType: 'supplier',
      visibility: 'client_visible',
      allowedOrgIds: ['client-org', 'pib-platform-owner'],
      portalVisible: true,
    }))
  })
})
