const mockIndexedGet = jest.fn()
const mockFallbackGet = jest.fn()
const mockIndexedLimit = jest.fn(() => ({ get: mockIndexedGet }))
const mockOrderBy = jest.fn(() => ({ limit: mockIndexedLimit }))
const mockWhere = jest.fn()
const mockQuery = {
  where: mockWhere,
  orderBy: mockOrderBy,
  get: mockFallbackGet,
}
const mockCollection = jest.fn(() => ({ where: mockWhere }))
const mockGetProjectForUser = jest.fn()
const mockProjectLinkedToOrganization = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  getAdminApp: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: jest.fn((value: number) => ({ increment: value })),
    serverTimestamp: jest.fn(() => ({ serverTimestamp: true })),
  },
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(),
}))

jest.mock('@/lib/projects/access', () => ({ getProjectForUser: mockGetProjectForUser }))
jest.mock('@/lib/projects/organization-link', () => ({
  projectLinkedToOrganization: mockProjectLinkedToOrganization,
}))

function timestamp(ms: number) {
  return { toMillis: () => ms }
}

function conversationDoc(
  id: string,
  updatedAtMs: number,
  participantUids = ['admin-1'],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    data: () => ({
      orgId: 'pib-platform-owner',
      startedBy: 'admin-1',
      participantUids,
      participantAgentIds: ['pip'],
      participants: [],
      title: id,
      archived: false,
      messageCount: 0,
      updatedAt: timestamp(updatedAtMs),
      ...extra,
    }),
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockWhere.mockReturnValue(mockQuery)
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'pib-platform-owner' }) },
  })
  mockProjectLinkedToOrganization.mockResolvedValue(true)
})

