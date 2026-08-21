import { NextRequest } from 'next/server'

const mockUserGet = jest.fn()
const mockUserDoc = jest.fn()
const mockOrgGet = jest.fn()
const mockOrgUpdate = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()
const mockCanUsePortalOrg = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'uid-1'),
}))
jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: mockCanUsePortalOrg,
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
  mockCanUsePortalOrg.mockResolvedValue(true)
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

  it('returns banking details to owners', async () => {
    stage('owner')

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organization.billingDetails.bankingDetails).toEqual({
      bankName: 'Existing Bank',
      accountNumber: '123',
    })
  })

  it('returns banking details to admins', async () => {
    stage('admin')

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organization.billingDetails.bankingDetails).toEqual({
      bankName: 'Existing Bank',
      accountNumber: '123',
    })
  })

  it('excludes banking details from members', async () => {
    stage('member')

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organization.billingDetails.bankingDetails).toBeUndefined()
  })

  it('excludes banking details from viewers', async () => {
    stage('viewer')

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organization.billingDetails.bankingDetails).toBeUndefined()
  })

  it('returns organisation details for a requested CRM company workspace org', async () => {
    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization?orgId=lumen-org'))

    expect(res.status).toBe(200)
    expect(mockCanUsePortalOrg).toHaveBeenCalledWith('uid-1', { activeOrgId: 'org-1' }, 'lumen-org')
    expect(mockOrgDoc).toHaveBeenCalledWith('lumen-org')
    expect(mockResolvePortalActiveOrgId).not.toHaveBeenCalled()
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
          bankingDetails: { 
            bankName: 'New Bank',
            accountNumber: '999',
            branchCode: '12345',
          },
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
          bankName: 'New Bank',
          accountNumber: '999',
          branchCode: '12345',
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
    // Owners and admins can now update banking details
    expect(update.billingDetails.bankingDetails.accountNumber).toBe('999')
    expect(update.billingDetails.bankingDetails.bankName).toBe('New Bank')
    expect(update.billingDetails.bankingDetails.branchCode).toBe('12345')
  })

  it('updates organisation details for a requested CRM company workspace org', async () => {
    stage('admin')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization?orgId=lumen-org', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lumen Speeds Holdings' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(mockCanUsePortalOrg).toHaveBeenCalledWith('uid-1', { activeOrgId: 'org-1' }, 'lumen-org')
    expect(mockOrgDoc).toHaveBeenCalledWith('lumen-org')
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lumen Speeds Holdings' }))
    expect(mockResolvePortalActiveOrgId).not.toHaveBeenCalled()
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

  it('allows portal owners to edit banking details', async () => {
    stage('owner')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billingDetails: {
          bankingDetails: {
            bankName: 'Owner Changed Bank',
            accountHolder: 'Company Name',
            accountNumber: '555',
            branchCode: '67890',
            swiftCode: 'OWNERABC',
          },
        },
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    const update = mockOrgUpdate.mock.calls[0][0]
    expect(update.billingDetails.bankingDetails).toEqual({
      bankName: 'Owner Changed Bank',
      accountHolder: 'Company Name',
      accountNumber: '555',
      branchCode: '67890',
      swiftCode: 'OWNERABC',
    })
  })

  it('allows portal admins to edit banking details', async () => {
    stage('admin')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billingDetails: {
          bankingDetails: {
            bankName: 'Admin Changed Bank',
            accountNumber: '777',
            iban: 'GB29NWBK60161331926819',
          },
        },
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    const update = mockOrgUpdate.mock.calls[0][0]
    expect(update.billingDetails.bankingDetails).toEqual({
      bankName: 'Admin Changed Bank',
      accountNumber: '777',
      iban: 'GB29NWBK60161331926819',
    })
  })

  it('writes a valid timezone to settings.timezone (the field cron/send-time reads), not a top-level field', async () => {
    stage('admin')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'America/New_York' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    const update = mockOrgUpdate.mock.calls[0][0]
    expect(update['settings.timezone']).toBe('America/New_York')
    expect(update.timezone).toBeUndefined()

    const body = await res.json()
    expect(body.organization.timezone).toBe('America/New_York')
  })

  it('rejects an invalid timezone with a 400 and does not write', async () => {
    stage('admin')

    const { PATCH } = await import('@/app/api/v1/portal/settings/organization/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Not/AZone' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
  })

  it('falls back to the legacy top-level timezone field, then the SAST default, when settings.timezone is unset', async () => {
    stage('owner', { timezone: 'Europe/London', settings: undefined })

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))
    const body = await res.json()

    expect(body.organization.timezone).toBe('Europe/London')
  })

  it('defaults to Africa/Johannesburg when no timezone has ever been set', async () => {
    stage('owner', { timezone: undefined, settings: undefined })

    const { GET } = await import('@/app/api/v1/portal/settings/organization/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/settings/organization'))
    const body = await res.json()

    expect(body.organization.timezone).toBe('Africa/Johannesburg')
  })
})
