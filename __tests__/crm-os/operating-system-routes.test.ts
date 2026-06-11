import { NextRequest } from 'next/server'

type MockCrmContext = {
  orgId: string
  actor: { uid: string; displayName: string; kind: 'human' | 'agent' }
  role: 'viewer' | 'member' | 'admin' | 'owner' | 'system'
  isAgent: boolean
  permissions: Record<string, unknown>
  user: { uid: string; role?: string; orgId?: string }
}

const mockLoadCompany = jest.fn()
const mockBuildCompanyCommandCenter = jest.fn()
const mockListCompanyProjects = jest.fn()
const mockListRelationships = jest.fn()
const mockCreateRelationship = jest.fn()
const mockUpdateRelationship = jest.fn()
const mockListServiceWorkspaces = jest.fn()
const mockCreateServiceWorkspace = jest.fn()
const mockUpdateServiceWorkspace = jest.fn()
const mockListOrders = jest.fn()
const mockCreateOrder = jest.fn()
const mockUpdateOrder = jest.fn()
const mockListShipments = jest.fn()
const mockCreateShipment = jest.fn()
const mockUpdateShipment = jest.fn()
const mockListInventoryItems = jest.fn()
const mockCreateInventoryItem = jest.fn()
const mockUpdateInventoryItem = jest.fn()
const mockReconcileLinks = jest.fn()
const mockBuildCrmOsDashboard = jest.fn()
const mockGuardAgentAction = jest.fn()

let mockCtx: MockCrmContext = {
  orgId: 'org-1',
  actor: { uid: 'user-1', displayName: 'User One', kind: 'human' },
  role: 'admin',
  isAgent: false,
  permissions: {},
  user: { uid: 'user-1', role: 'client', orgId: 'org-1' },
}

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: (req: NextRequest, ctx: MockCrmContext, routeCtx?: unknown) => Promise<Response>) =>
    async (req: NextRequest, routeCtx?: unknown) => handler(req, mockCtx, routeCtx),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: { uid: string; role: string; orgId: string }) => Promise<Response>) =>
    async (req: NextRequest) => handler(req, { uid: mockCtx.user.uid, role: mockCtx.user.role ?? 'client', orgId: mockCtx.orgId }),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: (...args: unknown[]) => mockLoadCompany(...args),
}))

jest.mock('@/lib/companies/command-center', () => ({
  buildCompanyCommandCenter: (...args: unknown[]) => mockBuildCompanyCommandCenter(...args),
  listCompanyProjects: (...args: unknown[]) => mockListCompanyProjects(...args),
}), { virtual: true })

jest.mock('@/lib/business-relationships/store', () => ({
  listBusinessRelationships: (...args: unknown[]) => mockListRelationships(...args),
  createBusinessRelationship: (...args: unknown[]) => mockCreateRelationship(...args),
  updateBusinessRelationship: (...args: unknown[]) => mockUpdateRelationship(...args),
}), { virtual: true })

jest.mock('@/lib/service-workspaces/store', () => ({
  listServiceWorkspaces: (...args: unknown[]) => mockListServiceWorkspaces(...args),
  createServiceWorkspace: (...args: unknown[]) => mockCreateServiceWorkspace(...args),
  updateServiceWorkspace: (...args: unknown[]) => mockUpdateServiceWorkspace(...args),
}), { virtual: true })

jest.mock('@/lib/commerce/store', () => ({
  listOrders: (...args: unknown[]) => mockListOrders(...args),
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
  updateOrder: (...args: unknown[]) => mockUpdateOrder(...args),
  listShipments: (...args: unknown[]) => mockListShipments(...args),
  createShipment: (...args: unknown[]) => mockCreateShipment(...args),
  updateShipment: (...args: unknown[]) => mockUpdateShipment(...args),
  listInventoryItems: (...args: unknown[]) => mockListInventoryItems(...args),
  createInventoryItem: (...args: unknown[]) => mockCreateInventoryItem(...args),
  updateInventoryItem: (...args: unknown[]) => mockUpdateInventoryItem(...args),
}), { virtual: true })

jest.mock('@/lib/crm/reconcile-links', () => ({
  reconcileCrmLinks: (...args: unknown[]) => mockReconcileLinks(...args),
}))

jest.mock('@/lib/crm/os-dashboard', () => ({
  buildCrmOsDashboard: (...args: unknown[]) => mockBuildCrmOsDashboard(...args),
}), { virtual: true })

jest.mock('@/lib/agents/action-guard', () => ({
  guardAgentCrmAction: (...args: unknown[]) => mockGuardAgentAction(...args),
}), { virtual: true })

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

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx = {
    orgId: 'org-1',
    actor: { uid: 'user-1', displayName: 'User One', kind: 'human' },
    role: 'admin',
    isAgent: false,
    permissions: {},
    user: { uid: 'user-1', role: 'client', orgId: 'org-1' },
  }
  mockLoadCompany.mockResolvedValue({ data: { id: 'company-1', orgId: 'org-1', name: 'Acme' } })
  mockGuardAgentAction.mockReturnValue({ allowed: true, approvalRequired: false })
})

