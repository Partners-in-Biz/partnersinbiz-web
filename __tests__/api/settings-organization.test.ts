import { NextRequest } from 'next/server'

const mockUserGet = jest.fn()
const mockUserDoc = jest.fn()
const mockOrgGet = jest.fn()
const mockOrgUpdate = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'uid-1'),
}))
jest.mock('@/lib/portal/org-access', () => ({
  resolvePortalActiveOrgId: mockResolvePortalActiveOrgId,
}))
jest.mock('@/lib/platform-owner/relationships', () => ({
  syncPlatformCompanyAgreementFieldsForOrg: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

const baseOrg = {
  name: 'Client Trading',
  slug: 'client-trading',
  website: 'https://client.example',
  industry: 'Services',
  billingEmail: 'accounts@client.example',
  members: [{ userId: 'uid-1', role: 'owner' }],
  billingDetails: {
    legalName: 'Client Legal Pty Ltd',
    tradingName: 'Client Trading',
    registrationNumber: '2020/000000/07',
    vatNumber: '4000000000',
    taxNumber: '9999999999',
    phone: '+27 21 000 0000',
    address: {
      line1: '1 Main Road',
      city: 'Cape Town',
      postalCode: '8001',
      country: 'South Africa',
    },
    bankingDetails: {
      bankName: 'Existing Bank',
      accountNumber: '123',
    },
    accountsContact: {
      name: 'Accounts Person',
      email: 'accounts@client.example',
      phone: '+27 82 000 0000',
    },
    authorizedSignatory: {
      name: 'Owner Person',
      title: 'Director',
      email: 'owner@client.example',
      phone: '+27 83 000 0000',
    },
    purchaseOrderRequired: true,
    purchaseOrderNumber: 'PO-123',
    invoiceInstructions: 'Email invoices monthly.',
  },
}

function stage(role = 'owner', orgPatch: Record<string, unknown> = {}) {
  mockResolvePortalActiveOrgId.mockResolvedValue('org-1')
  mockUserGet.mockResolvedValue({ exists: true, data: () => ({ activeOrgId: 'org-1' }) })
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({
      ...baseOrg,
      members: [{ userId: 'uid-1', role }],
      ...orgPatch,
    }),
  })
  mockUserDoc.mockReturnValue({ get: mockUserGet })
  mockOrgDoc.mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'organizations') return { doc: mockOrgDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOrgUpdate.mockResolvedValue(undefined)
  stage()
})

describe('GET /api/v1/portal/settings/organization', () => {
  it('returns safe organisation legal and billing details for the active portal org', async () => {
    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      organization: {
        id: 'org-1',
        name: 'Client Trading',
        billingEmail: 'accounts@client.example',
        billingDetails: {
          legalName: 'Client Legal Pty Ltd',
          registrationNumber: '2020/000000/07',
          vatNumber: '4000000000',
          accountsContact: { email: 'accounts@client.example' },
          authorizedSignatory: { title: 'Director' },
          purchaseOrderRequired: true,
        },
      },
      permissions: { canEdit: true },
    })
  })
})

describe('PATCH /api/v1/portal/settings/organization', () => {
  it('allows portal owners and admins to update whitelisted organisation details', async () => {
    stage('admin')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated Trading',
        billingEmail: 'finance@client.example',
        active: false,
        billingDetails: {
          legalName: 'Updated Legal Pty Ltd',
          tradingName: 'Updated Trading',
          address: { line1: '2 Updated Road' },
          authorizedSignatory: {
            name: 'New Signatory',
            title: 'Managing Director',
            email: 'sign@client.example',
          },
          accountsContact: {
            name: 'Finance Lead',
            email: 'finance@client.example',
          },
          purchaseOrderRequired: false,
          purchaseOrderNumber: 'PO-456',
          invoiceInstructions: 'Use the PO on all invoices.',
          bankingDetails: { accountNumber: 'should-not-write-from-portal' },
        },
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    const update = mockOrgUpdate.mock.calls[0][0]
    expect(update).toMatchObject({
      name: 'Updated Trading',
      billingEmail: 'finance@client.example',
      billingDetails: {
        legalName: 'Updated Legal Pty Ltd',
        tradingName: 'Updated Trading',
        address: {
          line1: '2 Updated Road',
          city: 'Cape Town',
          postalCode: '8001',
          country: 'South Africa',
        },
        bankingDetails: {
          bankName: 'Existing Bank',
          accountNumber: '123',
        },
        authorizedSignatory: {
          name: 'New Signatory',
          title: 'Managing Director',
          email: 'sign@client.example',
        },
        accountsContact: {
          name: 'Finance Lead',
          email: 'finance@client.example',
        },
        purchaseOrderRequired: false,
        purchaseOrderNumber: 'PO-456',
        invoiceInstructions: 'Use the PO on all invoices.',
      },
      updatedAt: 'SERVER_TS',
    })
    expect(update.active).toBeUndefined()
    expect(update.billingDetails.bankingDetails.accountNumber).toBe('123')
  })

  it('blocks portal members and viewers from editing organisation details', async () => {
    stage('member')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingDetails: { legalName: 'Blocked Pty Ltd' } }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
  })
})
