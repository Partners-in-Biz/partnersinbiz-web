import { NextRequest } from 'next/server'
import type { CompanyCommandCenter } from '@/lib/companies/command-center'

const mockAdminDbCollection = jest.fn()
const mockWithAuthUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['client-org'] }
const mockCanAccessOrg = jest.fn()
const mockLoadCompany = jest.fn()
const mockBuildCompanyCommandCenter = jest.fn()
const mockReconcileCrmLinks = jest.fn()
const mockCrmCtx = {
  orgId: 'org-1',
  actor: { uid: 'admin-1', displayName: 'Admin One', kind: 'human' },
  role: 'admin',
  isAgent: false,
  permissions: {},
  user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockAdminDbCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockWithAuthUser, ctx?: unknown) => Promise<Response>) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockWithAuthUser, ctx),
}))

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: (req: NextRequest, ctx: typeof mockCrmCtx, routeCtx?: unknown) => Promise<Response>) =>
    async (req: NextRequest, routeCtx?: unknown) => handler(req, mockCrmCtx, routeCtx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: (...args: unknown[]) => mockLoadCompany(...args),
}))

jest.mock('@/lib/companies/command-center', () => ({
  buildCompanyCommandCenter: (...args: unknown[]) => mockBuildCompanyCommandCenter(...args),
}))

jest.mock('@/lib/crm/reconcile-links', () => ({
  reconcileCrmLinks: (...args: unknown[]) => mockReconcileCrmLinks(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((value: number) => ({ __op: 'increment', value })),
  },
  Timestamp: {
    now: jest.fn(() => 'NOW_TIMESTAMP'),
  },
}))

