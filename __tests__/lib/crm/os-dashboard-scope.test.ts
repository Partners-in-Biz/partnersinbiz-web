import { FULL_ACCESS_POLICY } from '@/lib/orgMembers/access-policy'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

const mockCollection = jest.fn()
const mockFilterProjectsForMemberScope = jest.fn(async (_user: unknown, projects: unknown[]) => projects)
const mockFilterBillingRecordsForCrmActor = jest.fn(async (_ctx: unknown, rows: unknown[]) => rows)

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

jest.mock('@/lib/projects/collaboration', () => ({
  filterProjectsForMemberScope: (...args: unknown[]) => mockFilterProjectsForMemberScope(...args),
}))

jest.mock('@/lib/billing/crm-record-scope', () => {
  const actual = jest.requireActual('@/lib/billing/crm-record-scope')
  return {
    ...actual,
    filterBillingRecordsForCrmActor: (...args: unknown[]) => mockFilterBillingRecordsForCrmActor(...args),
  }
})

function collectionFor(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: rows.map((row) => ({
        id: row.id,
        data: () => row.data,
      })),
    }),
    doc: jest.fn((id: string) => ({
      get: jest.fn().mockResolvedValue({
        exists: byId.has(id),
        id,
        data: () => byId.get(id)?.data,
      }),
    })),
  }
}

function scopedCtx(overrides?: Partial<CrmAuthContext>): CrmAuthContext {
  return {
    orgId: 'org-1',
    uid: 'member-1',
    actor: { uid: 'member-1', displayName: 'Member', kind: 'human' },
    role: 'member',
    isAgent: false,
    permissions: {},
    accessPolicy: {
      preset: 'crm_sales',
      modules: { ...FULL_ACCESS_POLICY.modules, crm: true, projects: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    },
    user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    ...overrides,
  }
}

describe('buildCrmOsDashboard owned_or_linked scope', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockFilterProjectsForMemberScope.mockImplementation(async (_user, projects) => projects)
    mockFilterBillingRecordsForCrmActor.mockImplementation(async (_ctx, rows) => rows)
  })

  it('filters companies/contacts/orders/relationships down to the actor book', async () => {
    mockCollection.mockImplementation((name: string) => {
      const rows: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {
        companies: [
          { id: 'mine', data: { orgId: 'org-1', name: 'Mine', assignedTo: 'member-1', lifecycleStage: 'customer' } },
          { id: 'theirs', data: { orgId: 'org-1', name: 'Theirs', assignedTo: 'other', lifecycleStage: 'lead' } },
        ],
        contacts: [
          { id: 'c-mine', data: { orgId: 'org-1', assignedTo: 'member-1', companyId: 'mine' } },
          { id: 'c-theirs', data: { orgId: 'org-1', assignedTo: 'other', companyId: 'theirs' } },
        ],
        deals: [
          { id: 'd-mine', data: { orgId: 'org-1', companyId: 'mine', value: 100 } },
          { id: 'd-theirs', data: { orgId: 'org-1', companyId: 'theirs', value: 900 } },
        ],
        projects: [{ id: 'p1', data: { orgId: 'org-1', status: 'active' } }],
        client_documents: [],
        serviceWorkspaces: [],
        orders: [
          { id: 'o-mine', data: { orgId: 'org-1', companyId: 'mine', total: 50, status: 'open' } },
          { id: 'o-theirs', data: { orgId: 'org-1', companyId: 'theirs', total: 500, status: 'open' } },
        ],
        shipments: [],
        inventoryItems: [],
        invoices: [],
        businessRelationships: [
          { id: 'r-mine', data: { sourceOrgId: 'org-1', sourceCompanyId: 'mine', status: 'active', sharedCapabilities: ['projects'] } },
          { id: 'r-theirs', data: { sourceOrgId: 'org-1', sourceCompanyId: 'theirs', status: 'active', sharedCapabilities: ['documents'] } },
        ],
      }
      return collectionFor(rows[name] ?? [])
    })

    mockFilterProjectsForMemberScope.mockResolvedValue([{ id: 'p1', orgId: 'org-1', status: 'active' }])
    mockFilterBillingRecordsForCrmActor.mockResolvedValue([])

    const { buildCrmOsDashboard } = await import('@/lib/crm/os-dashboard')
    const dashboard = await buildCrmOsDashboard('org-1', scopedCtx())

    expect(dashboard.summary.companies).toBe(1)
    expect(dashboard.summary.contacts).toBe(1)
    expect(dashboard.summary.deals).toBe(1)
    expect(dashboard.summary.orders).toBe(1)
    expect(dashboard.summary.pipelineValue).toBe(100)
    expect(dashboard.summary.orderValue).toBe(50)
    expect(dashboard.summary.activeRelationships).toBe(1)
    expect(dashboard.cohorts.lifecycle.customer).toBe(1)
    expect(dashboard.cohorts.lifecycle.lead).toBeUndefined()
  })
})
