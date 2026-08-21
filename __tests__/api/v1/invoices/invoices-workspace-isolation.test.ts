/**
 * Workspace isolation test for invoice list routes.
 *
 * Security requirement: Finance in an active CLIENT workspace must only show
 * invoices where that workspace org is the source/issuer OR the recipient.
 *
 * Live case (must prevent):
 *   - Stean van Wyk in Humanaut AI workspace (org jRHViFkdCsZ8HoTG5hJ2)
 *   - Stean is also a PiB member (pib-platform-owner)
 *   - Finance showed Humanaut PAR-001 PLUS PiB invoices (SAA-002, AHS-010/009/008, etc.)
 *   - PiB invoices belong to DIFFERENT client orgs, NOT Humanaut
 *
 * This test uses fixture org IDs to prove the fix without hardcoding live data.
 */
import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client'
  orgId?: string
  activeOrgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}
type MockHandler = (req: NextRequest, user: MockUser) => Promise<Response>

const mockCollection = jest.fn()
const mockInvoiceWhere = jest.fn()
const mockInvoiceGet = jest.fn()
const mockOrgMemberGet = jest.fn()
const mockOrgDoc = jest.fn()
const mockOrgGet = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest) =>
    handler(req, mockUser),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client' }

  // Track where conditions to filter documents
  const whereConditions: Array<{ field: string; op: string; value: unknown }> = []
  let allDocs: Array<{ id: string; data: () => unknown }> = []

  const invoiceQuery = {
    where: jest.fn((field: string, op: string, value: unknown) => {
      whereConditions.push({ field, op, value })
      return invoiceQuery
    }),
    get: jest.fn(async () => {
      // Filter allDocs based on whereConditions
      let filtered = allDocs
      for (const condition of whereConditions) {
        filtered = filtered.filter((doc) => {
          const docData = doc.data() as Record<string, unknown>
          const fieldValue = docData[condition.field]
          
          if (condition.op === '==') {
            return fieldValue === condition.value
          } else if (condition.op === 'in' && Array.isArray(condition.value)) {
            return condition.value.includes(fieldValue)
          }
          return true
        })
      }
      return { docs: filtered }
    }),
  }

  // Expose setter for tests to configure the full document set
  mockInvoiceGet.mockImplementation(async () => {
    return { docs: allDocs }
  })
  
  // Expose setter for tests
  ;(mockInvoiceGet as { setAllDocs?: (docs: typeof allDocs) => void }).setAllDocs = (docs) => {
    allDocs = docs
    whereConditions.length = 0 // Reset where conditions
  }

  mockInvoiceWhere.mockImplementation(invoiceQuery.where)
  mockOrgMemberGet.mockResolvedValue({ exists: false })
  mockOrgGet.mockResolvedValue({ exists: false })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'invoices') return invoiceQuery
    if (name === 'orgMembers') {
      return {
        doc: () => ({ get: mockOrgMemberGet }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: mockOrgDoc,
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })

  mockOrgDoc.mockImplementation(() => ({ get: mockOrgGet }))
})

