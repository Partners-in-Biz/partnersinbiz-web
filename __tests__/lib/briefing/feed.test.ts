export {}

const mockCollection = jest.fn()
const mockCollectionGroup = jest.fn()
const mockAdd = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
  Timestamp: class MockTimestamp {},
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
  },
  adminAuth: {
    getUsers: jest.fn(async () => ({ users: [] })),
  },
}))

type MockDocData = Record<string, unknown>

function makeDoc(id: string, data: MockDocData, path?: string) {
  return {
    id,
    data: () => data,
    ref: path ? { path } : undefined,
  }
}

function makeQuery(docs: ReturnType<typeof makeDoc>[]) {
  return {
    where: jest.fn(function where() { return this }),
    limit: jest.fn(function limit() { return this }),
    get: jest.fn(async () => ({ docs })),
  }
}

const collections: Record<string, ReturnType<typeof makeDoc>[]> = {}
const collectionGroups: Record<string, ReturnType<typeof makeDoc>[]> = {}
const nestedProjectTasks: Record<string, ReturnType<typeof makeDoc>> = {}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(collections)) delete collections[key]
  for (const key of Object.keys(collectionGroups)) delete collectionGroups[key]
  for (const key of Object.keys(nestedProjectTasks)) delete nestedProjectTasks[key]

  mockCollection.mockImplementation((name: string) => {
    if (name === 'briefing_snapshots') {
      return { add: mockAdd }
    }
    if (name === 'projects') {
      return {
        ...makeQuery(collections[name] ?? []),
        doc: jest.fn((projectId: string) => ({
          collection: jest.fn(() => ({
            doc: jest.fn((taskId: string) => ({
              get: jest.fn(async () => {
                const doc = nestedProjectTasks[`${projectId}/${taskId}`]
                return doc ? { ...doc, exists: true } : { exists: false }
              }),
            })),
          })),
        })),
      }
    }
    return makeQuery(collections[name] ?? [])
  })
  mockCollectionGroup.mockImplementation((name: string) => makeQuery(collectionGroups[name] ?? []))
  mockAdd.mockResolvedValue({ id: 'snapshot-1' })
})

