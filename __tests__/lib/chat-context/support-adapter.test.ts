const mockGetSupportTicket = jest.fn()
const mockListSupportMessages = jest.fn()
const mockAssigneeGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'support',
          id: 'support-1',
          orgId: 'org-1',
          label: 'Launch issue',
          icon: 'support_agent',
          href: '/admin/support?ticket=support-1',
        },
        pulse: { label: 'support', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        relationships: [{ kind: 'project', id: 'project-1', label: 'Launch project', relation: 'Project' }],
        capabilities: ['open'],
        asOf: '2026-07-31T09:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/support/store', () => ({
  getSupportTicket: (...args: unknown[]) => mockGetSupportTicket(...args),
  listSupportMessages: (...args: unknown[]) => mockListSupportMessages(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockAssigneeGet }),
    }),
  },
}))

describe('support chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSupportTicket.mockResolvedValue({
      id: 'support-1',
      orgId: 'org-1',
      createdBy: 'client-1',
      requesterName: 'Jane Client',
      requesterEmail: 'jane@example.com',
      category: 'bug',
      subject: 'Launch issue',
      description: 'The launch page is not loading.',
      status: 'waiting_on_us',
      priority: 'urgent',
      projectId: 'project-1',
      assignedToType: 'user',
      assigneeUserId: 'admin-2',
      messageCount: 2,
      lastMessagePreview: 'It still fails after refresh.',
      updatedAt: '2026-07-31T10:00:00.000Z',
    })
    mockListSupportMessages.mockResolvedValue([
      {
        id: 'message-1',
        ticketId: 'support-1',
        orgId: 'org-1',
        authorId: 'admin-2',
        authorRole: 'admin',
        authorName: 'Operator',
        body: 'Please try a hard refresh.',
        attachments: [],
        createdAt: '2026-07-31T09:30:00.000Z',
      },
      {
        id: 'message-2',
        ticketId: 'support-1',
        orgId: 'org-1',
        authorId: 'client-1',
        authorRole: 'client',
        authorName: 'Jane Client',
        body: 'It still fails after refresh.',
        attachments: [],
        createdAt: '2026-07-31T10:00:00.000Z',
      },
    ])
    mockAssigneeGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Alex Operator' }),
    })
  })

  it('projects the live thread, urgent response attention, assignee and admin controls', async () => {
    const { supportChatContextAdapter } = await import('@/lib/chat-context/adapters/support')
    const result = await supportChatContextAdapter.resolve({
      kind: 'support',
      id: 'support-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual([
      { id: 'status', label: 'Status', value: 'Waiting On Us' },
      { id: 'priority', label: 'Priority', value: 'Urgent' },
      { id: 'category', label: 'Category', value: 'Bug' },
      { id: 'messages', label: 'Messages', value: 2 },
      { id: 'assignee', label: 'Assignee', value: 'Alex Operator' },
    ])
    expect(result.model.groups.find((group) => group.id === 'messages')?.items).toHaveLength(2)
    expect(result.model.attention.map((item) => item.id)).toEqual([
      'support-response-due',
      'urgent-support-ticket',
    ])
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claim-support-ticket:support-1' }),
      expect.objectContaining({ id: 'resolve-support-ticket:support-1' }),
    ]))
    expect(result.model.relationships).toEqual([
      { kind: 'project', id: 'project-1', label: 'Launch project', relation: 'Project' },
    ])
    expect(result.model.context.href).toBe('/admin/support?ticket=support-1')
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('keeps a client-owned ticket read-only and deep-links to the support drawer', async () => {
    const { supportChatContextAdapter } = await import('@/lib/chat-context/adapters/support')
    const result = await supportChatContextAdapter.resolve({
      kind: 'support',
      id: 'support-1',
      user: {
        uid: 'client-1',
        role: 'client',
        orgId: 'org-1',
        activeOrgId: 'org-1',
        orgIds: ['org-1'],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.context.href).toBe('/portal/dashboard?support=open&ticket=support-1&orgId=org-1')
    expect(result.model.capabilities).not.toContain('inline-actions')
  })

  it('fails closed when a client did not create the ticket', async () => {
    const { supportChatContextAdapter } = await import('@/lib/chat-context/adapters/support')
    const result = await supportChatContextAdapter.resolve({
      kind: 'support',
      id: 'support-1',
      user: { uid: 'client-2', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
    })

    expect(result).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    expect(mockListSupportMessages).not.toHaveBeenCalled()
  })
})
