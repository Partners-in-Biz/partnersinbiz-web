const mockTaskListGet = jest.fn()
const mockGlobalTaskGet = jest.fn()
const mockGetProjectForUser = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'task',
          id: 'task-1',
          orgId: 'org-1',
          label: 'Review launch',
          icon: 'task_alt',
        },
        pulse: { label: 'task', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [{ id: 'task-updated', type: 'running', label: 'Task updated', occurredAt: '2026-07-31T08:00:00.000Z' }],
        capabilities: ['open'],
        asOf: '2026-07-31T08:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => name === 'projects'
      ? {
          doc: () => ({
            collection: () => ({ get: mockTaskListGet }),
          }),
        }
      : {
          doc: () => ({ get: mockGlobalTaskGet }),
        },
  },
}))

describe('task chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: {
        data: () => ({ orgId: 'org-1', name: 'Launch project', status: 'active' }),
      },
      projectAccess: { role: 'manager', canViewInternal: true },
    })
    mockTaskListGet.mockResolvedValue({
      docs: [
        {
          id: 'gate-1',
          data: () => ({
            orgId: 'org-1',
            title: 'Approve scope',
            columnId: 'done',
            approvalStatus: 'approved',
          }),
        },
        {
          id: 'task-1',
          data: () => ({
            orgId: 'org-1',
            title: 'Review launch',
            description: 'Review the final launch package.',
            priority: 'high',
            columnId: 'review',
            agentStatus: 'done',
            assigneeAgentId: 'theo',
            reviewStatus: 'pending',
            reviewerAgentId: 'qa-release',
            dependsOn: ['gate-1'],
            agentOutput: { summary: 'Implementation and tests are complete.' },
            updatedAt: '2026-07-31T08:00:00.000Z',
          }),
        },
      ],
    })
  })

  it('projects the exact project task with dependencies, agent state, project relation, and review action', async () => {
    const { taskChatContextAdapter } = await import('@/lib/chat-context/adapters/task')
    const result = await taskChatContextAdapter.resolve({
      kind: 'task',
      id: 'task-1',
      projectId: 'project-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      label: 'Review launch',
      href: '/portal/projects/project-1?taskId=task-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'state', label: 'State', value: 'Review' },
      { id: 'priority', label: 'Priority', value: 'High' },
      { id: 'dependencies', label: 'Open dependencies', value: 0 },
      { id: 'agent', label: 'Agent', value: 'theo' },
    ]))
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      label: 'Task is ready for review',
      actions: [expect.objectContaining({ id: 'approve-review:task-1' })],
    }))
    expect(result.model.relationships).toEqual([
      expect.objectContaining({ kind: 'project', id: 'project-1', label: 'Launch project' }),
    ])
    expect(result.model.groups[0].items[0].agent).toEqual(expect.objectContaining({
      agentId: 'theo',
      summary: 'Implementation and tests are complete.',
    }))
  })

  it('keeps a project viewer read-only', async () => {
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { data: () => ({ orgId: 'org-1', name: 'Launch project' }) },
      projectAccess: { role: 'viewer', canViewInternal: false },
    })
    const { taskChatContextAdapter } = await import('@/lib/chat-context/adapters/task')
    const result = await taskChatContextAdapter.resolve({
      kind: 'task',
      id: 'task-1',
      projectId: 'project-1',
      user: { uid: 'member-1', role: 'client', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).not.toContain('inline-actions')
  })

  it('offers global task completion only to admins and fails closed across organisations', async () => {
    mockGlobalTaskGet.mockResolvedValue({
      exists: true,
      id: 'task-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Prepare briefing',
        description: 'Prepare the weekly briefing.',
        priority: 'normal',
        status: 'todo',
        deleted: false,
      }),
    })
    const { taskChatContextAdapter } = await import('@/lib/chat-context/adapters/task')
    const result = await taskChatContextAdapter.resolve({
      kind: 'task',
      id: 'task-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.model.groups[0].items[0].actions).toEqual([
        expect.objectContaining({ id: 'complete-global-task:task-1' }),
      ])
    }

    mockGlobalTaskGet.mockResolvedValueOnce({
      exists: true,
      id: 'task-1',
      data: () => ({ orgId: 'org-2', title: 'Private task', status: 'todo' }),
    })
    await expect(taskChatContextAdapter.resolve({
      kind: 'task',
      id: 'task-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