describe('briefing feed', () => {
  it('aggregates tasks and comments, sorts by priority, scopes by visible orgs, and redacts sensitive excerpts', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.projects = [makeDoc('project-1', { name: 'Readable Project', slug: 'readable-project' })]
    collections.users = [makeDoc('client-1', { displayName: 'Client User', email: 'client@example.test' })]
    collectionGroups.tasks = [
      makeDoc('task-1', {
        orgId: 'org-1',
        projectId: 'project-1',
        columnId: 'todo',
        title: 'Ship briefing page',
        agentStatus: 'awaiting-input',
        description: 'Needs decision. password: hunter2',
        createdAt: '2026-05-28T10:00:00.000Z',
        updatedAt: '2026-05-29T10:00:00.000Z',
      }, 'projects/project-1/tasks/task-1'),
    ]
    collectionGroups.comments = [
      makeDoc('comment-1', {
        orgId: 'org-1',
        text: 'Urgent blocker. Bearer abc123 should not leak.',
        userId: 'client-1',
        userName: 'Client User',
        userRole: 'client',
        createdAt: '2026-05-30T10:00:00.000Z',
      }, 'projects/project-1/tasks/task-1/comments/comment-1'),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10 },
    )

    expect(feed.total).toBeGreaterThanOrEqual(2)
    expect(feed.items[0]).toMatchObject({ priority: 'critical', source: { type: 'comment' } })
    expect(feed.items.some((item) => item.title === 'Awaiting Input: Ship briefing page')).toBe(true)
    const commentItem = feed.items.find((item) => item.source.type === 'comment')
    expect(commentItem).toMatchObject({
      title: 'Comment on Ship briefing page',
      actor: { name: 'Client User' },
      context: { projectName: 'Readable Project', taskTitle: 'Ship briefing page' },
    })
    expect(JSON.stringify(feed.items)).not.toContain('hunter2')
    expect(JSON.stringify(feed.items)).not.toContain('abc123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
    expect(mockCollection).not.toHaveBeenCalledWith('client-documents')
    expect(mockCollection).toHaveBeenCalledWith('client_documents')
  })

  it('creates a snapshot document from the current feed', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One' })]
    collections.client_documents = [
      makeDoc('doc-1', {
        orgId: 'org-1',
        title: 'Monthly report',
        type: 'monthly_report',
        status: 'in-review',
        content: 'Ready for review',
        requiresApproval: true,
        approvalStatus: 'pending',
        updatedAt: '2026-05-29T10:00:00.000Z',
      }),
    ]

    const { createBriefingSnapshot } = await import('@/lib/briefing/feed')
    const snapshot = await createBriefingSnapshot(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { orgId: 'org-1', title: 'Ops snapshot', limit: 20 },
    )

    expect(snapshot).toMatchObject({ id: 'snapshot-1', orgId: 'org-1', title: 'Ops snapshot', itemCount: 2 })
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Ops snapshot',
      generatedBy: 'admin-1',
      status: 'draft',
      generatedAt: 'server-timestamp',
    }))
  })

  it('falls back to direct nested task and Firebase Auth lookups for readable labels', async () => {
    const { adminAuth } = await import('@/lib/firebase/admin')
    ;(adminAuth.getUsers as jest.Mock).mockResolvedValueOnce({
      users: [{ uid: 'user-1', displayName: 'Peet Stander', email: 'peet@example.test' }],
    })
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.projects = [makeDoc('project-1', { name: 'Readable Project', slug: 'readable-project' })]
    nestedProjectTasks['project-1/task-1'] = makeDoc('task-1', {
      orgId: 'org-1',
      projectId: 'project-1',
      title: 'Human readable task',
    }, 'projects/project-1/tasks/task-1')
    collectionGroups.comments = [
      makeDoc('comment-1', {
        orgId: 'org-1',
        projectId: 'project-1',
        taskId: 'task-1',
        text: 'Urgent blocker needs a readable evidence trail.',
        userId: 'user-1',
        userRole: 'admin',
        createdAt: '2026-05-30T10:00:00.000Z',
      }, 'comments/comment-1'),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'comment' },
    )

    expect(feed.items[0]).toMatchObject({
      title: 'Comment on Human readable task',
      actor: { name: 'Peet Stander' },
      context: { projectName: 'Readable Project', taskTitle: 'Human readable task' },
    })
  })

  it('filters cards a user has marked handled from the live control desk feed', async () => {
    collectionGroups.tasks = [
      makeDoc('task-1', {
        orgId: 'org-1',
        projectId: 'project-1',
        columnId: 'todo',
        title: 'Review launch plan',
        agentStatus: 'awaiting-input',
        updatedAt: '2026-05-30T10:00:00.000Z',
      }, 'projects/project-1/tasks/task-1'),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const firstFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'task' },
    )
    expect(firstFeed.items).toHaveLength(1)

    collections.briefing_user_states = [
      makeDoc('state-1', {
        userId: 'admin-1',
        itemId: firstFeed.items[0].id,
        status: 'handled',
      }),
    ]

    const handledFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'task' },
    )

    expect(handledFeed.items).toHaveLength(0)
  })

  it('surfaces social posts awaiting QA or client approval as action cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.social_posts = [
      makeDoc('post-1', {
        orgId: 'org-1',
        status: 'client_review',
        platform: 'linkedin',
        platforms: ['linkedin', 'facebook'],
        content: { text: 'Launch offer post with token: sk-test-123' },
        campaign: 'May launch',
        scheduledAt: '2026-06-01T09:00:00.000Z',
        createdBy: 'user-1',
        updatedAt: '2026-05-31T09:00:00.000Z',
      }),
      makeDoc('post-2', {
        orgId: 'org-1',
        status: 'qa_review',
        platform: 'instagram',
        content: 'QA check the story copy before it goes to the client.',
        source: 'ai_agent',
        assignedTo: 'agent:maya',
        updatedAt: '2026-05-31T09:30:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'social-post' },
    )

    expect(feed.items).toHaveLength(2)
    const qaItem = feed.items.find((item) => item.source.id === 'post-2')
    const clientItem = feed.items.find((item) => item.source.id === 'post-1')
    expect(qaItem).toMatchObject({
      priority: 'review',
      source: { type: 'social-post', id: 'post-2' },
      title: 'Social post awaiting QA review',
      context: { orgName: 'Client One' },
      actor: { type: 'agent' },
      metadata: expect.objectContaining({ actionStage: 'qa' }),
    })
    expect(clientItem).toMatchObject({
      priority: 'needs-peet',
      source: { type: 'social-post', id: 'post-1' },
      title: 'Social post awaiting client approval',
      metadata: expect.objectContaining({ actionStage: 'client', platforms: ['linkedin', 'facebook'] }),
    })
    expect(JSON.stringify(feed.items)).not.toContain('sk-test-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces received quotes that need a client decision as action cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.quotes = [
      makeDoc('quote-1', {
        orgId: 'pib-platform-owner',
        sourceOrgId: 'pib-platform-owner',
        recipientOrgId: 'org-1',
        quoteNumber: 'QUO-1001',
        status: 'sent',
        total: 18500,
        currency: 'ZAR',
        recipientName: 'Riley Client',
        recipientCompanyName: 'Client One',
        notes: 'Approve this retainer quote before onboarding can continue.',
        validUntil: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-05-31T09:45:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'quote' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      source: { type: 'quote', id: 'quote-1', collectionPath: 'quotes', url: '/admin/quotes/quote-1' },
      priority: 'needs-peet',
      title: 'Quote awaiting decision: QUO-1001',
      summary: expect.stringContaining('R18,500.00 quote for Riley Client'),
      context: {
        orgId: 'org-1',
        orgName: 'Client One',
        orgSlug: 'client-one',
        quoteId: 'quote-1',
        quoteNumber: 'QUO-1001',
      },
      metadata: expect.objectContaining({
        quoteStatus: 'sent',
        total: 18500,
        currency: 'ZAR',
        recipientOrgId: 'org-1',
        sourceOrgId: 'pib-platform-owner',
      }),
    })
  })

  it('surfaces active shipments as delivery control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.shipments = [
      makeDoc('shipment-1', {
        orgId: 'org-1',
        companyId: 'company-1',
        orderId: 'order-1',
        projectId: 'project-1',
        status: 'in_transit',
        carrier: 'DHL',
        trackingNumber: 'DHL-123',
        trackingUrl: 'https://tracking.example.test/DHL-123',
        destination: 'Client warehouse',
        expectedDeliveryDate: '2026-06-02T00:00:00.000Z',
        notes: 'Confirm delivery before closing the onboarding order.',
        updatedAt: '2026-05-31T09:44:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'shipment' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      source: { type: 'shipment', id: 'shipment-1', collectionPath: 'shipments', url: '/portal/companies/company-1?shipment=shipment-1' },
      priority: 'review',
      title: 'Shipment in transit: DHL-123',
      summary: expect.stringContaining('DHL shipment DHL-123'),
      context: {
        orgId: 'org-1',
        orgName: 'Client One',
        orgSlug: 'client-one',
        shipmentId: 'shipment-1',
        shipmentTrackingNumber: 'DHL-123',
        orderId: 'order-1',
        projectId: 'project-1',
      },
      metadata: expect.objectContaining({
        shipmentStatus: 'in_transit',
        carrier: 'DHL',
        trackingNumber: 'DHL-123',
        trackingUrl: 'https://tracking.example.test/DHL-123',
        expectedDeliveryDate: '2026-06-02',
      }),
    })
  })

  it('surfaces active orders as fulfillment control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.orders = [
      makeDoc('order-1', {
        orgId: 'org-1',
        companyId: 'company-1',
        projectId: 'project-1',
        quoteId: 'quote-1',
        invoiceId: 'invoice-1',
        title: 'Website onboarding order',
        status: 'confirmed',
        fulfillmentStatus: 'blocked',
        total: 18500,
        currency: 'ZAR',
        expectedDeliveryDate: '2026-06-05T00:00:00.000Z',
        notes: 'Waiting on final asset handoff before fulfillment can continue.',
        updatedAt: '2026-05-31T09:43:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'order' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      source: { type: 'order', id: 'order-1', collectionPath: 'orders', url: '/portal/companies/company-1?order=order-1' },
      priority: 'critical',
      title: 'Order blocked: Website onboarding order',
      summary: expect.stringContaining('R18,500.00 order'),
      context: {
        orgId: 'org-1',
        orgName: 'Client One',
        orgSlug: 'client-one',
        companyId: 'company-1',
        projectId: 'project-1',
        quoteId: 'quote-1',
        invoiceId: 'invoice-1',
        orderId: 'order-1',
        orderTitle: 'Website onboarding order',
      },
      metadata: expect.objectContaining({
        orderStatus: 'confirmed',
        fulfillmentStatus: 'blocked',
        total: 18500,
        currency: 'ZAR',
        expectedDeliveryDate: '2026-06-05',
      }),
    })
  })

  it('surfaces low-stock inventory as operational risk cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.inventoryItems = [
      makeDoc('stock-1', {
        orgId: 'org-1',
        companyId: 'company-1',
        serviceWorkspaceId: 'project-1',
        productId: 'product-1',
        name: 'SEO implementation hours',
        sku: 'SEO-HOURS',
        status: 'low_stock',
        quantityAvailable: 2,
        quantityReserved: 1,
        lowStockThreshold: 5,
        unit: 'hours',
        location: 'Delivery pool',
        notes: 'Restock delivery capacity before next onboarding sprint.',
        updatedAt: '2026-05-31T09:42:00.000Z',
      }),
      makeDoc('stock-2', {
        orgId: 'org-1',
        companyId: 'company-1',
        name: 'Healthy stock',
        status: 'active',
        quantityAvailable: 10,
        lowStockThreshold: 5,
        updatedAt: '2026-05-31T09:41:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'inventory-item' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      source: { type: 'inventory-item', id: 'stock-1', collectionPath: 'inventoryItems', url: '/portal/companies/company-1?inventory=stock-1' },
      priority: 'client-risk',
      title: 'Low stock: SEO implementation hours',
      summary: expect.stringContaining('2 hours available'),
      context: {
        orgId: 'org-1',
        orgName: 'Client One',
        orgSlug: 'client-one',
        companyId: 'company-1',
        projectId: 'project-1',
        inventoryItemId: 'stock-1',
        inventoryItemName: 'SEO implementation hours',
      },
      metadata: expect.objectContaining({
        inventoryStatus: 'low_stock',
        quantityAvailable: 2,
        quantityReserved: 1,
        lowStockThreshold: 5,
        unit: 'hours',
        sku: 'SEO-HOURS',
      }),
    })
  })

  it('turns CRM follow-up activities into source-linked action cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.activities = [
      makeDoc('activity-1', {
        orgId: 'org-1',
        contactId: 'contact-1',
        contactName: 'Ava Owner',
        dealId: 'deal-1',
        dealTitle: 'Website retainer',
        type: 'note',
        summary: 'Follow up with Ava about the retainer approval before Friday.',
        metadata: {
          intent: 'follow_up',
          nextAction: 'Confirm approval blockers',
        },
        createdByRef: {
          uid: 'client-1',
          displayName: 'Ava Owner',
          role: 'client',
        },
        occurredAt: '2026-05-31T08:45:00.000Z',
        createdAt: '2026-05-31T08:50:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'activity' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: { type: 'activity', id: 'activity-1', url: '/portal/contacts/contact-1' },
      title: 'Follow up with Ava Owner',
      actor: { name: 'Ava Owner', role: 'client', type: 'user' },
      context: {
        orgName: 'Client One',
        contactId: 'contact-1',
        contactName: 'Ava Owner',
        dealId: 'deal-1',
        dealTitle: 'Website retainer',
      },
      metadata: expect.objectContaining({
        activityType: 'note',
        contactId: 'contact-1',
        dealId: 'deal-1',
        followUpIntent: 'follow_up',
      }),
    })
    expect(feed.items[0].summary).toContain('Confirm approval blockers')
  })

  it('surfaces rendered reports with public source links and review context', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.reports = [
      makeDoc('report-1', {
        orgId: 'org-1',
        type: 'monthly',
        title: 'May performance report',
        status: 'rendered',
        publicToken: 'public-report-token',
        generatedBy: 'agent:analyst',
        exec_summary: 'Revenue grew after the launch sprint. api_key: should-not-leak',
        highlights: ['Revenue up', 'Follow-up needed'],
        period: { start: '2026-05-01', end: '2026-05-31', tz: 'Africa/Johannesburg' },
        brand: { orgName: 'Client One' },
        kpis: { total_revenue: 25000, mrr: 5000, deltas: { total_revenue: 12.4 } },
        createdAt: '2026-05-31T08:00:00.000Z',
        updatedAt: '2026-05-31T08:10:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'report' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'review',
      requiresAction: true,
      source: { type: 'report', id: 'report-1', url: '/reports/public-report-token' },
      title: 'Report ready to review: May performance report',
      actor: { id: 'agent:analyst', type: 'agent' },
      context: {
        orgName: 'Client One',
        reportId: 'report-1',
        reportTitle: 'May performance report',
      },
      metadata: expect.objectContaining({
        reportType: 'monthly',
        status: 'rendered',
        publicToken: 'public-report-token',
        totalRevenue: 25000,
      }),
    })
    expect(feed.items[0].summary).toContain('Revenue grew')
    expect(JSON.stringify(feed.items)).not.toContain('should-not-leak')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces open support tickets as source-linked action cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.support_tickets = [
      makeDoc('support-1', {
        orgId: 'org-1',
        createdBy: 'client-1',
        requesterName: 'Riley Client',
        requesterEmail: 'riley@example.test',
        category: 'urgent',
        subject: 'Website form is not sending leads',
        description: 'The lead form failed twice and a secret token sk-live-123 should not leak.',
        status: 'waiting_on_us',
        priority: 'urgent',
        sourcePath: '/portal/campaigns',
        messageCount: 2,
        lastMessagePreview: 'The form failed twice with secret token sk-live-123.',
        lastMessageAt: '2026-05-31T09:40:00.000Z',
        updatedAt: '2026-05-31T09:45:00.000Z',
      }),
      makeDoc('support-2', {
        orgId: 'org-1',
        createdBy: 'client-1',
        requesterName: 'Riley Client',
        category: 'question',
        subject: 'Resolved question',
        description: 'Already handled.',
        status: 'resolved',
        priority: 'normal',
        updatedAt: '2026-05-31T08:00:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'support-ticket' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'critical',
      requiresAction: true,
      source: { type: 'support-ticket', id: 'support-1', url: '/admin/support?ticket=support-1' },
      title: 'Urgent support: Website form is not sending leads',
      actor: { name: 'Riley Client', role: 'client', type: 'user' },
      context: {
        orgName: 'Client One',
        supportTicketId: 'support-1',
        supportTicketSubject: 'Website form is not sending leads',
      },
      metadata: expect.objectContaining({
        supportStatus: 'waiting_on_us',
        supportPriority: 'urgent',
        sourcePath: '/portal/campaigns',
      }),
    })
    expect(feed.items[0].summary).toContain('The form failed twice')
    expect(JSON.stringify(feed.items)).not.toContain('sk-live-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces active invoices as finance-risk control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.invoices = [
      makeDoc('invoice-1', {
        orgId: 'org-1',
        sourceOrgId: 'org-1',
        recipientOrgId: 'client-org-1',
        invoiceNumber: 'INV-1001',
        status: 'overdue',
        total: 12500,
        currency: 'ZAR',
        recipientName: 'Riley Client',
        recipientCompanyName: 'Client One',
        clientDetails: {
          name: 'Riley Client',
          email: 'billing@example.test',
        },
        dueDate: '2026-05-20T00:00:00.000Z',
        publicToken: 'invoice-public-token',
        updatedAt: '2026-05-31T09:30:00.000Z',
      }),
      makeDoc('invoice-2', {
        orgId: 'org-1',
        sourceOrgId: 'org-1',
        invoiceNumber: 'INV-1002',
        status: 'paid',
        total: 5000,
        currency: 'ZAR',
        updatedAt: '2026-05-31T08:30:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'invoice' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'client-risk',
      requiresAction: true,
      source: { type: 'invoice', id: 'invoice-1', url: '/admin/invoicing/invoice-1' },
      title: 'Overdue invoice: INV-1001',
      actor: { id: 'system', type: 'system' },
      context: {
        orgName: 'Client One',
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-1001',
      },
      metadata: expect.objectContaining({
        invoiceStatus: 'overdue',
        total: 12500,
        currency: 'ZAR',
        publicToken: 'invoice-public-token',
      }),
    })
    expect(feed.items[0].summary).toContain('R12,500.00')
    expect(feed.items[0].summary).toContain('Due: 2026-05-20')
  })

  it('surfaces payment proof invoices with verification metadata', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.invoices = [
      makeDoc('invoice-proof-1', {
        orgId: 'org-1',
        sourceOrgId: 'org-1',
        invoiceNumber: 'INV-2001',
        status: 'payment_pending_verification',
        total: 8800,
        currency: 'ZAR',
        recipientName: 'Riley Client',
        paymentProofFileId: 'file-proof-1',
        paymentProofUploadedAt: '2026-05-31T10:20:00.000Z',
        paymentProofNote: 'Paid from FNB. token: payment-secret-123',
        updatedAt: '2026-05-31T10:21:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'invoice' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: { type: 'invoice', id: 'invoice-proof-1', url: '/admin/invoicing/invoice-proof-1' },
      title: 'Payment proof needs review: INV-2001',
      context: {
        orgName: 'Client One',
        invoiceId: 'invoice-proof-1',
        invoiceNumber: 'INV-2001',
      },
      metadata: expect.objectContaining({
        invoiceStatus: 'payment_pending_verification',
        total: 8800,
        currency: 'ZAR',
        paymentProofFileId: 'file-proof-1',
        paymentProofUploadedAt: '2026-05-31',
      }),
    })
    expect(feed.items[0].summary).toContain('Status: payment_pending_verification')
    expect(JSON.stringify(feed.items)).not.toContain('payment-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces submitted expenses as admin-only approval control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.expenses = [
      makeDoc('expense-1', {
        orgId: 'org-1',
        userId: 'client-1',
        date: '2026-05-30T00:00:00.000Z',
        amount: 425.5,
        currency: 'ZAR',
        category: 'Travel',
        description: 'Taxi to workshop. password: never-leak-this',
        vendor: 'Bolt',
        receiptFileId: 'receipt-1',
        projectId: 'project-1',
        clientOrgId: 'client-org-1',
        billable: true,
        reimbursable: true,
        status: 'submitted',
        invoiceId: null,
        createdAt: '2026-05-31T08:00:00.000Z',
        updatedAt: '2026-05-31T09:00:00.000Z',
        deleted: false,
      }),
      makeDoc('expense-2', {
        orgId: 'org-1',
        userId: 'client-1',
        date: '2026-05-29T00:00:00.000Z',
        amount: 100,
        currency: 'ZAR',
        category: 'Meals',
        vendor: 'Cafe',
        status: 'approved',
        deleted: false,
        updatedAt: '2026-05-31T08:30:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const adminFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'expense' },
    )
    const clientFeed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgIds: ['org-1'], orgId: 'org-1' },
      { limit: 10, sourceType: 'expense' },
    )

    expect(adminFeed.items).toHaveLength(1)
    expect(clientFeed.items).toHaveLength(0)
    expect(adminFeed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: { type: 'expense', id: 'expense-1', url: '/admin/finance?expense=expense-1' },
      title: 'Expense needs approval: Travel',
      actor: { id: 'user:client-1', type: 'user' },
      context: {
        orgName: 'Client One',
        projectId: 'project-1',
        expenseId: 'expense-1',
        expenseCategory: 'Travel',
      },
      metadata: expect.objectContaining({
        expenseStatus: 'submitted',
        amount: 425.5,
        currency: 'ZAR',
        vendor: 'Bolt',
        billable: true,
        reimbursable: true,
        receiptFileId: 'receipt-1',
      }),
    })
    expect(adminFeed.items[0].summary).toContain('R425.50')
    expect(adminFeed.items[0].summary).toContain('Billable')
    expect(JSON.stringify(adminFeed.items)).not.toContain('never-leak-this')
    expect(JSON.stringify(adminFeed.items)).toContain('[REDACTED]')
  })

  it('surfaces SEO content awaiting review as approval control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.seo_content = [
      makeDoc('seo-content-1', {
        orgId: 'org-1',
        orgSlug: 'client-one',
        sprintId: 'sprint-1',
        campaignId: 'campaign-1',
        title: 'Website SEO launch checklist',
        type: 'how-to',
        status: 'review',
        targetKeyword: 'website seo checklist',
        publishDate: '2026-06-05T00:00:00.000Z',
        draftPostId: 'draft-1',
        createdBy: 'agent:writer',
        createdByType: 'agent',
        summary: 'Ready for client review. token: seo-secret-123',
        updatedAt: '2026-05-31T10:30:00.000Z',
        deleted: false,
      }),
      makeDoc('seo-content-2', {
        orgId: 'org-1',
        sprintId: 'sprint-1',
        title: 'Already live post',
        type: 'pillar',
        status: 'live',
        updatedAt: '2026-05-31T09:30:00.000Z',
        deleted: false,
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const adminFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'seo-content' },
    )
    const clientFeed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgIds: ['org-1'], orgId: 'org-1' },
      { limit: 10, sourceType: 'seo-content' },
    )

    expect(adminFeed.items).toHaveLength(1)
    expect(clientFeed.items).toHaveLength(1)
    expect(adminFeed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: { type: 'seo-content', id: 'seo-content-1', url: '/admin/seo/sprints/sprint-1/content?content=seo-content-1' },
      title: 'SEO content awaiting review: Website SEO launch checklist',
      actor: { id: 'agent:writer', type: 'agent' },
      context: {
        orgName: 'Client One',
        seoContentId: 'seo-content-1',
        seoContentTitle: 'Website SEO launch checklist',
        seoSprintId: 'sprint-1',
      },
      metadata: expect.objectContaining({
        seoStatus: 'review',
        contentType: 'how-to',
        targetKeyword: 'website seo checklist',
        publishDate: '2026-06-05',
        draftPostId: 'draft-1',
      }),
    })
    expect(adminFeed.items[0].summary).toContain('website seo checklist')
    expect(JSON.stringify(adminFeed.items)).not.toContain('seo-secret-123')
    expect(JSON.stringify(adminFeed.items)).toContain('[REDACTED]')
  })

  it('surfaces active SEO tasks as admin control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.seo_tasks = [
      makeDoc('seo-task-1', {
        orgId: 'org-1',
        sprintId: 'sprint-1',
        week: 2,
        phase: 1,
        focus: 'Technical SEO',
        title: 'Fix sitemap canonical drift',
        description: 'Update sitemap entries and canonical tags. token: seo-task-secret-123',
        taskType: 'technical',
        status: 'blocked',
        blockerReason: 'Waiting for CMS admin access',
        autopilotEligible: true,
        source: 'manual',
        updatedAt: '2026-05-31T10:40:00.000Z',
        deleted: false,
      }),
      makeDoc('seo-task-2', {
        orgId: 'org-1',
        sprintId: 'sprint-1',
        title: 'Already done',
        taskType: 'technical',
        status: 'done',
        updatedAt: '2026-05-31T09:40:00.000Z',
        deleted: false,
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const adminFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'seo-task' },
    )
    const clientFeed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgIds: ['org-1'], orgId: 'org-1' },
      { limit: 10, sourceType: 'seo-task' },
    )

    expect(adminFeed.items).toHaveLength(1)
    expect(clientFeed.items).toHaveLength(0)
    expect(adminFeed.items[0]).toMatchObject({
      priority: 'critical',
      requiresAction: true,
      source: { type: 'seo-task', id: 'seo-task-1', url: '/admin/seo/sprints/sprint-1/tasks?task=seo-task-1' },
      title: 'Blocked SEO task: Fix sitemap canonical drift',
      actor: { id: 'system', type: 'system' },
      context: {
        orgName: 'Client One',
        seoTaskId: 'seo-task-1',
        seoTaskTitle: 'Fix sitemap canonical drift',
        seoSprintId: 'sprint-1',
      },
      metadata: expect.objectContaining({
        seoTaskStatus: 'blocked',
        taskType: 'technical',
        focus: 'Technical SEO',
        week: 2,
        phase: 1,
        autopilotEligible: true,
        blockerReason: 'Waiting for CMS admin access',
      }),
    })
    expect(adminFeed.items[0].summary).toContain('Waiting for CMS admin access')
    expect(JSON.stringify(adminFeed.items)).not.toContain('seo-task-secret-123')
    expect(JSON.stringify(adminFeed.items)).toContain('[REDACTED]')
  })

  it('surfaces ad campaigns awaiting client approval as control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.ad_campaigns = [
      makeDoc('ad-campaign-1', {
        orgId: 'org-1',
        platform: 'meta',
        adAccountId: 'act_123',
        name: 'June lead generation push',
        objective: 'LEADS',
        status: 'PENDING_REVIEW',
        reviewState: 'awaiting',
        dailyBudget: 25000,
        startTime: '2026-06-03T08:00:00.000Z',
        submittedForReviewAt: '2026-05-31T10:45:00.000Z',
        submittedForReviewBy: 'admin-1',
        createdBy: 'admin-1',
        updatedAt: '2026-05-31T10:45:00.000Z',
        approvalNotes: 'Client must approve before launch. token: ad-secret-123',
      }),
      makeDoc('ad-campaign-2', {
        orgId: 'org-1',
        platform: 'meta',
        adAccountId: 'act_123',
        name: 'Already approved push',
        objective: 'TRAFFIC',
        status: 'PENDING_REVIEW',
        reviewState: 'approved',
        updatedAt: '2026-05-31T09:45:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const adminFeed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'ad-campaign' },
    )
    const clientFeed = await buildBriefingFeed(
      { uid: 'client-1', role: 'client', orgIds: ['org-1'], orgId: 'org-1' },
      { limit: 10, sourceType: 'ad-campaign' },
    )

    expect(adminFeed.items).toHaveLength(1)
    expect(clientFeed.items).toHaveLength(1)
    expect(adminFeed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: { type: 'ad-campaign', id: 'ad-campaign-1', url: '/admin/org/client-one/ads/campaigns/ad-campaign-1' },
      title: 'Ad campaign awaiting approval: June lead generation push',
      actor: { id: 'admin-1', type: 'user' },
      context: {
        orgName: 'Client One',
        orgSlug: 'client-one',
        adCampaignId: 'ad-campaign-1',
        adCampaignName: 'June lead generation push',
      },
      metadata: expect.objectContaining({
        adCampaignStatus: 'PENDING_REVIEW',
        reviewState: 'awaiting',
        platform: 'meta',
        objective: 'LEADS',
        dailyBudget: 25000,
        adAccountId: 'act_123',
      }),
    })
    expect(adminFeed.items[0].summary).toContain('LEADS campaign')
    expect(adminFeed.items[0].summary).toContain('R250.00 daily budget')
    expect(JSON.stringify(adminFeed.items)).not.toContain('ad-secret-123')
    expect(JSON.stringify(adminFeed.items)).toContain('[REDACTED]')
  })

  it('surfaces new form submissions as source-backed follow-up cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.form_submissions = [
      makeDoc('submission-1', {
        orgId: 'org-1',
        formId: 'form-1',
        data: {
          name: 'Ava Owner',
          email: 'ava@example.test',
          message: 'Please send the pricing deck. password: never-show-this',
        },
        submittedAt: '2026-05-31T10:50:00.000Z',
        status: 'new',
        contactId: 'contact-1',
        source: 'website-contact',
        createdByRef: {
          uid: 'public-form',
          displayName: 'Website visitor',
          role: 'client',
        },
      }),
      makeDoc('submission-2', {
        orgId: 'org-1',
        formId: 'form-1',
        data: {
          name: 'Already Read',
          email: 'read@example.test',
        },
        submittedAt: '2026-05-31T09:50:00.000Z',
        status: 'read',
        contactId: null,
        source: 'website-contact',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'form-submission' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'form-submission',
        id: 'submission-1',
        url: '/admin/forms/form-1/submissions/submission-1',
      },
      title: 'New form submission from Ava Owner',
      actor: { id: 'public-form', name: 'Website visitor', role: 'client', type: 'user' },
      context: {
        orgName: 'Client One',
        formId: 'form-1',
        formSubmissionId: 'submission-1',
        contactId: 'contact-1',
        contactName: 'Ava Owner',
      },
      metadata: expect.objectContaining({
        formSubmissionStatus: 'new',
        formId: 'form-1',
        source: 'website-contact',
        email: 'ava@example.test',
      }),
    })
    expect(feed.items[0].summary).toContain('ava@example.test')
    expect(JSON.stringify(feed.items)).not.toContain('never-show-this')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces unread social inbox engagement as control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.social_inbox = [
      makeDoc('social-inbox-1', {
        orgId: 'org-1',
        platform: 'instagram',
        type: 'dm',
        fromUser: {
          name: 'Mia Prospect',
          username: 'mia_prospect',
          profileUrl: 'https://instagram.example/mia_prospect',
        },
        content: 'Can someone reply about the launch package? token: social-secret-123',
        postId: 'post-1',
        platformItemId: 'ig-dm-1',
        platformUrl: 'https://instagram.example/messages/ig-dm-1',
        status: 'unread',
        priority: 'high',
        sentiment: 'negative',
        createdAt: '2026-05-31T10:55:00.000Z',
        updatedAt: '2026-05-31T10:55:00.000Z',
      }),
      makeDoc('social-inbox-2', {
        orgId: 'org-1',
        platform: 'linkedin',
        type: 'comment',
        fromUser: { name: 'Already Done', username: 'done' },
        content: 'Already archived.',
        platformItemId: 'li-comment-1',
        platformUrl: 'https://linkedin.example/comment/li-comment-1',
        status: 'archived',
        priority: 'normal',
        createdAt: '2026-05-31T09:55:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'social-inbox' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'social-inbox',
        id: 'social-inbox-1',
        url: '/admin/social/inbox?item=social-inbox-1',
      },
      title: 'Social DM needs reply from Mia Prospect',
      actor: { id: 'social:mia_prospect', name: 'Mia Prospect', role: 'client', type: 'user' },
      context: {
        orgName: 'Client One',
        socialInboxId: 'social-inbox-1',
        socialInboxFrom: 'Mia Prospect',
        socialPostId: 'post-1',
      },
      metadata: expect.objectContaining({
        socialInboxStatus: 'unread',
        platform: 'instagram',
        engagementType: 'dm',
        priority: 'high',
        sentiment: 'negative',
        platformUrl: 'https://instagram.example/messages/ig-dm-1',
      }),
    })
    expect(feed.items[0].summary).toContain('instagram DM')
    expect(JSON.stringify(feed.items)).not.toContain('social-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces unread mailbox messages for the current user as control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.mailbox_messages = [
      makeDoc('mailbox-1', {
        orgId: 'org-1',
        uid: 'user-1',
        accountId: 'account-1',
        accountEmail: 'owner@client.test',
        folder: 'inbox',
        direction: 'inbound',
        status: 'received',
        read: false,
        starred: true,
        from: 'Client Lead <lead@example.test>',
        to: ['owner@client.test'],
        subject: 'Can we book a call?',
        bodyText: 'Please reply with available times. api_key: mailbox-secret-123',
        snippet: 'Please reply with available times.',
        providerMessageId: 'gmail-message-1',
        threadId: 'gmail-thread-1',
        receivedAt: '2026-05-31T10:45:00.000Z',
        updatedAt: '2026-05-31T10:46:00.000Z',
      }),
      makeDoc('mailbox-2', {
        orgId: 'org-1',
        uid: 'user-1',
        accountId: 'account-1',
        accountEmail: 'owner@client.test',
        folder: 'archive',
        direction: 'inbound',
        status: 'received',
        read: false,
        from: 'Archived Lead <archived@example.test>',
        subject: 'Already archived',
        bodyText: 'Do not show me.',
        receivedAt: '2026-05-31T09:45:00.000Z',
      }),
      makeDoc('mailbox-3', {
        orgId: 'org-1',
        uid: 'other-user',
        accountId: 'account-2',
        accountEmail: 'other@client.test',
        folder: 'inbox',
        direction: 'inbound',
        status: 'received',
        read: false,
        from: 'Other User Lead <other@example.test>',
        subject: 'Wrong mailbox',
        bodyText: 'Do not show another user mailbox.',
        receivedAt: '2026-05-31T09:45:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'user-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'mailbox-message' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'mailbox-message',
        id: 'mailbox-1',
        url: '/portal/email?message=mailbox-1',
      },
      title: 'Unread email from Client Lead',
      actor: { id: 'email:lead@example.test', name: 'Client Lead', role: 'client', type: 'user' },
      context: {
        orgName: 'Client One',
        mailboxMessageId: 'mailbox-1',
        mailboxFrom: 'Client Lead',
        mailboxSubject: 'Can we book a call?',
      },
      metadata: expect.objectContaining({
        mailboxFolder: 'inbox',
        mailboxStatus: 'received',
        mailboxRead: false,
        accountId: 'account-1',
        accountEmail: 'owner@client.test',
        providerMessageId: 'gmail-message-1',
        threadId: 'gmail-thread-1',
      }),
    })
    expect(feed.items[0].summary).toContain('Can we book a call?')
    expect(JSON.stringify(feed.items)).not.toContain('mailbox-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces live Hermes agent runs with approval and status context', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.hermes_runs = [
      makeDoc('run-doc-1', {
        orgId: 'org-1',
        profile: 'theo-main',
        hermesRunId: 'run-live-1',
        requestedBy: 'user:peet',
        prompt: 'Inspect the client SEO handoff. api_key: run-secret-123',
        status: 'waiting_for_approval',
        approval: {
          toolName: 'shell.exec',
          reason: 'Needs to inspect deployment logs',
        },
        createdAt: '2026-05-31T10:20:00.000Z',
        updatedAt: '2026-05-31T10:21:00.000Z',
      }),
      makeDoc('run-doc-2', {
        orgId: 'org-1',
        profile: 'maya-main',
        hermesRunId: 'run-live-2',
        requestedBy: 'user:peet',
        prompt: 'Finished content polish',
        status: 'completed',
        output: 'Updated draft and evidence.',
        createdAt: '2026-05-31T09:20:00.000Z',
      }),
      makeDoc('run-doc-3', {
        orgId: 'org-2',
        profile: 'delta-main',
        hermesRunId: 'run-other-org',
        requestedBy: 'user:peet',
        prompt: 'Wrong org run',
        status: 'waiting_for_approval',
        createdAt: '2026-05-31T09:20:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'agent-run' },
    )

    expect(feed.items).toHaveLength(2)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'agent-run',
        id: 'run-doc-1',
        url: '/admin/agents/theo?run=run-live-1',
      },
      title: 'Theo paused for approval',
      actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
      context: {
        orgName: 'Client One',
        agentRunId: 'run-live-1',
        agentProfile: 'theo-main',
      },
      metadata: expect.objectContaining({
        agentId: 'theo',
        runStatus: 'waiting_for_approval',
        hermesRunId: 'run-live-1',
        approvalToolName: 'shell.exec',
      }),
    })
    expect(feed.items[1]).toMatchObject({ priority: 'fyi', title: 'Maya finished a run' })
    expect(JSON.stringify(feed.items)).not.toContain('run-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces workspace broker jobs awaiting approval as control cards', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.workspace_broker_jobs = [
      makeDoc('broker-job-1', {
        orgId: 'org-1',
        operation: 'request_share',
        status: 'awaiting_approval',
        riskLevel: 'high',
        requiredCapability: 'publish',
        requestedBy: 'agent:theo',
        createdByType: 'agent',
        agentId: 'theo',
        input: {
          artifactId: 'artifact-1',
          title: 'Client-facing plan',
          visibility: 'admin_agents_clients',
          reason: 'Share with client. token: broker-secret-123',
        },
        output: { googleMutationPerformed: false },
        createdAt: '2026-05-31T10:40:00.000Z',
        updatedAt: '2026-05-31T10:41:00.000Z',
      }),
      makeDoc('broker-job-2', {
        orgId: 'org-1',
        operation: 'create_doc',
        status: 'done',
        riskLevel: 'medium',
        requiredCapability: 'write',
        requestedBy: 'user:peet',
        input: { title: 'Already done' },
        createdAt: '2026-05-31T09:40:00.000Z',
      }),
      makeDoc('broker-job-3', {
        orgId: 'org-2',
        operation: 'request_delete',
        status: 'awaiting_approval',
        riskLevel: 'high',
        requiredCapability: 'delete',
        requestedBy: 'agent:maya',
        input: { title: 'Wrong org' },
        createdAt: '2026-05-31T09:40:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
      { limit: 10, sourceType: 'workspace-broker-job' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'workspace-broker-job',
        id: 'broker-job-1',
        url: '/admin/knowledge/workspace-broker/jobs/broker-job-1',
      },
      title: 'Workspace share request needs approval: Client-facing plan',
      actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
      context: {
        orgName: 'Client One',
        workspaceBrokerJobId: 'broker-job-1',
        workspaceBrokerOperation: 'request_share',
        workspaceArtifactId: 'artifact-1',
      },
      metadata: expect.objectContaining({
        brokerStatus: 'awaiting_approval',
        riskLevel: 'high',
        requiredCapability: 'publish',
        googleMutationPerformed: false,
      }),
    })
    expect(feed.items[0].summary).toContain('share request')
    expect(JSON.stringify(feed.items)).not.toContain('broker-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })

  it('surfaces upcoming calendar events with pending RSVP context for the current user', async () => {
    collections.organizations = [makeDoc('org-1', { name: 'Client One', slug: 'client-one' })]
    collections.calendar_events = [
      makeDoc('event-1', {
        orgId: 'org-1',
        title: 'Website retainer check-in',
        description: 'Confirm launch blockers. token: calendar-secret-123',
        startAt: '2026-06-01T08:00:00.000Z',
        endAt: '2026-06-01T08:30:00.000Z',
        timezone: 'Africa/Johannesburg',
        location: 'Google Meet',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        attendees: [
          { name: 'Ava Owner', email: 'ava@example.test', userId: 'user-1', status: 'pending' },
        ],
        assignedTo: { type: 'user', id: 'user-1' },
        relatedTo: { type: 'contact', id: 'contact-1' },
        createdBy: 'admin-1',
        createdByType: 'user',
        deleted: false,
        createdAt: '2026-05-31T10:50:00.000Z',
        updatedAt: '2026-05-31T10:51:00.000Z',
      }),
      makeDoc('event-2', {
        orgId: 'org-1',
        title: 'Already accepted',
        startAt: '2026-06-01T09:00:00.000Z',
        endAt: '2026-06-01T09:30:00.000Z',
        attendees: [{ name: 'Ava Owner', email: 'ava@example.test', userId: 'user-1', status: 'accepted' }],
        assignedTo: { type: 'user', id: 'user-1' },
        deleted: false,
        createdAt: '2026-05-31T10:40:00.000Z',
      }),
      makeDoc('event-3', {
        orgId: 'org-2',
        title: 'Wrong org meeting',
        startAt: '2026-06-01T10:00:00.000Z',
        endAt: '2026-06-01T10:30:00.000Z',
        attendees: [{ name: 'Ava Owner', email: 'ava@example.test', userId: 'user-1', status: 'pending' }],
        assignedTo: { type: 'user', id: 'user-1' },
        deleted: false,
        createdAt: '2026-05-31T10:35:00.000Z',
      }),
    ]

    const { buildBriefingFeed } = await import('@/lib/briefing/feed')
    const feed = await buildBriefingFeed(
      { uid: 'user-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
      { limit: 10, sourceType: 'calendar-event' },
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      priority: 'needs-peet',
      requiresAction: true,
      source: {
        type: 'calendar-event',
        id: 'event-1',
        url: '/portal/contacts/contact-1?event=event-1',
      },
      title: 'RSVP needed: Website retainer check-in',
      actor: { id: 'user:admin-1', role: 'admin', type: 'user' },
      context: {
        orgName: 'Client One',
        calendarEventId: 'event-1',
        calendarEventTitle: 'Website retainer check-in',
        contactId: 'contact-1',
      },
      metadata: expect.objectContaining({
        rsvpStatus: 'pending',
        attendeeEmail: 'ava@example.test',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        startAt: '2026-06-01T08:00:00.000Z',
      }),
    })
    expect(feed.items[0].summary).toContain('Africa/Johannesburg')
    expect(JSON.stringify(feed.items)).not.toContain('calendar-secret-123')
    expect(JSON.stringify(feed.items)).toContain('[REDACTED]')
  })
})
