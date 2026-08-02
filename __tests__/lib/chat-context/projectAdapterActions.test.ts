const mockGetProjectForUser = jest.fn()
const mockTasksGet = jest.fn()
const mockGetConversation = jest.fn()
const mockCanAccessConversation = jest.fn(() => true)
const mockGetProjectConversationComputerLinkStatus = jest.fn()

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({ get: mockTasksGet }),
      }),
    }),
  },
}))
jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
}))
jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: (...args: unknown[]) => mockCanAccessConversation(...args),
}))
jest.mock('@/lib/project-locations/auto-link-conversation-computer', () => ({
  getProjectConversationComputerLinkStatus: (...args: unknown[]) => mockGetProjectConversationComputerLinkStatus(...args),
}))

function projectAccess(role: 'owner' | 'contributor' | 'viewer' = 'owner') {
  return {
    ok: true,
    projectAccess: { role },
    doc: {
      data: () => ({ id: 'project-1', name: 'Launch', orgId: 'org-1', status: 'active' }),
    },
  }
}

function taskDoc(id: string, value: Record<string, unknown>) {
  return { id, data: () => value }
}

describe('project chat context adapter actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetProjectForUser.mockResolvedValue(projectAccess())
  })

  it('projects admin approval and writer review/unblock actions into the live model', async () => {
    mockTasksGet.mockResolvedValue({
      docs: [
        taskDoc('approval', { title: 'Approve sender', approvalStatus: 'pending', columnId: 'blocked' }),
        taskDoc('review', { title: 'Review copy', reviewStatus: 'pending', columnId: 'review' }),
        taskDoc('blocked', { title: 'Retry export', agentStatus: 'blocked', columnId: 'blocked', assigneeAgentId: 'pip' }),
      ],
    })
    const { projectChatContextAdapter } = await import('@/lib/chat-context/adapters/project')
    const result = await projectChatContextAdapter.resolve({
      kind: 'project',
      id: 'project-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const items = result.model.groups[0].items
    expect(items.find((item) => item.id === 'approval')?.actions?.[0]).toEqual(expect.objectContaining({
      label: 'Approve next step',
      body: { approvalStatus: 'approved' },
    }))
    expect(items.find((item) => item.id === 'review')?.actions?.[0]).toEqual(expect.objectContaining({
      label: 'Approve and complete',
    }))
    expect(items.find((item) => item.id === 'blocked')?.actions?.[0]).toEqual(expect.objectContaining({
      label: 'Unblock and requeue',
    }))
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('does not project mutation actions for a project viewer', async () => {
    mockGetProjectForUser.mockResolvedValue(projectAccess('viewer'))
    mockTasksGet.mockResolvedValue({
      docs: [taskDoc('review', { title: 'Review copy', reviewStatus: 'pending', columnId: 'review' })],
    })
    const { projectChatContextAdapter } = await import('@/lib/chat-context/adapters/project')
    const result = await projectChatContextAdapter.resolve({
      kind: 'project',
      id: 'project-1',
      user: { uid: 'viewer-1', role: 'client', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).toEqual(['view'])
  })

  it('surfaces Link to this computer when the project lacks a replica on the chat machine', async () => {
    mockTasksGet.mockResolvedValue({ docs: [] })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      workspaceContext: {
        workspaceId: 'ws-1',
        runtimeTarget: 'linked-device:mac-mini',
        runtimeLabel: 'Peets-Mac-mini',
      },
    })
    mockGetProjectConversationComputerLinkStatus.mockResolvedValue({
      status: 'not_linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
      reason: 'no_replica',
    })

    const { projectChatContextAdapter } = await import('@/lib/chat-context/adapters/project')
    const result = await projectChatContextAdapter.resolve({
      kind: 'project',
      id: 'project-1',
      conversationId: 'conv-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const computerAttention = result.model.attention.find((item) => item.id === 'project-computer-link')
    expect(computerAttention).toEqual(expect.objectContaining({
      label: 'Project is not on Peets-Mac-mini',
      state: 'needs_input',
    }))
    expect(computerAttention?.actions?.[0]).toEqual({
      id: 'link-to-chat-computer',
      label: 'Link to Peets-Mac-mini',
      href: '/api/v1/projects/project-1/link-to-conversation',
      method: 'POST',
      body: { conversationId: 'conv-1' },
    })
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('does not surface computer link attention when the project is already linked', async () => {
    mockTasksGet.mockResolvedValue({ docs: [] })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      workspaceContext: {
        workspaceId: 'ws-1',
        runtimeTarget: 'linked-device:mac-mini',
        runtimeLabel: 'Peets-Mac-mini',
      },
    })
    mockGetProjectConversationComputerLinkStatus.mockResolvedValue({
      status: 'linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
    })

    const { projectChatContextAdapter } = await import('@/lib/chat-context/adapters/project')
    const result = await projectChatContextAdapter.resolve({
      kind: 'project',
      id: 'project-1',
      conversationId: 'conv-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.attention.find((item) => item.id === 'project-computer-link')).toBeUndefined()
  })
})
