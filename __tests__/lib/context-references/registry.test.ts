export {}

import { contextReferenceTypeFrom } from '@/lib/context-references/types'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: jest.fn(async (projectId: string) => ({
    ok: true,
    doc: {
      id: projectId,
      data: () => ({
        orgId: 'org-1',
        name: 'Launch Project',
        status: 'development',
        description: 'Build the launch project workspace.',
      }),
    },
    projectAccess: null,
  })),
}))

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, exists: true }
}

type MockDoc = ReturnType<typeof doc>
type MissingDoc = { id: string; exists: false; data: () => Record<string, never> }
interface MockDocHandle {
  get: jest.Mock<Promise<MockDoc | MissingDoc>, []>
  collection: jest.Mock<MockQuery, [string]>
}

interface MockQuery {
  where: jest.Mock<MockQuery, [string, string, string]>
  limit: jest.Mock<MockQuery, [number]>
  get: jest.Mock<Promise<{ docs: MockDoc[] }>, []>
  doc: jest.Mock<MockDocHandle, [string]>
}

function queryFor(docs: MockDoc[]): MockQuery {
  const query = {} as MockQuery
  query.where = jest.fn<MockQuery, [string, string, string]>(() => query)
  query.limit = jest.fn<MockQuery, [number]>(() => query)
  query.get = jest.fn<Promise<{ docs: MockDoc[] }>, []>(async () => ({ docs }))
  query.doc = jest.fn<MockDocHandle, [string]>((id: string) => ({
    get: jest.fn<Promise<MockDoc | MissingDoc>, []>(async () => docs.find((item) => item.id === id) ?? { id, exists: false, data: () => ({}) }),
    collection: jest.fn<MockQuery, [string]>(() => queryFor([])),
  }))
  return query
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockImplementation((name: string) => {
    if (name === 'contacts') {
      return queryFor([
        doc('contact-1', {
          orgId: 'org-1',
          name: 'Jane Client',
          email: 'jane@example.com',
          company: 'Client Co',
          notes: 'Interested in launch planning.',
          deleted: false,
        }),
        doc('other-contact', {
          orgId: 'org-2',
          name: 'Blocked Contact',
          email: 'blocked@example.com',
          deleted: false,
        }),
      ])
    }
    if (name === 'companies') {
      return queryFor([
        doc('company-1', {
          orgId: 'org-1',
          name: 'Elemental',
          lifecycleStage: 'customer',
          tags: [],
          notes: '',
          deleted: false,
        }),
      ])
    }
    if (name === 'client_documents') {
      return queryFor([
        doc('doc-1', {
          orgId: 'org-1',
          title: 'Elemental Sustainability — Digital Growth Partnership — May 2026',
          type: 'sales_proposal',
          status: 'client_review',
          linked: { companyId: 'company-1' },
          deleted: false,
        }),
        doc('doc-2', {
          orgId: 'org-1',
          title: 'Unrelated Product Spec',
          type: 'build_spec',
          status: 'internal_draft',
          linked: {},
          deleted: false,
        }),
      ])
    }
    if (name === 'businessRelationships') {
      return queryFor([])
    }
    if (name === 'research_items') {
      return queryFor([
        doc('research-1', {
          orgId: 'org-1',
          title: 'Internal Research',
          summary: 'Internal-only evidence.',
          visibility: 'internal',
          deleted: false,
        }),
      ])
    }
    if (name === 'products') {
      return queryFor([
        doc('product-1', {
          orgId: 'org-1',
          name: 'Growth Retainer',
          description: 'Monthly growth support package.',
          unitPrice: 15000,
          currency: 'ZAR',
          unit: 'month',
          sku: 'GR-001',
          active: true,
          deleted: false,
        }),
        doc('other-product', {
          orgId: 'org-2',
          name: 'Blocked Product',
          unitPrice: 1,
          currency: 'ZAR',
          deleted: false,
        }),
      ])
    }
    if (name === 'deals') {
      return queryFor([
        doc('deal-1', {
          orgId: 'org-1',
          title: 'Website expansion deal',
          stage: 'proposal',
          value: 25000,
          currency: 'ZAR',
          contactName: 'Jane Client',
          deleted: false,
        }),
      ])
    }
    if (name === 'invoices') {
      return queryFor([
        doc('invoice-1', {
          orgId: 'org-1',
          invoiceNumber: 'INV-1001',
          clientName: 'Elemental',
          status: 'sent',
          total: 18000,
          currency: 'ZAR',
          deleted: false,
        }),
      ])
    }
    if (name === 'properties') {
      return queryFor([
        doc('property-1', {
          orgId: 'org-1',
          name: 'Sunset Villa',
          address: '42 Ocean Road',
          status: 'active',
          deleted: false,
        }),
      ])
    }
    if (name === 'workspace_artifacts') {
      return queryFor([
        doc('artifact-1', {
          orgId: 'org-1',
          title: 'Phase 2 broker plan',
          artifactType: 'google_doc',
          projectId: 'project-1',
          visibility: 'admin_agents',
          lifecycleStatus: 'internal_review',
          google: { url: 'https://docs.google.com/document/d/doc-1/edit' },
          deleted: false,
        }),
      ])
    }
    if (name === 'workspace_connections') {
      return queryFor([
        doc('connection-1', {
          orgId: 'org-1',
          displayName: 'Parent Google Workspace',
          provider: 'google_workspace',
          connectionType: 'user_oauth',
          status: 'active',
          tokenStatus: 'connected',
          deleted: false,
        }),
      ])
    }
    if (name === 'workspace_broker_jobs') {
      return queryFor([
        doc('job-1', {
          orgId: 'org-1',
          operation: 'create_doc',
          status: 'awaiting_approval',
          input: { title: 'Client-facing brief' },
          requiredCapability: 'write',
          deleted: false,
        }),
      ])
    }
    if (name === 'projects') {
      return {
        ...queryFor([]),
        doc: jest.fn((id: string) => ({
          get: jest.fn(async () => doc(id, { orgId: 'org-1', name: 'Launch Project' })),
          collection: jest.fn((subcollection: string) => {
            if (subcollection !== 'tasks') return queryFor([])
            return queryFor([
              doc('task-1', {
                orgId: 'org-1',
                projectId: id,
                title: 'Confirm launch scope',
                description: 'Review client requirements before handoff.',
                priority: 'high',
                deleted: false,
              }),
            ])
          }),
        })),
      }
    }
    return queryFor([])
  })
})

