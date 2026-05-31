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
})