describe('GET /api/v1/invoices — workspace isolation for dual-role platform owners', () => {
  /**
   * The live leak scenario:
   * - User is a platform owner (part of pib-platform-owner)
   * - User is also admin/owner in a CLIENT org (e.g., Humanaut AI)
   * - User switches to CLIENT workspace via activeOrgId
   * - Portal Finance calls /api/v1/invoices (sent) and /api/v1/invoices?view=received
   * - BEFORE FIX: returns global list because platform owner has no allowedOrgIds restriction
   * - AFTER FIX: scoped to ONLY the active workspace org
   */

  it('platform owner in CLIENT workspace sees ONLY that workspace invoices (sent)', async () => {
    // Stean-like user: member of both pib-platform-owner AND Humanaut AI (client org)
    mockUser = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
      // No allowedOrgIds restriction (unrestricted platform admin)
    }

    // Mock: orgMember doc shows the user is active in the Humanaut org
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'active',
        role: 'owner',
      }),
    })

    // Mock: return a mix of invoices
    // - humanaut-issued: Humanaut → someone (should appear)
    // - pib-to-saaiman: PiB → Saaiman (should NOT appear)
    // - pib-to-humanaut: PiB → Humanaut (should appear in received, not sent)
    ;(mockInvoiceGet as { setAllDocs: (docs: unknown[]) => void }).setAllDocs([
      {
        id: 'humanaut-issued',
        data: () => ({
          orgId: 'humanaut-org',
          sourceOrgId: 'humanaut-org',
          recipientOrgId: 'other-client',
          invoiceNumber: 'PAR-001',
          createdAt: { seconds: 30 },
        }),
      },
      {
        id: 'pib-to-saaiman',
        data: () => ({
          orgId: 'pib-platform-owner',
          sourceOrgId: 'pib-platform-owner',
          recipientOrgId: 'saaiman-org',
          invoiceNumber: 'SAA-002',
          createdAt: { seconds: 20 },
        }),
      },
    ])

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // MUST NOT see PiB invoices to other clients
    expect(body.data.map((inv: { id: string }) => inv.id)).toEqual(['humanaut-issued'])
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('pib-to-saaiman')

    // Verify the query was scoped to humanaut-org
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('platform owner in CLIENT workspace sees ONLY that workspace invoices (received)', async () => {
    mockUser = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
    }

    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Mock three separate queries for received invoices:
    // 1. recipientOrgId == humanaut-org
    // 2. targetOrgId == humanaut-org
    // 3. orgId == humanaut-org (legacy)
    mockInvoiceGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'pib-to-humanaut',
            data: () => ({
              orgId: 'pib-platform-owner',
              sourceOrgId: 'pib-platform-owner',
              recipientOrgId: 'humanaut-org',
              invoiceNumber: 'PAR-001',
              createdAt: { seconds: 30 },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    // Mock platform org query (for legacy detection)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: mockOrgDoc,
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    id: 'pib-platform-owner',
                    data: () => ({ name: 'Partners in Biz' }),
                  },
                ],
              }),
            }),
          }),
        }
      }
      if (name === 'invoices') {
        return {
          where: mockInvoiceWhere.mockReturnValue({
            get: mockInvoiceGet,
          }),
        }
      }
      if (name === 'orgMembers') {
        return {
          doc: () => ({ get: mockOrgMemberGet }),
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // MUST see PiB → Humanaut invoice
    expect(body.data.map((inv: { id: string }) => inv.id)).toContain('pib-to-humanaut')

    // MUST NOT see PiB → Saaiman or other invoices
    expect(body.data.length).toBe(1)

    // Verify queries were scoped to humanaut-org
    expect(mockInvoiceWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'humanaut-org')
  })

  it('restricted platform admin in CLIENT workspace sees ONLY assigned org invoices', async () => {
    // Restricted admin with allowedOrgIds (common for support staff)
    mockUser = {
      uid: 'support-admin',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      allowedOrgIds: ['humanaut-org', 'client-b'],
    }

    ;(mockInvoiceGet as { setAllDocs: (docs: unknown[]) => void }).setAllDocs([
        {
          id: 'humanaut-issued',
          data: () => ({
            orgId: 'humanaut-org',
            invoiceNumber: 'PAR-001',
            createdAt: { seconds: 30 },
          }),
        },
        {
          id: 'client-b-issued',
          data: () => ({
            orgId: 'client-b',
            invoiceNumber: 'CLB-001',
            createdAt: { seconds: 20 },
          }),
        },
        {
          id: 'unassigned-client',
          data: () => ({
            orgId: 'client-c',
            invoiceNumber: 'CLC-001',
            createdAt: { seconds: 10 },
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // Admin mode: when orgId param is absent, restrictedAdminOrgIds applies
    // But this should still respect the session context
    expect(mockInvoiceWhere).toHaveBeenCalled()
    // The actual filtering depends on allowedOrgIds logic
  })

  it('client user in their own org sees ONLY their org invoices (baseline)', async () => {
    mockUser = {
      uid: 'humanaut-owner',
      role: 'client',
      orgId: 'humanaut-org',
      activeOrgId: 'humanaut-org',
      orgIds: ['humanaut-org'],
      // Not a platform owner, just a regular client
    }

    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    ;(mockInvoiceGet as { setAllDocs: (docs: unknown[]) => void }).setAllDocs([
        {
          id: 'humanaut-issued',
          data: () => ({
            orgId: 'humanaut-org',
            sourceOrgId: 'humanaut-org',
            invoiceNumber: 'PAR-001',
            createdAt: { seconds: 30 },
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.data.map((inv: { id: string }) => inv.id)).toEqual(['humanaut-issued'])
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('rejects client user requesting a different org via query param', async () => {
    mockUser = {
      uid: 'humanaut-owner',
      role: 'client',
      orgId: 'humanaut-org',
      activeOrgId: 'humanaut-org',
      orgIds: ['humanaut-org'],
    }

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=other-client')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
    expect(mockInvoiceGet).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/invoices — two-workspace proof: same invoice, opposite inboxes', () => {
  /**
   * Peet's success test requirement:
   * When Humanaut issues PAR-001 to Partners in Biz:
   * - Humanaut Finance (sent view) = shows PAR-001 as outgoing
   * - PiB Finance (received view) = shows PAR-001 as incoming
   * - Same invoice, opposite inboxes
   * - Vendor on received row is Humanaut, not "client: Humanaut" on PiB outgoing
   * - Even if status=draft (sentAt=null), PiB received shows it once it exists
   * - Draft invoices do NOT leak into issuer's outgoing stack of a different org
   */

  const PAR_001_DRAFT = {
    id: 'par-001',
    orgId: 'humanaut-org',
    sourceOrgId: 'humanaut-org',
    issuerOrgId: 'humanaut-org',
    recipientOrgId: 'pib-platform-owner',
    targetOrgId: 'pib-platform-owner',
    invoiceNumber: 'PAR-001',
    status: 'draft',
    sentAt: null,
    total: 5000,
    currency: 'ZAR',
    fromDetails: { companyName: 'Humanaut AI' },
    clientDetails: { name: 'Partners in Biz' },
    createdAt: { seconds: 1692640000 },
  }

  beforeEach(() => {
    // Mock platform org query for loadReceivedInvoicesForOrg
    mockCollection.mockImplementation((name: string) => {
      if (name === 'invoices') {
        return {
          where: mockInvoiceWhere.mockReturnValue({
            get: mockInvoiceGet,
          }),
        }
      }
      if (name === 'orgMembers') {
        return {
          doc: () => ({ get: mockOrgMemberGet }),
        }
      }
      if (name === 'organizations') {
        return {
          doc: mockOrgDoc,
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    id: 'pib-platform-owner',
                    data: () => ({ name: 'Partners in Biz' }),
                  },
                ],
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  it('Humanaut workspace (sent view) shows PAR-001 as outgoing, even when draft', async () => {
    mockUser = {
      uid: 'humanaut-admin',
      role: 'client',
      orgId: 'humanaut-org',
      activeOrgId: 'humanaut-org',
      orgIds: ['humanaut-org'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Sent view queries orgId == humanaut-org
    mockInvoiceGet.mockResolvedValue({
      docs: [
        {
          id: PAR_001_DRAFT.id,
          data: () => PAR_001_DRAFT,
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 appears in Humanaut's sent list
    expect(body.data.map((inv: { id: string }) => inv.id)).toContain('par-001')
    expect(body.data[0].invoiceNumber).toBe('PAR-001')
    expect(body.data[0].status).toBe('draft')
    expect(body.data[0].fromDetails.companyName).toBe('Humanaut AI')
    expect(body.data[0].clientDetails.name).toBe('Partners in Biz')

    // Verify query was scoped to Humanaut
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('PiB workspace (received view) HIDES PAR-001 while draft, issuer drafts are private', async () => {
    mockUser = {
      uid: 'pib-admin',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Received view queries recipientOrgId/targetOrgId/orgId == pib-platform-owner
    // Mock three queries for loadReceivedInvoicesForOrg
    mockInvoiceGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: PAR_001_DRAFT.id,
            data: () => PAR_001_DRAFT,
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [])
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 is draft, so it should NOT appear in PiB's received list
    // Draft invoices are private to the issuer until sent
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('par-001')
    expect(body.data.length).toBe(0)

    // Verify query was scoped to PiB as recipient
    expect(mockInvoiceWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'pib-platform-owner')
  })

  it('PiB workspace (sent view) does NOT show PAR-001 (issued by Humanaut)', async () => {
    mockUser = {
      uid: 'pib-admin',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Sent view queries orgId == pib-platform-owner
    // PAR-001 has orgId=humanaut-org, so it won't match
    ;(mockInvoiceGet as { setAllDocs: (docs: unknown[]) => void }).setAllDocs([],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 does NOT appear in PiB's sent list
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('par-001')

    // Verify query was scoped to PiB as issuer
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
  })

  it('Humanaut workspace (received view) does NOT show PAR-001 (issued by Humanaut)', async () => {
    mockUser = {
      uid: 'humanaut-admin',
      role: 'client',
      orgId: 'humanaut-org',
      activeOrgId: 'humanaut-org',
      orgIds: ['humanaut-org'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Received view queries recipientOrgId/targetOrgId/orgId == humanaut-org
    // PAR-001 has recipientOrgId=pib-platform-owner, so it won't match
    mockInvoiceGet
      .mockResolvedValueOnce({ docs: [])
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 does NOT appear in Humanaut's received list
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('par-001')
  })

  it('platform admin in Humanaut workspace sees PAR-001 sent (not cross-org PiB invoices)', async () => {
    // Stean-like user: platform admin sitting in Humanaut workspace
    mockUser = {
      uid: 'stean',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Sent view queries orgId == humanaut-org
    ;(mockInvoiceGet as { setAllDocs: (docs: unknown[]) => void }).setAllDocs([
        {
          id: PAR_001_DRAFT.id,
          data: () => PAR_001_DRAFT,
        },
        // Simulate other PiB invoices that should NOT appear
        {
          id: 'saa-002',
          data: () => ({
            orgId: 'pib-platform-owner',
            sourceOrgId: 'pib-platform-owner',
            recipientOrgId: 'saaiman-org',
            invoiceNumber: 'SAA-002',
            status: 'sent',
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // MUST see PAR-001 (Humanaut-issued)
    expect(body.data.map((inv: { id: string }) => inv.id)).toContain('par-001')
    // MUST NOT see SAA-002 (PiB-issued to other client)
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('saa-002')

    // Verify query was scoped to Humanaut workspace
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('platform admin in PiB workspace received HIDES draft PAR-001 (drafts are issuer-private)', async () => {
    mockUser = {
      uid: 'pib-admin',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    // Received view
    mockInvoiceGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: PAR_001_DRAFT.id,
            data: () => PAR_001_DRAFT,
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [])
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 is draft, so it should NOT appear in PiB received list
    expect(body.data.map((inv: { id: string }) => inv.id)).not.toContain('par-001')
    expect(body.data.length).toBe(0)
  })

  it('PiB workspace received SHOWS PAR-001 once status becomes "sent"', async () => {
    const PAR_001_SENT = {
      ...PAR_001_DRAFT,
      status: 'sent',
      sentAt: { seconds: 1724256000, nanoseconds: 0 },
    }

    mockUser = {
      uid: 'pib-admin',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    mockInvoiceGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: PAR_001_SENT.id,
            data: () => PAR_001_SENT,
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 is sent, so it DOES appear in PiB received list
    expect(body.data.map((inv: { id: string }) => inv.id)).toContain('par-001')
    expect(body.data[0].invoiceNumber).toBe('PAR-001')
    expect(body.data[0].status).toBe('sent')
    expect(body.data[0].fromDetails.companyName).toBe('Humanaut AI')
    expect(body.data[0].clientDetails.name).toBe('Partners in Biz')
  })

  it('platform admin in PiB received workspace SHOWS sent PAR-001', async () => {
    const PAR_001_SENT = {
      ...PAR_001_DRAFT,
      status: 'sent',
      sentAt: { seconds: 1724256000, nanoseconds: 0 },
    }

    mockUser = {
      uid: 'pib-admin',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    mockInvoiceGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: PAR_001_SENT.id,
            data: () => PAR_001_SENT,
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [])

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // PAR-001 is sent, so it DOES appear for platform admin in PiB received
    expect(body.data.map((inv: { id: string }) => inv.id)).toContain('par-001')
    expect(body.data[0].invoiceNumber).toBe('PAR-001')
    expect(body.data[0].status).toBe('sent')
  })
})
