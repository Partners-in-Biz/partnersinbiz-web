/**
 * Test: Portal Workspace Bypass Prevention
 *
 * Critical security tests to prove that platform admins in a CLIENT workspace
 * cannot bypass workspace isolation by passing a different orgId query param.
 *
 * Attack vector: Platform admin in Humanaut workspace passes ?orgId=saaiman-org
 * to enumerate Saaiman's invoices.
 *
 * Expected: 403 Forbidden
 */

import { NextRequest } from 'next/server'

// Mock dependencies
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn(),
        })),
        get: jest.fn(),
      })),
      get: jest.fn(),
    })),
  },
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn((user: { uid: string; role: string; orgId?: string; allowedOrgIds?: string[] }, orgId: string) => {
    if (user.role === 'admin' || user.role === 'ai') {
      // If allowedOrgIds is set, respect it (restricted admin)
      if (Array.isArray(user.allowedOrgIds) && user.allowedOrgIds.length > 0) {
        return user.allowedOrgIds.includes(orgId) || user.orgId === orgId
      }
      // Unrestricted admin
      return true
    }
    return user.orgId === orgId
  }),
  restrictedAdminOrgIds: jest.fn(() => []),
  explicitAdminOrgIds: jest.fn(() => []),
}))

jest.mock('@/lib/billing/crm-record-scope', () => ({
  resolveBillingCrmAuthContext: jest.fn(() => Promise.resolve({
    orgId: 'humanaut-org',
    user: { uid: 'test-user', role: 'admin' },
    actor: { uid: 'test-user', role: 'admin' },
    isAgent: false,
  })),
  filterBillingRecordsForCrmActor: jest.fn((ctx: unknown, records: unknown[]) => Promise.resolve(records)),
}))

jest.mock('@/lib/billing/member-issuer', () => ({
  shouldExposeIssuerBillingBook: jest.fn(() => true),
  resolveInvoiceCreateAccess: jest.fn(() => Promise.resolve({ ok: true, mode: 'platform_admin' })),
}))

jest.mock('@/lib/platform-owner/relationships', () => ({
  resolvePlatformOwnerOrgId: jest.fn(() => Promise.resolve('pib-platform-owner')),
}))

jest.mock('@/lib/billing/portal-permissions', () => ({
  decorateInvoicePortalCapabilities: jest.fn((invoice: unknown) => invoice),
}))

let mockInvoiceWhere: jest.Mock
let mockInvoiceGet: jest.Mock

