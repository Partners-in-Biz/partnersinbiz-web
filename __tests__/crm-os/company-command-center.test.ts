import type { Company } from '@/lib/companies/types'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1000, nanoseconds: 0 })),
  },
}))

import { adminDb } from '@/lib/firebase/admin'

const mockCollection = adminDb.collection as jest.Mock

type Row = Record<string, unknown>

function doc(id: string, data: Row) {
  return { id, data: () => data }
}

function snap(rows: Array<{ id: string; data: Row }>) {
  return { docs: rows.map((row) => doc(row.id, row.data)), empty: rows.length === 0 }
}

function queryFor(rows: Array<{ id: string; data: Row }>) {
  const makeQuery = (filters: Array<{ field: string; value: unknown }> = [], maxRows?: number): {
    where: jest.Mock
    limit: jest.Mock
    get: jest.Mock
  } => {
    const query = {
      where: jest.fn((field: string, _op: string, value: unknown) => makeQuery([...filters, { field, value }], maxRows)),
      limit: jest.fn((limit: number) => makeQuery(filters, limit)),
      get: jest.fn(async () => {
        const filtered = rows.filter((row) => filters.every((filter) => row.data[filter.field] === filter.value))
        return snap(typeof maxRows === 'number' ? filtered.slice(0, maxRows) : filtered)
      }),
    }
    return query
  }
  return makeQuery()
}

function collectionFor(rows: Array<{ id: string; data: Row }> = []) {
  const query = queryFor(rows)
  return {
    where: query.where,
    limit: query.limit,
    get: query.get,
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const row = rows.find((item) => item.id === id)
        return row ? { exists: true, id, data: () => row.data } : { exists: false, id, data: () => undefined }
      }),
      set: jest.fn(async () => undefined),
      update: jest.fn(async () => undefined),
    })),
    add: jest.fn(async (data: Row) => ({ id: 'created-id', get: async () => ({ data: () => data }) })),
  }
}