describe('listConversations', () => {
  it('does not list private conversations for a scoped administrator who was not invited', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [
        conversationDoc('invited', 2000),
        conversationDoc('not-invited', 3000, ['other-admin']),
      ],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
    )

    expect(conversations.map((conversation) => conversation.id)).toEqual(['invited'])
  })

  it('falls back to an org query and sorts in memory while the composite index is unavailable', async () => {
    mockIndexedGet.mockRejectedValue(Object.assign(new Error('The query requires an index.'), {
      code: 9,
      details: 'The query requires an index.',
    }))
    mockFallbackGet.mockResolvedValue({
      docs: [
        conversationDoc('older', 1000),
        conversationDoc('newest', 3000),
        conversationDoc('middle', 2000),
      ],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      2,
    )

    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc')
    expect(mockFallbackGet).toHaveBeenCalledTimes(2)
    expect(conversations.map((conversation) => conversation.id)).toEqual(['newest', 'middle'])
  })

  it('does not hide unexpected Firestore failures behind the fallback', async () => {
    mockIndexedGet.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 7 }))

    const { listConversations } = await import('@/lib/conversations/conversations')

    await expect(listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
    )).rejects.toThrow('permission denied')
    expect(mockFallbackGet).not.toHaveBeenCalled()
  })

  it('can bypass scope filters with includeAllScopes', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [
        conversationDoc('project-chat', 3000, ['admin-1'], {
          scope: 'project',
          scopeRefId: 'project-1',
        }),
        conversationDoc('task-chat', 2000, ['admin-1'], {
          scope: 'task',
          scopeRefId: 'task-1',
        }),
      ],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
      { scope: 'project', scopeRefId: 'project-1', includeAllScopes: true },
    )

    expect(mockWhere).toHaveBeenCalledTimes(2)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).toHaveBeenCalledWith('crossOrg.participantOrgIds', 'array-contains', 'pib-platform-owner')
    expect(mockIndexedLimit).toHaveBeenCalledWith(100)
    expect(conversations.map((conversation) => conversation.id)).toEqual(['project-chat', 'task-chat'])
  })

  it('filters project conversations in Firestore before applying the read limit', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [conversationDoc('project-chat', 3000, ['admin-1'], {
        scope: 'project',
        scopeRefId: 'project-1',
      })],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
      { scope: 'project', projectId: 'project-1' },
    )

    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).toHaveBeenCalledWith('crossOrg.participantOrgIds', 'array-contains', 'pib-platform-owner')
    expect(mockWhere).toHaveBeenCalledWith('scopeRefId', '==', 'project-1')
    expect(mockIndexedLimit).toHaveBeenCalledWith(60)
    expect(conversations.map((conversation) => conversation.id)).toEqual(['project-chat'])
  })

  it('lists a foreign participant into a bilateral thread only when policy allows it', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [
        conversationDoc('bilateral', 4000, ['owner-a', 'member-b'], {
          orgId: 'org-a',
          crossOrg: {
            partnerLinkId: 'link-ab',
            ownerOrgId: 'org-a',
            participantOrgIds: ['org-a', 'org-b'],
            thread: { kind: 'project', resourceType: 'project', resourceId: 'project-ab' },
            status: 'active',
            accessEpoch: 1,
            retention: { foreignParticipantRetentionDays: 30 },
            participants: [
              { principalId: 'user:owner-a', kind: 'user', uid: 'owner-a', orgId: 'org-a', role: 'owner', status: 'active' },
              { principalId: 'user:member-b', kind: 'user', uid: 'member-b', orgId: 'org-b', role: 'member', status: 'active' },
            ],
          },
        }),
        conversationDoc('third-org', 3000, ['owner-a', 'member-c'], {
          orgId: 'org-a',
          crossOrg: {
            partnerLinkId: 'link-ac',
            ownerOrgId: 'org-a',
            participantOrgIds: ['org-a', 'org-c'],
            thread: { kind: 'relationship', resourceType: 'relationship', resourceId: 'rel-ac' },
            status: 'active',
            accessEpoch: 1,
            retention: { foreignParticipantRetentionDays: 30 },
            participants: [
              { principalId: 'user:owner-a', kind: 'user', uid: 'owner-a', orgId: 'org-a', role: 'owner', status: 'active' },
              { principalId: 'user:member-c', kind: 'user', uid: 'member-c', orgId: 'org-c', role: 'member', status: 'active' },
            ],
          },
        }),
      ],
    })

    jest.doMock('@/lib/conversations/cross-org', () => ({
      evaluateCrossOrgConversationAccess: jest.fn(async ({ user, conversation }: {
        user: { uid: string }
        conversation: { id: string }
      }) => ({
        allowed: conversation.id === 'bilateral' && user.uid === 'member-b',
        principalId: user.uid === 'member-b' ? 'user:member-b' : undefined,
      })),
    }))

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'org-b',
      { uid: 'member-b', role: 'client', orgId: 'org-b' },
      30,
    )

    expect(conversations.map((conversation) => conversation.id)).toEqual(['bilateral'])
  })

  it('drops project conversations when current project access has been revoked', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [conversationDoc('project-chat', 3000, ['admin-1'], {
        scope: 'project',
        scopeRefId: 'project-1',
      })],
    })
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
    )

    expect(conversations).toEqual([])
  })

  it('lists contact embed threads by hard scope or contextRefs, never the full Messages rail', async () => {
    mockIndexedGet.mockResolvedValue({
      docs: [
        conversationDoc('contact-workspace', 5000, ['admin-1'], {
          scope: 'contact',
          scopeRefId: 'contact-ada',
        }),
        conversationDoc('context-linked', 4000, ['admin-1'], {
          scope: 'general',
          contextRefs: [{ type: 'contact', id: 'contact-ada', orgId: 'pib-platform-owner', label: 'Ada' }],
        }),
        conversationDoc('other-contact', 3000, ['admin-1'], {
          scope: 'contact',
          scopeRefId: 'contact-other',
        }),
        conversationDoc('unrelated-private', 2000, ['admin-1'], {
          scope: 'general',
          title: 'Default',
        }),
      ],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
      { scope: 'contact', scopeRefId: 'contact-ada' },
    )

    // Contact embeds must scan recent org threads so context-linked chats surface,
    // not only docs whose scopeRefId equals the contact id.
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('scopeRefId', '==', 'contact-ada')
    expect(conversations.map((conversation) => conversation.id)).toEqual([
      'contact-workspace',
      'context-linked',
    ])
  })
})
