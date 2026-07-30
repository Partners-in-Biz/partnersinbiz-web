export {}

import { contextReferenceTypeFrom } from '@/lib/context-references/types'

const mockCollection = jest.fn()
const mockGetProjectForUser = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

beforeEach(() => {
  mockGetProjectForUser.mockImplementation(async (projectId: string) => ({
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
  }))
})

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
  let maxDocs = docs.length
  query.where = jest.fn<MockQuery, [string, string, string]>(() => query)
  query.limit = jest.fn<MockQuery, [number]>((limit: number) => {
    maxDocs = limit
    return query
  })
  query.get = jest.fn<Promise<{ docs: MockDoc[] }>, []>(async () => ({ docs: docs.slice(0, maxDocs) }))
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
          companyId: 'company-1',
          stage: 'contacted',
          type: 'prospect',
          leadScore: 72,
          lastContactedAt: '2026-07-20T09:00:00.000Z',
          updatedAt: '2026-07-20T10:00:00.000Z',
          notes: 'Interested in launch planning.',
          deleted: false,
        }),
        ...Array.from({ length: 90 }, (_, index) => doc(`contact-filler-${index}`, {
          orgId: 'org-1',
          name: `Filler Contact ${index}`,
          email: `filler-${index}@example.com`,
          deleted: false,
        })),
        doc('contact-split-name', {
          orgId: 'org-1',
          firstName: 'Pieter',
          lastName: 'Goosen',
          email: 'pieter.goosen@example.com',
          company: 'Prospect Co',
          type: 'prospect',
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
          industry: 'Technology',
          healthScore: 88,
          updatedAt: '2026-07-20T10:30:00.000Z',
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
    if (name === 'quotes') {
      return queryFor([
        doc('received-quote', {
          orgId: 'sender-org',
          sourceOrgId: 'sender-org',
          recipientOrgId: 'recipient-org',
          quoteNumber: 'Q-REC-001',
          status: 'sent',
          total: 12000,
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
    if (name === 'organizations') {
      return queryFor([
        doc('org-1', { name: 'Elemental', slug: 'elemental', settings: { portalModules: { bookStudio: true } } }),
        doc('org-2', { name: 'Blocked Org', settings: {} }),
        doc('org-3', { name: 'Portal Disabled', slug: 'portal-disabled', settings: { portalModules: { bookStudio: false } } }),
      ])
    }
    if (name === 'creative_canvases') {
      return queryFor([
        ...Array.from({ length: 9 }, (_, index) => doc(`archived-${index}`, { orgId: 'org-1', title: `Launch archived ${index}`, archived: true })),
        doc('canvas-1', {
          orgId: 'org-1',
          title: 'Launch campaign canvas',
          status: 'ready',
          secretPrompt: 'never expose this',
          deleted: false,
        }),
        doc('canvas-archived', { orgId: 'org-1', title: 'Old canvas', archived: true }),
        doc('canvas-cross-org', { orgId: 'org-2', title: 'Blocked canvas', deleted: false }),
        doc('canvas:colon', { orgId: 'org-1', title: 'Colon canvas', deleted: false }),
      ])
    }
    if (name === 'video_editor_projects') return queryFor([
      doc('video-1', { orgId: 'org-1', title: 'Launch edit' }),
      doc('video-archived', { orgId: 'org-1', title: 'Archived edit', status: 'archived', deleted: false }),
      doc('video-deleted', { orgId: 'org-1', title: 'Deleted edit', status: 'archived', deleted: true }),
    ])
    if (name === 'book_studio_projects') return queryFor([doc('book-1', { orgId: 'org-1', title: 'Growth Playbook' })])
    if (name === 'youtube_video_projects') return queryFor([doc('yt-1', { orgId: 'org-1', title: 'Launch episode' })])
    if (name === 'mobile_apps') return queryFor([doc('app-1', { orgId: 'org-1', name: 'Client App' })])
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
                status: 'in-progress',
                priority: 'high',
                agentStatus: 'in-progress',
                updatedAt: '2026-07-20T11:00:00.000Z',
                deleted: false,
              }),
            ])
          }),
        })),
      }
    }
    if (name === 'tasks') return queryFor([
      doc('task-collision-global', { orgId: 'org-1', title: 'Unrelated global task', deleted: false }),
      doc('task-direct-internal', { orgId: 'org-1', projectId: 'project-1', title: 'Internal hand-off', internalOnly: true, status: 'in-progress', priority: 'high', agentStatus: 'in-progress', updatedAt: '2026-07-20T11:00:00.000Z', deleted: false }),
      doc('task-orphan-internal', { orgId: 'org-1', title: 'Internal orphan', visibility: 'internal', deleted: false }),
      doc('task-deleted', { orgId: 'org-1', title: 'Deleted task', deleted: true }),
    ])
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

  it('derives bounded CRM and task canvas presentation data from canonical records', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const refs = await resolveContextReferences([
      { type: 'contact', id: 'contact-1', orgId: 'org-1' },
      { type: 'company', id: 'company-1', orgId: 'org-1' },
      { type: 'task', id: 'task-1', orgId: 'org-1', metadata: { projectId: 'project-1' } },
    ], { uid: 'admin-1', role: 'admin', authKind: 'session' }, 'org-1')

    const contact = refs.find((ref) => ref.type === 'contact')
    const company = refs.find((ref) => ref.type === 'company')
    const task = refs.find((ref) => ref.type === 'task')
    expect(contact?.metadata).toEqual(expect.objectContaining({
      relationshipSeeds: [expect.objectContaining({ type: 'company', id: 'company-1' })],
      presentation: expect.objectContaining({
        metrics: expect.arrayContaining([expect.objectContaining({ id: 'stage', value: 'contacted' }), expect.objectContaining({ id: 'lead-score', value: 72 })]),
        activity: expect.arrayContaining([expect.objectContaining({ id: 'contact-contacted', occurredAt: '2026-07-20T09:00:00.000Z' })]),
      }),
    }))
    expect(company?.metadata).toEqual(expect.objectContaining({
      presentation: expect.objectContaining({ metrics: expect.arrayContaining([expect.objectContaining({ id: 'lifecycle', value: 'customer' }), expect.objectContaining({ id: 'health-score', value: 88 })]) }),
    }))
    expect(task?.metadata).toEqual(expect.objectContaining({
      projectId: 'project-1',
      presentation: expect.objectContaining({
        metrics: expect.arrayContaining([expect.objectContaining({ id: 'priority', value: 'high' })]),
        activity: expect.arrayContaining([expect.objectContaining({ id: 'task-updated', occurredAt: '2026-07-20T11:00:00.000Z' })]),
      }),
    }))
    expect(JSON.stringify(refs)).not.toContain('providerCredential')
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

  it('searches CRM contacts by split first and last name fields', async () => {
    const { resolveContextReferences, searchContextReferences } = await import('@/lib/context-references/registry')
    const user = { uid: 'client-1', role: 'client' as const, orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' as const }

    await expect(searchContextReferences({
      type: 'contact',
      query: 'piet',
      orgId: 'org-1',
      limit: 8,
      user,
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'contact',
        id: 'contact-split-name',
        label: 'Pieter Goosen',
        summary: expect.stringContaining('pieter.goosen@example.com'),
      }),
    ])

    await expect(resolveContextReferences([
      { type: 'contacts', id: 'contact-split-name', orgId: 'org-1', origin: 'mention' },
    ], user, 'org-1')).resolves.toEqual([
      expect.objectContaining({
        type: 'contact',
        id: 'contact-split-name',
        label: 'Pieter Goosen',
      }),
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

  it('does not expose deleted or internal tasks through a direct context reference', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const client = { uid: 'client-1', role: 'client' as const, orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' as const }

    await expect(resolveContextReferences([
      { type: 'task', id: 'task-direct-internal', orgId: 'org-1' },
      { type: 'task', id: 'task-orphan-internal', orgId: 'org-1' },
      { type: 'task', id: 'task-deleted', orgId: 'org-1' },
    ], client, 'org-1')).resolves.toEqual([])
  })

  it('requires project access for a direct task reference that names a project', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, error: 'Forbidden', status: 403 })

    await expect(resolveContextReferences([
      { type: 'task', id: 'task-direct-internal', orgId: 'org-1' },
    ], { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' }, 'org-1')).resolves.toEqual([])
  })

  it('does not resolve a same-id global task when a pinned task names a different project scope', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')

    await expect(resolveContextReferences([
      { type: 'task', id: 'task-collision-global', orgId: 'org-1', metadata: { projectId: 'project-1' } },
    ], { uid: 'admin-1', role: 'admin', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' }, 'org-1')).resolves.toEqual([])
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

  it('preserves the recipient organisation perspective for received quote context', async () => {
    const { resolveContextReferences, searchContextReferences } = await import('@/lib/context-references/registry')
    const user = {
      uid: 'recipient-1',
      role: 'client' as const,
      authKind: 'session' as const,
      orgId: 'recipient-org',
      activeOrgId: 'recipient-org',
      orgIds: ['recipient-org'],
    }

    await expect(resolveContextReferences([
      { type: 'quote', id: 'received-quote', orgId: 'recipient-org', origin: 'manual' },
    ], user, 'recipient-org')).resolves.toEqual([
      expect.objectContaining({
        type: 'quote',
        id: 'received-quote',
        orgId: 'recipient-org',
        label: 'Q-REC-001',
      }),
    ])

    await expect(searchContextReferences({
      type: 'quote',
      query: 'Q-REC',
      orgId: 'recipient-org',
      limit: 8,
      user,
    })).resolves.toEqual([
      expect.objectContaining({
        type: 'quote',
        id: 'received-quote',
        orgId: 'recipient-org',
      }),
    ])
  })

  it('resolves trusted Studio workspaces and exact artifacts from authoritative records', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const user = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }

    await expect(resolveContextReferences([
      { type: 'studio', id: 'marketing_studio:org-1', orgId: 'org-1', label: 'Spoofed', href: 'https://evil.test' },
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas-1', orgId: 'org-1', label: 'Spoofed', href: 'https://evil.test', metadata: { secretPrompt: 'steal me' } },
    ], user, 'org-1')).resolves.toEqual([
      expect.objectContaining({
        type: 'studio', id: 'marketing_studio:org-1', orgId: 'org-1', label: 'Marketing Studio', href: '/admin/creative-canvas',
      }),
      expect.objectContaining({
        type: 'studio_artifact', id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', orgId: 'org-1', label: 'Launch campaign canvas', href: '/admin/creative-canvas?canvasId=canvas-1&orgId=org-1',
      }),
    ])
  })

  it('rejects malformed, cross-organisation, archived, and module-denied Studio references', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const admin = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }

    await expect(resolveContextReferences([
      { type: 'studio', id: 'unknown_studio:org-1', orgId: 'org-1' },
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas-cross-org', orgId: 'org-1' },
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas-archived', orgId: 'org-1' },
    ], admin, 'org-1')).resolves.toEqual([])

    await expect(resolveContextReferences([
      { type: 'studio', id: 'marketing_studio:org-1', orgId: 'org-1' },
    ], {
      uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session',
      memberAccessPolicy: { preset: 'custom', modules: {}, recordScopes: {} },
    } as never, 'org-1')).resolves.toEqual([])

    await expect(resolveContextReferences([
      { type: 'studio', id: 'marketing_studio:org-2', orgId: 'org-2' },
    ], admin, 'org-1')).resolves.toEqual([])
  })

  it('resolves archived Video Editor projects directly but still rejects deleted projects', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const admin = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }

    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'video_editor:project:video-archived', orgId: 'org-1' },
      { type: 'studio_artifact', id: 'video_editor:project:video-deleted', orgId: 'org-1' },
    ], admin, 'org-1')).resolves.toEqual([
      expect.objectContaining({
        type: 'studio_artifact', id: 'video_editor:project:video-archived', orgId: 'org-1', label: 'Archived edit',
        href: '/portal/video-editor?projectId=video-archived',
      }),
    ])
  })

  it('searches authoritative Studio workspaces and artifacts', async () => {
    const { searchContextReferences } = await import('@/lib/context-references/registry')
    const user = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }
    await expect(searchContextReferences({ type: 'studio', query: 'marketing', orgId: 'org-1', user })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'marketing_studio:org-1' })]),
    )
    mockCollection.mockClear()
    await expect(searchContextReferences({ type: 'studio_artifact', query: 'launch', orgId: 'org-1', user })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE' })]),
    )
    const exactLimits = mockCollection.mock.results
      .map((result) => result.value as MockQuery)
      .filter((query) => query?.limit?.mock.calls.length > 0)
      .flatMap((query) => query.limit.mock.calls.map(([value]) => value))
    expect(exactLimits).toEqual([24, 24, 24, 24, 24])
    expect(mockCollection.mock.calls.filter(([name]) => name === 'organizations')).toHaveLength(1)

    mockCollection.mockClear()
    await expect(searchContextReferences({ type: 'studio_artifact', query: 'x', orgId: 'org-1', user })).resolves.toEqual([])
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('uses only proven navigable artifact links and portal links for clients', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    const admin = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }
    const refs = await resolveContextReferences([
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas-1' },
      { type: 'studio_artifact', id: 'video_editor:project:video-1' },
      { type: 'studio_artifact', id: 'book_studio:project:book-1' },
      { type: 'studio_artifact', id: 'youtube_studio:video_project:yt-1' },
      { type: 'studio_artifact', id: 'mobile_apps:app:app-1' },
    ], admin, 'org-1')
    expect(refs.map((ref) => ref.href)).toEqual([
      '/admin/creative-canvas?canvasId=canvas-1&orgId=org-1',
      '/portal/video-editor?projectId=video-1',
      '/admin/org/elemental/book-studio/book-1',
      '/admin/org/elemental/youtube-studio/editor/yt-1',
      '/admin/org/elemental/mobile-apps?appId=app-1',
    ])

    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'book_studio:chapter:chapter-1' },
      { type: 'studio_artifact', id: 'youtube_studio:channel:channel-1' },
    ], admin, 'org-1')).resolves.toEqual([])

    await expect(resolveContextReferences([
      { type: 'studio', id: 'marketing_studio:org-1' },
      { type: 'studio', id: 'video_editor:org-1' },
      { type: 'studio', id: 'book_studio:org-1' },
      { type: 'studio', id: 'youtube_studio:org-1' },
      { type: 'studio', id: 'mobile_apps:org-1' },
    ], admin, 'org-1')).resolves.toHaveLength(5)

    const modules = { crm: true, projects: true, documents: true, marketing: true, messages: true, email: true, reports: true, research: true, properties: true, billing: true, mobileApps: true, youtubeStudio: true, bookStudio: true }
    await expect(resolveContextReferences([{ type: 'studio', id: 'marketing_studio:org-1' }], {
      uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session',
      memberAccessPolicy: { preset: 'full', modules, recordScopes: { crm: 'all', projects: 'all' } },
    }, 'org-1')).resolves.toEqual([expect.objectContaining({ href: '/portal/creative-canvas' })])

    await expect(resolveContextReferences([{ type: 'studio', id: 'book_studio:org-3' }], {
      uid: 'client-3', role: 'client', orgId: 'org-3', orgIds: ['org-3'], authKind: 'session',
      memberAccessPolicy: { preset: 'full', modules, recordScopes: { crm: 'all', projects: 'all' } },
    }, 'org-3')).resolves.toEqual([])
  })

  it('uses the shared canonical identity for Mobile App resolve and search results', async () => {
    const { resolveContextReferences, searchContextReferences } = await import('@/lib/context-references/registry')
    const user = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }
    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'mobile_apps:app:app-1' },
    ], user, 'org-1')).resolves.toEqual([
      expect.objectContaining({ id: 'mobile_apps:org:b3JnLTE:app:YXBwLTE', orgId: 'org-1' }),
    ])
    await expect(searchContextReferences({ type: 'studio_artifact', query: 'client', orgId: 'org-1', user })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'mobile_apps:org:b3JnLTE:app:YXBwLTE' })]),
    )
  })

  it('retains legacy context ids for Video, Book, and YouTube resolve and search results', async () => {
    const { resolveContextReferences, searchContextReferences } = await import('@/lib/context-references/registry')
    const user = { uid: 'admin-1', role: 'admin' as const, authKind: 'session' as const }
    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'video_editor:project:video-1' },
      { type: 'studio_artifact', id: 'book_studio:project:book-1' },
      { type: 'studio_artifact', id: 'youtube_studio:video_project:yt-1' },
    ], user, 'org-1')).resolves.toEqual([
      expect.objectContaining({ id: 'video_editor:project:video-1' }),
      expect.objectContaining({ id: 'book_studio:project:book-1' }),
      expect.objectContaining({ id: 'youtube_studio:video_project:yt-1' }),
    ])
    await expect(searchContextReferences({ type: 'studio_artifact', query: 'launch', orgId: 'org-1', user })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'video_editor:project:video-1' })]),
    )
  })

  it('rejects a module-disabled canonical Mobile App reference before reading the app', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    mockCollection.mockClear()
    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'mobile_apps:org:b3JnLTE:app:YXBwLTE', orgId: 'org-1' },
    ], {
      uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session',
      memberAccessPolicy: { preset: 'custom', modules: { mobileApps: false }, recordScopes: {} },
    } as never, 'org-1')).resolves.toEqual([])
    expect(mockCollection.mock.calls.filter(([name]) => name === 'mobile_apps')).toHaveLength(0)
  })

  it('round-trips colon-containing Firestore ids through one encoded opaque segment', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas%3Acolon' },
    ], { uid: 'admin-1', role: 'admin', authKind: 'session' }, 'org-1')).resolves.toEqual([
      expect.objectContaining({ id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzOmNvbG9u', href: '/admin/creative-canvas?canvasId=canvas%3Acolon&orgId=org-1' }),
    ])
  })

  it('migrates a superadmin legacy canvas reference using the authoritative record organisation', async () => {
    const { resolveContextReferences } = await import('@/lib/context-references/registry')
    await expect(resolveContextReferences([
      { type: 'studio_artifact', id: 'marketing_studio:canvas:canvas-1' },
    ], { uid: 'admin-1', role: 'admin', authKind: 'session' })).resolves.toEqual([
      expect.objectContaining({ id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', orgId: 'org-1' }),
    ])
  })
})