describe('Portal Workspace Bypass Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()

    const { adminDb } = require('@/lib/firebase/admin')
    mockInvoiceGet = jest.fn().mockResolvedValue({ docs: [] })
    mockInvoiceWhere = jest.fn(() => ({
      where: jest.fn(() => ({
        get: mockInvoiceGet,
      })),
      get: mockInvoiceGet,
    }))
    adminDb.collection.mockReturnValue({
      where: mockInvoiceWhere,
      get: mockInvoiceGet,
    })
  })

  it('BLOCKS platform admin in Humanaut workspace from accessing Saaiman invoices via ?orgId=', async () => {
    // Simulate: Platform admin Stean is in Humanaut workspace, tries to access Saaiman data
    const mockUser = {
      uid: 'stean',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org', // IN HUMANAUT WORKSPACE
      orgIds: ['pib-platform-owner', 'humanaut-org'],
      allowedOrgIds: null,
    }

    // Mock auth to return this user
    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    // Import route AFTER mocking
    const { GET } = await import('@/app/api/v1/invoices/route')

    // Attack: Try to access Saaiman's invoices while in Humanaut workspace
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=saaiman-org')
    const res = await GET(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Cannot access a different organisation from portal workspace')

    // Verify NO query was made to Saaiman's invoices
    expect(mockInvoiceWhere).not.toHaveBeenCalledWith('orgId', '==', 'saaiman-org')
  })

  it('BLOCKS platform admin without activeOrgId from bypassing portal (no-workspace admin)', async () => {
    // Simulate: Platform admin WITHOUT activeOrgId tries to enumerate client invoices
    // This should require explicit orgId param and respect allowedOrgIds
    const mockUser = {
      uid: 'admin-api',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: null, // NO ACTIVE WORKSPACE (API/cron context)
      orgIds: ['pib-platform-owner'],
      allowedOrgIds: ['pib-platform-owner', 'humanaut-org'], // Restricted admin
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Admin WITHOUT activeOrgId tries to access an org NOT in their allowedOrgIds
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=saaiman-org')
    const res = await GET(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/forbidden|access/i)
  })

  it('ALLOWS platform admin in Humanaut workspace to access Humanaut invoices (matching activeOrgId)', async () => {
    const mockUser = {
      uid: 'stean',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
      allowedOrgIds: null,
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Access Humanaut invoices with matching orgId param (should work)
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=humanaut-org')
    const res = await GET(req)

    expect(res.status).toBe(200)
    // Query was scoped to Humanaut
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('ALLOWS platform admin in Humanaut workspace without orgId param (defaults to activeOrgId)', async () => {
    const mockUser = {
      uid: 'stean',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
      allowedOrgIds: null,
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Access invoices without orgId param (should use activeOrgId)
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    // Query was scoped to Humanaut (activeOrgId)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('BLOCKS dual-role user switching orgId via query param in portal context', async () => {
    // Peet = PiB owner + Humanaut owner
    // In Humanaut workspace, tries to access PiB invoices
    const mockUser = {
      uid: 'peet',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org', // IN HUMANAUT WORKSPACE
      orgIds: ['pib-platform-owner', 'humanaut-org'],
      allowedOrgIds: null,
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Attack: Try to access PiB invoices while in Humanaut workspace
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=pib-platform-owner')
    const res = await GET(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Cannot access a different organisation from portal workspace')
  })

  it('ALLOWS admin WITHOUT activeOrgId to query allowed orgs (API/cron mode)', async () => {
    const mockUser = {
      uid: 'admin-api',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: null, // NO PORTAL CONTEXT
      orgIds: ['pib-platform-owner'],
      allowedOrgIds: null, // Super admin, no restrictions
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Admin API call with explicit orgId (should work)
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=humanaut-org')
    const res = await GET(req)

    expect(res.status).toBe(200)
    // Query was scoped to requested org
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'humanaut-org')
  })

  it('BLOCKS unrestricted admin WITHOUT activeOrgId from getting global list (no orgId param)', async () => {
    // Third review blocker: Unrestricted admin without activeOrgId should NOT get global list
    const mockUser = {
      uid: 'unrestricted-admin',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: null, // NO PORTAL CONTEXT
      orgIds: ['pib-platform-owner'],
      allowedOrgIds: null, // Unrestricted super admin
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Unrestricted admin WITHOUT activeOrgId, no orgId param (portal-style request)
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('orgId query parameter is required')

    // Verify NO global query was attempted
    expect(mockInvoiceGet).not.toHaveBeenCalled()
  })

  it('BLOCKS restricted admin WITHOUT activeOrgId from getting multi-org union (no orgId param)', async () => {
    // Fourth review blocker: Restricted admin without activeOrgId should NOT get multi-org list
    const mockUser = {
      uid: 'restricted-admin',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      activeOrgId: null, // NO PORTAL CONTEXT
      orgIds: ['pib-platform-owner'],
      allowedOrgIds: ['pib-platform-owner', 'humanaut-org'], // Restricted to 2 orgs
    }

    jest.doMock('@/lib/api/auth', () => ({
      withAuth: (role: string, handler: Function) => async (req: NextRequest) => {
        return handler(req, mockUser)
      },
    }))

    const { GET } = await import('@/app/api/v1/invoices/route')

    // Restricted admin WITHOUT activeOrgId, no orgId param
    // Should NOT return multi-org union (pib + humanaut)
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('orgId query parameter is required')

    // Verify NO multi-org query was attempted
    expect(mockInvoiceWhere).not.toHaveBeenCalledWith('orgId', 'in', ['pib-platform-owner', 'humanaut-org'])
    expect(mockInvoiceGet).not.toHaveBeenCalled()
  })
})