describe('CRM OS route contracts', () => {
  it('returns a company command-center aggregate', async () => {
    mockBuildCompanyCommandCenter.mockResolvedValue({
      summary: { projects: 1 },
      projects: [{ id: 'project-1' }],
      invoices: [],
    })
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/command-center/route')

    const res = await GET(request('GET', '/api/v1/crm/companies/company-1/command-center'), routeCtx())

    expect(res.status).toBe(200)
    expect(mockBuildCompanyCommandCenter).toHaveBeenCalledWith(
      { id: 'company-1', orgId: 'org-1', name: 'Acme' },
      expect.objectContaining({ limit: 50 }),
    )
    expect((await res.json()).data.summary.projects).toBe(1)
  })

  it('returns company-scoped projects from the dedicated endpoint', async () => {
    mockListCompanyProjects.mockResolvedValue([{ id: 'project-1', name: 'Launch' }])
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/projects/route')

    const res = await GET(request('GET', '/api/v1/crm/companies/company-1/projects?limit=10'), routeCtx())

    expect(res.status).toBe(200)
    expect(mockListCompanyProjects).toHaveBeenCalledWith(
      { id: 'company-1', orgId: 'org-1', name: 'Acme' },
      expect.objectContaining({ limit: 10 }),
    )
    expect((await res.json()).data.projects).toEqual([{ id: 'project-1', name: 'Launch' }])
  })

  it('creates and updates explicit business relationships', async () => {
    mockCreateRelationship.mockResolvedValue({ id: 'rel-1', status: 'active' })
    mockUpdateRelationship.mockResolvedValue({ id: 'rel-1', status: 'paused' })
    const relationships = await import('@/app/api/v1/crm/relationships/route')

    const createRes = await relationships.POST(request('POST', '/api/v1/crm/relationships', {
      sourceCompanyId: 'company-1',
      targetOrgId: 'client-org',
      relationshipType: 'supplier',
      sharedCapabilities: ['projects', 'documents'],
    }))
    expect(createRes.status).toBe(201)
    expect(mockCreateRelationship).toHaveBeenCalledWith('org-1', expect.objectContaining({ relationshipType: 'supplier' }), mockCtx.actor)

    const updateRes = await relationships.PATCH(request('PATCH', '/api/v1/crm/relationships?id=rel-1', { status: 'paused' }))
    expect(updateRes.status).toBe(200)
    expect(mockUpdateRelationship).toHaveBeenCalledWith('org-1', 'rel-1', { status: 'paused' }, mockCtx.actor)
  })

  it('blocks agent-created client-visible service workspace changes without approval', async () => {
    mockCtx.isAgent = true
    mockCtx.actor = { uid: 'agent:pip', displayName: 'Pip', kind: 'agent' }
    mockCtx.role = 'system'
    mockGuardAgentAction.mockReturnValue({ allowed: false, approvalRequired: true, reason: 'Approval required' })
    const serviceWorkspaces = await import('@/app/api/v1/service-workspaces/route')

    const res = await serviceWorkspaces.POST(request('POST', '/api/v1/service-workspaces', {
      companyId: 'company-1',
      name: 'SEO Sprint',
      serviceType: 'seo',
      visibility: 'client_visible',
    }))

    expect(res.status).toBe(202)
    expect((await res.json()).data.approvalRequired).toBe(true)
    expect(mockCreateServiceWorkspace).not.toHaveBeenCalled()
  })

  it('exposes ERP-lite order, shipment, and inventory route contracts', async () => {
    mockCreateOrder.mockResolvedValue({ id: 'order-1', status: 'draft' })
    mockCreateShipment.mockResolvedValue({ id: 'shipment-1', status: 'pending' })
    mockCreateInventoryItem.mockResolvedValue({ id: 'stock-1', sku: 'SEO-PLAN' })

    const orders = await import('@/app/api/v1/orders/route')
    const shipments = await import('@/app/api/v1/shipments/route')
    const inventory = await import('@/app/api/v1/inventory-items/route')

    expect((await orders.POST(request('POST', '/api/v1/orders', { companyId: 'company-1', title: 'Delivery', total: 100 }))).status).toBe(201)
    expect((await shipments.POST(request('POST', '/api/v1/shipments', { companyId: 'company-1', orderId: 'order-1', status: 'pending' }))).status).toBe(201)
    expect((await inventory.POST(request('POST', '/api/v1/inventory-items', { name: 'SEO Hours', sku: 'SEO-PLAN', quantityAvailable: 10 }))).status).toBe(201)
  })

  it('runs CRM link reconciliation in dry-run mode by default', async () => {
    mockReconcileLinks.mockResolvedValue({ mode: 'dry-run', proposedLinks: [{ resourceType: 'project', resourceId: 'project-1' }] })
    const { POST } = await import('@/app/api/v1/crm/reconcile-links/route')

    const res = await POST(request('POST', '/api/v1/crm/reconcile-links', {}))

    expect(res.status).toBe(200)
    expect(mockReconcileLinks).toHaveBeenCalledWith('org-1', expect.objectContaining({ mode: 'dry-run' }), mockCtx.actor)
    expect((await res.json()).data.proposedLinks).toHaveLength(1)
  })

  it('returns the CRM operating-system dashboard rollup', async () => {
    mockBuildCrmOsDashboard.mockResolvedValue({ summary: { companies: 4, activeRelationships: 2 } })
    const { GET } = await import('@/app/api/v1/crm/os-dashboard/route')

    const res = await GET(request('GET', '/api/v1/crm/os-dashboard'))

    expect(res.status).toBe(200)
    expect(mockBuildCrmOsDashboard).toHaveBeenCalledWith('org-1')
    expect((await res.json()).data.summary.companies).toBe(4)
  })
})