function timestamp(seconds: number) {
  return { seconds, toMillis: () => seconds * 1000 }
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    orgId: 'org-1',
    name: 'Acme',
    linkedOrgId: 'client-org',
    tags: [],
    notes: '',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('CRM OS company command center foundations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lists company projects by company fields and linked org fields without composite-index query chains', async () => {
    const projectsCollection = collectionFor([
      { id: 'by-company', data: { orgId: 'org-1', companyId: 'company-1', name: 'By Company', createdAt: timestamp(10) } },
      { id: 'by-source', data: { orgId: 'org-1', sourceCompanyId: 'company-1', name: 'By Source', createdAt: timestamp(20) } },
      { id: 'by-recipient', data: { orgId: 'org-1', recipientOrgId: 'client-org', name: 'By Recipient', createdAt: timestamp(30) } },
      { id: 'by-relationship', data: { orgId: 'org-1', relationshipId: 'rel-1', name: 'By Relationship', createdAt: timestamp(35) } },
      { id: 'other', data: { orgId: 'org-1', companyId: 'other-company', name: 'Other', createdAt: timestamp(40) } },
    ])
    const relationshipsCollection = collectionFor([
      { id: 'rel-1', data: { sourceOrgId: 'org-1', sourceCompanyId: 'company-1', targetOrgId: 'client-org', status: 'active' } },
      { id: 'rel-paused', data: { sourceOrgId: 'org-1', sourceCompanyId: 'company-1', targetOrgId: 'other-org', status: 'paused' } },
    ])
    mockCollection.mockImplementation((name: string) => {
      if (name === 'projects') return projectsCollection
      if (name === 'businessRelationships') return relationshipsCollection
      return collectionFor()
    })

    const { listCompanyProjects } = await import('@/lib/companies/command-center')
    const projects = await listCompanyProjects(company(), { limit: 10 })

    expect(projects.map((project) => project.id)).toEqual(['by-relationship', 'by-recipient', 'by-source', 'by-company'])
    expect(projectsCollection.where).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(projectsCollection.where).toHaveBeenCalledTimes(1)
    expect(relationshipsCollection.where).toHaveBeenCalledWith('sourceOrgId', '==', 'org-1')
    expect(relationshipsCollection.where).toHaveBeenCalledTimes(1)
  })

  it('lists company documents across platform, linked client, and reciprocal supplier relationships', async () => {
    const clientDocumentsCollection = collectionFor([
      {
        id: 'platform-linked',
        data: {
          orgId: 'pib-platform-owner',
          linked: { companyId: 'platform-company', clientOrgId: 'client-org' },
          title: 'Platform proposal',
          status: 'client_review',
          updatedAt: timestamp(20),
        },
      },
      {
        id: 'direct-client',
        data: {
          orgId: 'client-org',
          linked: { companyId: 'platform-company', clientOrgId: 'client-org' },
          title: 'Direct client proposal',
          status: 'internal_draft',
          updatedAt: timestamp(30),
        },
      },
      {
        id: 'other-client',
        data: {
          orgId: 'other-org',
          linked: { companyId: 'other-company', clientOrgId: 'other-org' },
          title: 'Other proposal',
          status: 'client_review',
          updatedAt: timestamp(40),
        },
      },
    ])
    const relationshipsCollection = collectionFor([
      {
        id: 'rel-platform-client',
        data: {
          sourceOrgId: 'pib-platform-owner',
          sourceCompanyId: 'platform-company',
          targetOrgId: 'client-org',
          targetCompanyId: 'supplier-company',
          status: 'active',
        },
      },
      {
        id: 'rel-client-platform',
        data: {
          sourceOrgId: 'client-org',
          sourceCompanyId: 'supplier-company',
          targetOrgId: 'pib-platform-owner',
          targetCompanyId: 'platform-company',
          status: 'active',
        },
      },
    ])
    mockCollection.mockImplementation((name: string) => {
      if (name === 'client_documents') return clientDocumentsCollection
      if (name === 'businessRelationships') return relationshipsCollection
      return collectionFor()
    })

    const { listCompanyDocuments } = await import('@/lib/companies/command-center')

    const platformDocs = await listCompanyDocuments(company({
      id: 'platform-company',
      orgId: 'pib-platform-owner',
      linkedOrgId: 'client-org',
    }), { limit: 10 })
    const supplierDocs = await listCompanyDocuments(company({
      id: 'supplier-company',
      orgId: 'client-org',
      linkedOrgId: 'pib-platform-owner',
    }), { limit: 10 })

    expect(platformDocs.map((doc) => doc.id)).toEqual(['direct-client', 'platform-linked'])
    expect(supplierDocs.map((doc) => doc.id)).toEqual(['direct-client', 'platform-linked'])
  })

  it('lists company-only documents for CRM companies that are not linked to a system organisation', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'client_documents') return collectionFor([
        {
          id: 'plain-company-doc',
          data: {
            orgId: 'pib-platform-owner',
            linked: { companyId: 'company-plain' },
            title: 'Standalone CRM proposal',
            status: 'internal_review',
            updatedAt: timestamp(10),
          },
        },
        {
          id: 'other-doc',
          data: {
            orgId: 'pib-platform-owner',
            linked: { companyId: 'other-company' },
            title: 'Other proposal',
            status: 'internal_review',
            updatedAt: timestamp(20),
          },
        },
      ])
      if (name === 'businessRelationships') return collectionFor()
      return collectionFor()
    })

    const { listCompanyDocuments } = await import('@/lib/companies/command-center')
    const docs = await listCompanyDocuments(company({
      id: 'company-plain',
      orgId: 'pib-platform-owner',
      linkedOrgId: undefined,
    }), { limit: 10 })

    expect(docs.map((doc) => doc.id)).toEqual(['plain-company-doc'])
  })

  it('builds a command center with CRM, delivery, commerce, relationship, and analytics rollups', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'projects') return collectionFor([
        { id: 'project-1', data: { orgId: 'org-1', companyId: 'company-1', name: 'SEO Sprint', status: 'active', createdAt: timestamp(20) } },
      ])
      if (name === 'client_documents') return collectionFor([
        { id: 'doc-1', data: { orgId: 'org-1', companyId: 'company-1', title: 'Proposal', status: 'client_review', updatedAt: timestamp(25) } },
      ])
      if (name === 'serviceWorkspaces') return collectionFor([
        { id: 'svc-1', data: { orgId: 'org-1', companyId: 'company-1', name: 'SEO', status: 'active', serviceType: 'seo' } },
      ])
      if (name === 'orders') return collectionFor([
        { id: 'order-1', data: { orgId: 'org-1', companyId: 'company-1', status: 'in_progress', total: 1200, currency: 'ZAR' } },
      ])
      if (name === 'shipments') return collectionFor([
        { id: 'ship-1', data: { orgId: 'org-1', companyId: 'company-1', status: 'in_transit' } },
      ])
      if (name === 'inventoryItems') return collectionFor([
        { id: 'stock-1', data: { orgId: 'org-1', companyId: 'company-1', quantityAvailable: 4, lowStockThreshold: 5 } },
      ])
      if (name === 'businessRelationships') return collectionFor([
        { id: 'rel-1', data: { sourceOrgId: 'org-1', sourceCompanyId: 'company-1', targetOrgId: 'client-org', status: 'active' } },
      ])
      if (name === 'contacts') return collectionFor([
        { id: 'contact-1', data: { orgId: 'org-1', companyId: 'company-1', name: 'Alex' } },
      ])
      if (name === 'deals') return collectionFor([
        { id: 'deal-1', data: { orgId: 'org-1', companyId: 'company-1', value: 2500, probability: 50 } },
      ])
      if (name === 'quotes') return collectionFor([
        { id: 'quote-1', data: { orgId: 'org-1', companyId: 'company-1', total: 1200 } },
      ])
      if (name === 'invoices') return collectionFor([
        { id: 'invoice-1', data: { orgId: 'org-1', companyId: 'company-1', status: 'overdue', total: 400 } },
      ])
      if (name === 'activities') return collectionFor([
        { id: 'activity-1', data: { orgId: 'org-1', companyId: 'company-1', type: 'note' } },
      ])
      return collectionFor()
    })

    const { buildCompanyCommandCenter } = await import('@/lib/companies/command-center')
    const center = await buildCompanyCommandCenter(company(), { limit: 10 })

    expect(center.summary.projects).toBe(1)
    expect(center.summary.serviceWorkspaces).toBe(1)
    expect(center.summary.openOrders).toBe(1)
    expect(center.summary.lowStockItems).toBe(1)
    expect(center.summary.overdueInvoices).toBe(1)
    expect(center.analytics.accountValue).toBe(3700)
    expect(center.projects[0].name).toBe('SEO Sprint')
    expect(center.documents[0].title).toBe('Proposal')
    expect(center.relationships[0].id).toBe('rel-1')
  })
})