function request(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function routeCtx(id = 'company-1') {
  return { params: Promise.resolve({ id }) }
}

function collectionFor(rows: Array<{ id: string; data: Record<string, unknown> }> = []) {
  const query = {
    where: jest.fn(() => query),
    limit: jest.fn(() => query),
    get: jest.fn(async () => ({
      empty: rows.length === 0,
      docs: rows.map((row) => ({
        id: row.id,
        data: () => row.data,
        ref: { set: jest.fn(), update: jest.fn() },
      })),
    })),
  }
  return {
    where: query.where,
    limit: query.limit,
    get: query.get,
    add: jest.fn(async (data: Record<string, unknown>) => ({
      id: `created-${rows.length + 1}`,
      get: async () => ({ data: () => data }),
    })),
    doc: jest.fn((id?: string) => ({
      id: id ?? `doc-${rows.length + 1}`,
      get: jest.fn(async () => {
        const row = rows.find((item) => item.id === id)
        return row ? { exists: true, id, data: () => row.data } : { exists: false, id, data: () => undefined }
      }),
      set: jest.fn(async () => undefined),
      update: jest.fn(async () => undefined),
    })),
  }
}

describe('world-class CRM OS foundation gaps', () => {
  afterEach(() => {
    jest.resetModules()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockCanAccessOrg.mockReturnValue(true)
    mockLoadCompany.mockResolvedValue({ data: { id: 'company-1', orgId: 'client-org', name: 'Acme' } })
    mockBuildCompanyCommandCenter.mockResolvedValue({ summary: { projects: 1 }, projects: [{ id: 'project-1' }] })
    mockAdminDbCollection.mockImplementation((name: string) => {
      if (name === 'organizations') {
        return collectionFor([{ id: 'client-org', data: { slug: 'client-slug', name: 'Client Org' } }])
      }
      return collectionFor()
    })
  })

  it('provides an admin selected-client company command-center route scoped by org slug', async () => {
    const { GET } = await import('@/app/api/v1/admin/crm/companies/[id]/command-center/route')

    const res = await GET(
      request('GET', '/api/v1/admin/crm/companies/company-1/command-center?orgSlug=client-slug&limit=25'),
      routeCtx(),
    )

    expect(res.status).toBe(200)
    expect(mockCanAccessOrg).toHaveBeenCalledWith(mockWithAuthUser, 'client-org')
    expect(mockLoadCompany).toHaveBeenCalledWith('company-1', 'client-org')
    expect(mockBuildCompanyCommandCenter).toHaveBeenCalledWith(
      { id: 'company-1', orgId: 'client-org', name: 'Acme' },
      expect.objectContaining({ limit: 25 }),
    )
    expect((await res.json()).data.projects).toEqual([{ id: 'project-1' }])
  })

  it('filters command-center rows and fields by portal visibility policy', async () => {
    const { filterCompanyCommandCenterForVisibility } = await import('@/lib/crm/visibility-policy')
    const center = {
      company: { id: 'company-1', orgId: 'client-org', name: 'Acme' },
      contacts: [{ id: 'contact-private', visibility: 'private' }, { id: 'contact-visible', visibility: 'client_visible' }],
      documents: [
        { id: 'doc-internal', visibility: 'internal' },
        { id: 'doc-direct-draft', orgId: 'client-org', status: 'internal_draft', currentVersionId: 'version-1' },
        { id: 'doc-direct-visible', orgId: 'client-org', status: 'approved', currentVersionId: 'version-2' },
        {
          id: 'doc-platform-visible',
          orgId: 'pib-platform-owner',
          status: 'client_review',
          currentVersionId: 'version-3',
          linked: { clientOrgId: 'client-org' },
        },
        {
          id: 'doc-platform-other',
          orgId: 'pib-platform-owner',
          status: 'client_review',
          currentVersionId: 'version-4',
          linked: { clientOrgId: 'other-org' },
        },
        { id: 'doc-shared', visibility: 'relationship' },
      ],
      orders: [{ id: 'order-hidden', visibility: 'private' }, { id: 'order-allowed', visibility: 'private', allowedOrgIds: ['client-org'] }],
      relationships: [{
        id: 'rel-1',
        status: 'active',
        sourceCompanyId: 'company-1',
        sharedCapabilities: ['projects', 'documents'],
        fieldSharingPolicy: { contacts: false, documents: true, commerce: true, analytics: false },
      }],
      analytics: { accountValue: 1200, riskSignals: ['1 overdue invoice'] },
      summary: { contacts: 2, documents: 2, orders: 2 },
      deals: [],
      projects: [],
      serviceWorkspaces: [],
      quotes: [],
      invoices: [],
      shipments: [],
      inventoryItems: [],
      activities: [],
    } as unknown as CompanyCommandCenter

    const filtered = filterCompanyCommandCenterForVisibility(center, {
      orgId: 'client-org',
      role: 'viewer',
      isAgent: false,
      actor: { uid: 'client-user', displayName: 'Client User', kind: 'human' },
    })

    expect(filtered.contacts).toEqual([])
    expect(filtered.documents.map((row) => row.id)).toEqual(['doc-direct-visible', 'doc-platform-visible', 'doc-shared'])
    expect(filtered.orders.map((row) => row.id)).toEqual(['order-allowed'])
    expect(filtered.analytics.accountValue).toBeUndefined()
    expect(filtered.summary.contacts).toBe(0)
  })

  it('requires explicit approval before reconciliation apply mode can mutate data', async () => {
    const { POST } = await import('@/app/api/v1/crm/reconcile-links/route')

    const res = await POST(request('POST', '/api/v1/crm/reconcile-links', { mode: 'apply' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/approved/i)
  })

  it('creates order, shipment, inventory movement, audit, notification, and profitability records when a quote is accepted', async () => {
    const created: Record<string, Record<string, unknown>[]> = {}
    const updates: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = []
    mockAdminDbCollection.mockImplementation((name: string) => ({
      add: jest.fn(async (data: Record<string, unknown>) => {
        created[name] ??= []
        created[name].push(data)
        return { id: `${name}-1`, get: async () => ({ data: () => data }) }
      }),
      doc: jest.fn((id: string) => ({
        update: jest.fn(async (patch: Record<string, unknown>) => {
          updates.push({ collection: name, id, patch })
        }),
      })),
    }))
    const { createFulfillmentForAcceptedQuote } = await import('@/lib/commerce/quote-fulfillment')

    const result = await createFulfillmentForAcceptedQuote({
      quoteId: 'quote-1',
      quote: {
        orgId: 'pib-platform-owner',
        sourceOrgId: 'pib-platform-owner',
        recipientOrgId: 'client-org',
        companyId: 'company-1',
        contactId: 'contact-1',
        quoteNumber: 'Q-001',
        status: 'accepted',
        lineItems: [{ description: 'SEO retainer', quantity: 2, unitPrice: 1000, amount: 2000 }],
        subtotal: 2000,
        taxRate: 15,
        taxAmount: 300,
        total: 2300,
        currency: 'ZAR',
        notes: '',
        issueDate: null,
        validUntil: null,
        sentAt: null,
        acceptedAt: null,
        createdBy: 'admin-1',
      },
      actor: { uid: 'admin-1', displayName: 'Admin One', kind: 'human' },
    })

    expect(result.orderId).toBe('orders-1')
    expect(created.orders?.[0]).toEqual(expect.objectContaining({
      quoteId: 'quote-1',
      status: 'confirmed',
      fulfillmentStatus: 'not_started',
      total: 2300,
      grossProfit: 2300,
      grossMargin: 100,
    }))
    expect(created.shipments?.[0]).toEqual(expect.objectContaining({ orderId: 'orders-1', status: 'pending' }))
    expect(created.inventoryMovements?.[0]).toEqual(expect.objectContaining({ quoteId: 'quote-1', orderId: 'orders-1', movementType: 'reserved' }))
    expect(created.crmAuditEvents?.[0]).toEqual(expect.objectContaining({ eventType: 'quote.accepted.fulfillment_created', resourceId: 'quote-1' }))
    expect(created.notifications?.[0]).toEqual(expect.objectContaining({ type: 'crm.quote.accepted.fulfillment_created', orgId: 'pib-platform-owner' }))
    expect(updates).toContainEqual(expect.objectContaining({
      collection: 'quotes',
      id: 'quote-1',
      patch: expect.objectContaining({ fulfillmentOrderId: 'orders-1' }),
    }))
  })

  it('adds cohorts, service profitability, SLA health, collaboration, and portal adoption to the CRM OS dashboard', async () => {
    mockAdminDbCollection.mockImplementation((name: string) => {
      const rows: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {
        companies: [{ id: 'company-1', data: { orgId: 'org-1', lifecycleStage: 'customer', portalLastSeenAt: { seconds: 10 } } }],
        contacts: [{ id: 'contact-1', data: { orgId: 'org-1' } }],
        deals: [{ id: 'deal-1', data: { orgId: 'org-1', value: 1000 } }],
        projects: [{ id: 'project-1', data: { orgId: 'org-1', status: 'blocked', slaDueAt: { seconds: 5 }, updatedAt: { seconds: 1 } } }],
        client_documents: [{ id: 'doc-1', data: { orgId: 'org-1' } }],
        serviceWorkspaces: [{ id: 'svc-1', data: { orgId: 'org-1', serviceType: 'seo', budget: 5000, actualCost: 2000, status: 'active' } }],
        orders: [{ id: 'order-1', data: { orgId: 'org-1', total: 2500, grossProfit: 1200, status: 'in_progress' } }],
        shipments: [{ id: 'shipment-1', data: { orgId: 'org-1', status: 'pending', expectedDeliveryDate: { seconds: 5 } } }],
        inventoryItems: [{ id: 'stock-1', data: { orgId: 'org-1', status: 'low_stock', quantityAvailable: 1, lowStockThreshold: 3 } }],
        invoices: [{ id: 'invoice-1', data: { orgId: 'org-1', status: 'overdue' } }],
        businessRelationships: [{ id: 'rel-1', data: { sourceOrgId: 'org-1', status: 'active', sharedCapabilities: ['projects', 'documents'] } }],
      }
      return collectionFor(rows[name] ?? [])
    })
    const { buildCrmOsDashboard } = await import('@/lib/crm/os-dashboard')

    const dashboard = await buildCrmOsDashboard('org-1')

    expect(dashboard.cohorts.lifecycle.customer).toBe(1)
    expect(dashboard.serviceProfitability.byServiceType.seo.grossProfit).toBe(3000)
    expect(dashboard.slaHealth.blockedProjects).toBe(1)
    expect(dashboard.collaborationActivity.activeRelationships).toBe(1)
    expect(dashboard.portalAdoption.activeCompanies).toBe(1)
  })

  it('exports, imports in dry-run mode, and finds duplicate CRM OS records', async () => {
    mockAdminDbCollection.mockImplementation((name: string) => {
      const rows = name === 'companies'
        ? [
            { id: 'company-1', data: { orgId: 'org-1', name: 'Acme', domain: 'acme.test' } },
            { id: 'company-2', data: { orgId: 'org-1', name: 'Acme ', domain: 'https://acme.test' } },
          ]
        : []
      return collectionFor(rows)
    })
    const route = await import('@/app/api/v1/crm/data-tools/route')

    const exportRes = await route.GET(request('GET', '/api/v1/crm/data-tools?resource=companies&orgId=org-1'))
    expect(exportRes.status).toBe(200)
    expect((await exportRes.json()).data.rows).toHaveLength(2)

    const importRes = await route.POST(request('POST', '/api/v1/crm/data-tools', {
      action: 'import',
      resource: 'companies',
      orgId: 'org-1',
      dryRun: true,
      rows: [{ name: 'New Company', domain: 'new.test' }],
    }))
    expect(importRes.status).toBe(200)
    expect((await importRes.json()).data.createdCount).toBe(0)

    const dedupeRes = await route.POST(request('POST', '/api/v1/crm/data-tools', {
      action: 'dedupe',
      resource: 'companies',
      orgId: 'org-1',
    }))
    expect(dedupeRes.status).toBe(200)
    expect((await dedupeRes.json()).data.duplicateGroups[0].ids).toEqual(['company-1', 'company-2'])
  })
})
