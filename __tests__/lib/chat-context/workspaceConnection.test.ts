const mockConnectionGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'workspace_connection',
          id: 'connection-1',
          orgId: 'org-1',
          label: 'Parent Google Workspace',
          icon: 'link',
        },
        pulse: { label: 'connection', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: ['open'],
        asOf: '2026-07-31T09:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockConnectionGet }),
    }),
  },
}))

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    orgId: 'org-1',
    connectionKey: 'parent-google-workspace',
    displayName: 'Parent Google Workspace',
    provider: 'google_workspace',
    connectionType: 'user_oauth',
    status: 'active',
    ownerAgentId: null,
    ownerUserId: 'admin-1',
    owner: { id: 'admin-1', type: 'user' },
    visibility: 'admin_agents',
    resourceType: 'workspace',
    resourceId: null,
    projectId: null,
    taskId: null,
    clientDocumentId: null,
    sourceDocumentId: null,
    sourceResearchItemId: null,
    capabilityScopes: [],
    audit: {
      approvalStatus: 'approved',
      auditStatus: 'checked',
      riskLevel: 'low',
      approvalGateTaskId: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
    },
    safeMetadata: {},
    googleCloudProjectId: null,
    oauthClientId: null,
    serviceAccountEmail: null,
    automationIdentity: 'tbd',
    scopes: [{ scope: 'driveRead', classification: 'non_sensitive', approved: true, approvedBy: null, approvedAt: null, approvalGateTaskId: null }],
    capabilities: {
      driveRead: true,
      driveWrite: false,
      driveShare: false,
      driveDelete: false,
      docsRead: false,
      docsWrite: false,
      sheetsRead: false,
      sheetsWrite: false,
      externalShare: false,
      xPostsRead: false,
      xSearchRead: false,
      xUsersRead: false,
      xBookmarksRead: false,
      xBookmarksWrite: false,
      xNewsRead: false,
      xArticlesWrite: false,
    },
    credentialRef: { secretName: null, envVarName: null, tokenStorePath: null, keyPrefix: null },
    redirectUri: null,
    tokenStatus: 'valid',
    reconnectInstructions: 'Run OAuth flow',
    allowedOrgIds: [],
    restrictedResourceIds: [],
    dataTouched: [],
    approvalStatus: 'approved',
    approvalGateTaskId: null,
    riskLevel: 'low',
    retentionRule: null,
    rollbackPath: null,
    lastReviewedAt: '2026-07-31T08:00:00.000Z',
    lastReviewedBy: 'admin-1',
    deleted: false,
    ...overrides,
  }
}

describe('workspace_connection chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConnectionGet.mockResolvedValue({
      exists: true,
      id: 'connection-1',
      data: () => connection(),
    })
  })

  it('projects workspace connection lifecycle, scopes, owner, and actions for an admin user', async () => {
    const { workspaceConnectionChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceConnection')
    const result = await workspaceConnectionChatContextAdapter.resolve({
      kind: 'workspace_connection',
      id: 'connection-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      label: 'Parent Google Workspace',
      href: '/admin/workspace/connections/connection-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'Active' },
      { id: 'token', label: 'Token', value: 'Valid' },
      { id: 'risk', label: 'Risk', value: 'Low' },
    ]))
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approve-workspace-connection:connection-1' }),
      expect.objectContaining({ id: 'retire-workspace-connection:connection-1' }),
      expect.not.objectContaining({ id: 'reconnect-workspace-connection:connection-1' }),
    ]))
  })

  it('returns review attention for proposed connections', async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      id: 'connection-1',
      data: () => connection({ status: 'proposed' }),
    })
    const { workspaceConnectionChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceConnection')
    const result = await workspaceConnectionChatContextAdapter.resolve({
      kind: 'workspace_connection',
      id: 'connection-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'workspace-connection-review-required',
      state: 'needs_approval',
      actions: expect.arrayContaining([expect.objectContaining({ id: 'approve-workspace-connection:connection-1' })]),
    }))
  })

  it('blocks clients from reading workspace connection context', async () => {
    const { workspaceConnectionChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceConnection')
    await expect(workspaceConnectionChatContextAdapter.resolve({
      kind: 'workspace_connection',
      id: 'connection-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('fails closed for cross-org or deleted records', async () => {
    mockConnectionGet.mockResolvedValueOnce({
      exists: true,
      id: 'connection-1',
      data: () => connection({ orgId: 'org-2', deleted: false }),
    })
    const { workspaceConnectionChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceConnection')
    await expect(workspaceConnectionChatContextAdapter.resolve({
      kind: 'workspace_connection',
      id: 'connection-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