describe('context reference registry', () => {
  it('resolves exact references into compact context with ids and labels', async () => {
    const { resolveContextReferences, buildAttachedContextBlock } = await import('@/lib/context-references/registry')

    const refs = await resolveContextReferences([
      { type: 'project', id: 'project-1', orgId: 'org-1', origin: 'current_page' },
      { type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
    ], {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'session',
    })

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project', summary: expect.stringContaining('development') }),
      expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client', summary: expect.stringContaining('jane@example.com') }),
    ]))
    expect(buildAttachedContextBlock(refs)).toContain('[Attached context]')
    expect(buildAttachedContextBlock(refs)).toContain('project: Launch Project')
    expect(buildAttachedContextBlock(refs)).toContain('id: project-1')
  })

  it('searches only references visible to the caller and hides internal research from clients', async () => {
    const { searchContextReferences } = await import('@/lib/context-references/registry')

    await expect(searchContextReferences({
      type: 'research',
      query: 'internal',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' },
    })).resolves.toEqual([])

    await expect(searchContextReferences({
      type: 'contact',
      query: 'jane',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' },
    })).resolves.toEqual([
      expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' }),
    ])
  })

  it('searches project-scoped tasks when a projectId is supplied', async () => {
    const { searchContextReferences } = await import('@/lib/context-references/registry')

    await expect(searchContextReferences({
      type: 'task',
      projectId: 'project-1',
      query: 'scope',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'admin-1', role: 'admin', authKind: 'session' },
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'task',
        id: 'task-1',
        label: 'Confirm launch scope',
        metadata: { projectId: 'project-1' },
      }),
    ])
  })

  it('resolves and searches CRM product references', async () => {
    const { resolveContextReferences, searchContextReferences } = await import('@/lib/context-references/registry')
    const productType = contextReferenceTypeFrom('products')

    expect(productType).toBe('product')
    if (!productType) throw new Error('products context reference type is missing')

    await expect(resolveContextReferences([
      { type: 'products', id: 'product-1', orgId: 'org-1', origin: 'mention' },
    ], {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'session',
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'product',
        id: 'product-1',
        label: 'Growth Retainer',
        summary: expect.stringContaining('ZAR'),
      }),
    ])

    await expect(searchContextReferences({
      type: productType,
      query: 'retainer',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'admin-1', role: 'admin', authKind: 'session' },
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'product',
        id: 'product-1',
        label: 'Growth Retainer',
      }),
    ])
  })

  it('searches company-linked documents when the current page context is a company', async () => {
    const { searchContextReferences } = await import('@/lib/context-references/registry')

    await expect(searchContextReferences({
      type: 'document',
      query: 'elemental',
      orgId: 'org-1',
      contextType: 'company',
      contextId: 'company-1',
      limit: 8,
      user: { uid: 'admin-1', role: 'admin', authKind: 'session' },
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'document',
        id: 'doc-1',
        label: 'Elemental Sustainability — Digital Growth Partnership — May 2026',
        summary: expect.stringContaining('client_review'),
      }),
    ])
  })

  it('makes operational records and Workspace OS artifacts usable as chat context references', async () => {
    const { resolveContextReferences, searchContextReferences, buildAttachedContextBlock } = await import('@/lib/context-references/registry')
    const user = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }

    expect(contextReferenceTypeFrom('deals')).toBe('deal')
    expect(contextReferenceTypeFrom('invoice')).toBe('invoice')
    expect(contextReferenceTypeFrom('workspace artifacts')).toBe('workspace_artifact')
    expect(contextReferenceTypeFrom('broker jobs')).toBe('workspace_broker_job')

    await expect(searchContextReferences({ type: 'deal', query: 'expansion', orgId: 'org-1', limit: 8, user })).resolves.toEqual([
      expect.objectContaining({ type: 'deal', id: 'deal-1', label: 'Website expansion deal', summary: expect.stringContaining('proposal') }),
    ])
    await expect(searchContextReferences({ type: 'workspace_artifact', query: 'phase 2', orgId: 'org-1', limit: 8, user })).resolves.toEqual([
      expect.objectContaining({ type: 'workspace_artifact', id: 'artifact-1', label: 'Phase 2 broker plan', href: '/admin/workspace/artifacts/artifact-1' }),
    ])

    const refs = await resolveContextReferences([
      { type: 'invoice', id: 'invoice-1', orgId: 'org-1' },
      { type: 'property', id: 'property-1', orgId: 'org-1' },
      { type: 'workspace_connection', id: 'connection-1', orgId: 'org-1' },
      { type: 'workspace_broker_job', id: 'job-1', orgId: 'org-1' },
    ], user)

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'invoice', label: 'INV-1001' }),
      expect.objectContaining({ type: 'property', label: 'Sunset Villa' }),
      expect.objectContaining({ type: 'workspace_connection', label: 'Parent Google Workspace' }),
      expect.objectContaining({ type: 'workspace_broker_job', label: 'create_doc' }),
    ]))
    expect(buildAttachedContextBlock(refs)).toContain('workspace_broker_job: create_doc')
  })
})
