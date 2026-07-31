const mockArtifactGet = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'workspace_artifact',
          id: 'artifact-1',
          orgId: 'org-1',
          label: 'Launch brief',
          icon: 'draft',
        },
        pulse: { label: 'artifact', metrics: [] },
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

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockArtifactGet }),
    }),
  },
}))

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    artifactKey: 'launch-brief',
    title: 'Launch brief',
    artifactType: 'google_doc',
    mimeType: 'application/vnd.google-apps.document',
    google: {
      fileId: 'google-file-1',
      folderId: 'folder-1',
      driveId: null,
      url: 'https://docs.google.com/document/d/google-file-1/edit',
      webViewLink: 'https://docs.google.com/document/d/google-file-1/edit',
      webContentLink: null,
      parents: ['folder-1'],
    },
    workspaceFolderId: 'workspace-folder-1',
    connectionId: 'connection-1',
    resourceType: 'project',
    resourceId: 'project-1',
    projectId: 'project-1',
    taskId: null,
    clientDocumentId: null,
    sourceDocumentId: null,
    sourceDocumentSectionId: null,
    sourceSpecVersion: 'v3',
    sourceResearchItemId: null,
    approvalGateTaskId: null,
    agentId: 'docs',
    provider: 'google_workspace',
    owner: { type: 'agent', id: 'docs' },
    capabilityScopes: ['read', 'write'],
    audit: {
      approvalStatus: 'approved',
      auditStatus: 'checked',
      riskLevel: 'low',
      approvalGateTaskId: null,
      lastReviewedAt: '2026-07-31T07:00:00.000Z',
      lastReviewedBy: 'admin-1',
      notes: null,
    },
    safeMetadata: {},
    visibility: 'admin_agents',
    lifecycleStatus: 'approved',
    piBCanonicalUrl: null,
    sourceTemplateArtifactId: null,
    naming: { conventionVersion: '1', generatedName: 'Launch brief', versionLabel: '3' },
    permissions: {
      externalShared: false,
      anyoneWithLink: false,
      domainShared: false,
      aclAlignmentStatus: 'unknown',
      lastCheckedAt: null,
      allowedAgentIds: ['docs'],
    },
    sync: {
      sourceOfTruth: 'google_drive',
      syncMode: 'metadata_only',
      syncStatus: 'synced',
      lastSyncedAt: '2026-07-31T08:00:00.000Z',
      conflictStatus: 'none',
    },
    deleted: false,
    ...overrides,
  }
}

describe('workspace artifact chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockArtifactGet.mockResolvedValue({
      exists: true,
      id: 'artifact-1',
      data: () => artifact(),
    })
    mockResolveContextReferences.mockResolvedValue([{
      type: 'project',
      id: 'project-1',
      orgId: 'org-1',
      label: 'Launch project',
      href: '/portal/projects/project-1',
    }])
  })

  it('projects live lifecycle, visibility, provider ACL, sync, provenance, and a permission-audit action', async () => {
    const { workspaceArtifactChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceArtifact')
    const result = await workspaceArtifactChatContextAdapter.resolve({
      kind: 'workspace_artifact',
      id: 'artifact-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      label: 'Launch brief',
      href: 'https://docs.google.com/document/d/google-file-1/edit',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'lifecycle', label: 'Lifecycle', value: 'Approved' },
      { id: 'visibility', label: 'Visibility', value: 'Admin Agents' },
      { id: 'acl', label: 'Provider ACL', value: 'Unknown' },
      { id: 'sync', label: 'Sync', value: 'Synced' },
    ]))
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'artifact-acl-unknown',
      actions: [expect.objectContaining({
        id: 'audit-workspace-artifact:artifact-1',
        href: '/api/v1/workspace-broker/artifacts/artifact-1/permission-audit',
      })],
    }))
    expect(result.model.relationships).toEqual([
      expect.objectContaining({ kind: 'project', id: 'project-1', relation: 'Project' }),
    ])
  })

  it('blocks attention when provider permissions are broader than PiB visibility', async () => {
    mockArtifactGet.mockResolvedValue({
      exists: true,
      id: 'artifact-1',
      data: () => artifact({
        permissions: {
          externalShared: true,
          anyoneWithLink: true,
          domainShared: false,
          aclAlignmentStatus: 'broader_than_pib',
          lastCheckedAt: '2026-07-31T08:30:00.000Z',
          allowedAgentIds: [],
        },
      }),
    })
    const { workspaceArtifactChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceArtifact')
    const result = await workspaceArtifactChatContextAdapter.resolve({
      kind: 'workspace_artifact',
      id: 'artifact-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'artifact-acl-too-broad',
      state: 'blocked',
    }))
    expect(result.model.groups[0].items[0].state).toBe('blocked')
  })

  it('fails closed when the canonical artifact visibility contract denies the actor', async () => {
    mockArtifactGet.mockResolvedValue({
      exists: true,
      id: 'artifact-1',
      data: () => artifact({ visibility: 'admin_only' }),
    })
    const { workspaceArtifactChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceArtifact')
    await expect(workspaceArtifactChatContextAdapter.resolve({
      kind: 'workspace_artifact',
      id: 'artifact-1',
      user: { uid: 'agent:docs', role: 'ai', authKind: 'agent_api_key', agentId: 'docs', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
