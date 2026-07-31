const mockJobGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'workspace_broker_job',
          id: 'job-1',
          orgId: 'org-1',
          label: 'create_doc',
          icon: 'sync_alt',
        },
        pulse: { label: 'job', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: ['open'],
        asOf: '2026-07-31T08:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockJobGet }),
    }),
  },
}))

function job(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    operation: 'create_doc',
    status: 'awaiting_approval',
    connectionId: 'connection-1',
    requestedBy: 'admin-1',
    createdByType: 'user',
    agentId: 'docs',
    approvalGateTaskId: 'gate-1',
    approvalStatus: 'pending',
    requiredCapability: 'write',
    requestedCapability: 'write',
    riskLevel: 'medium',
    approvalRequired: true,
    approvalSatisfied: false,
    approvalEvidence: { gateTaskId: 'gate-1', status: 'pending' },
    requester: { id: 'admin-1', type: 'user', role: 'user', agentId: 'docs' },
    targetResource: { orgId: 'org-1', title: 'Launch brief', projectId: 'project-1' },
    input: { title: 'Launch brief' },
    output: { googleMutationPerformed: false, artifactIds: [], artifactUrls: [], resultArtifactIds: [], resultArtifactUrls: [] },
    resultArtifactIds: [],
    resultArtifactUrls: [],
    error: null,
    errors: [],
    attempts: 0,
    requestedAt: '2026-07-31T07:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

describe('workspace broker job chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockJobGet.mockResolvedValue({
      exists: true,
      id: 'job-1',
      data: () => job(),
    })
  })

  it('projects approval evidence and confirmation-gated approve/reject controls', async () => {
    const { workspaceBrokerJobChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceBrokerJob')
    const result = await workspaceBrokerJobChatContextAdapter.resolve({
      kind: 'workspace_broker_job',
      id: 'job-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      label: 'Create Doc workspace job',
      href: '/admin/briefings?workspaceJobId=job-1&orgId=org-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'Awaiting Approval' },
      { id: 'risk', label: 'Risk', value: 'Medium' },
      { id: 'capability', label: 'Capability', value: 'Write' },
    ]))
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'workspace-job-approval',
      actions: [
        expect.objectContaining({ id: 'approve-workspace-job:job-1', body: { action: 'approve', approvalGateTaskId: 'gate-1' } }),
        expect.objectContaining({ id: 'reject-workspace-job:job-1', destructive: true }),
      ],
    }))
  })

  it('offers execution only after complete approval evidence and queued state', async () => {
    mockJobGet.mockResolvedValue({
      exists: true,
      id: 'job-1',
      data: () => job({
        status: 'queued',
        approvalStatus: 'approved',
        approvalSatisfied: true,
        approvalEvidence: {
          gateTaskId: 'gate-1',
          status: 'approved',
          decidedBy: 'admin-1',
          decidedAt: '2026-07-31T08:00:00.000Z',
        },
      }),
    })
    const { workspaceBrokerJobChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceBrokerJob')
    const result = await workspaceBrokerJobChatContextAdapter.resolve({
      kind: 'workspace_broker_job',
      id: 'job-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.groups[0].items[0].actions).toEqual([
      expect.objectContaining({
        id: 'execute-workspace-job:job-1',
        requiresApproval: true,
        body: { action: 'execute' },
      }),
    ])
  })

  it('fails closed for members and cross-organisation records', async () => {
    const { workspaceBrokerJobChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceBrokerJob')
    await expect(workspaceBrokerJobChatContextAdapter.resolve({
      kind: 'workspace_broker_job',
      id: 'job-1',
      user: { uid: 'member-1', role: 'client', authKind: 'session', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })

    mockJobGet.mockResolvedValueOnce({
      exists: true,
      id: 'job-1',
      data: () => job({ orgId: 'org-2' }),
    })
    await expect(workspaceBrokerJobChatContextAdapter.resolve({
      kind: 'workspace_broker_job',
      id: 'job-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
