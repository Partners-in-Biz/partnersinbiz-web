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
})
