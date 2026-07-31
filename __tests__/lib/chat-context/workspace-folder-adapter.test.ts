const mockGet = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async (input: { kind: string; id: string }) => ({
      ok: true,
      model: {
        context: {
          kind: input.kind,
          id: input.id,
          orgId: 'org-1',
          label: `Base ${input.id}`,
          icon: 'folder',
        },
        pulse: { label: 'base', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: [],
        asOf: '2026-07-31T07:00:00.000Z',
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
      doc: () => ({ get: mockGet }),
    }),
  },
}))

function folder(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    name: 'Campaign assets',
    description: 'Source assets for campaigns',
    resourceType: 'project',
    resourceId: 'project-1',
    projectId: 'project-1',
    taskId: 'task-1',
    clientDocumentId: 'doc-1',
    connectionId: 'conn-1',
    provider: 'google_drive',
    owner: { type: 'user', id: 'admin-1' },
    capabilityScopes: ['read', 'write'],
    safeMetadata: {},
    parentId: null,
    visibility: 'admin_agents',
    tags: ['campaign'],
    sortOrder: 5,
    drive: { folderId: 'drive-folder-1', folderUrl: 'https://drive.google.com/drive/folders/drive-folder-1' },
    paths: { vpsPath: '/mnt/shared/campaigns', localPathHint: '/tmp/campaigns' },
    sourceOfTruth: 'google_drive',
    syncMode: 'full',
    syncTargets: ['vps', 'local'],
    permissions: { inheritParent: false, allowedAgentIds: ['docs'], allowedRoleIds: ['admin'], allowedUserIds: ['admin-1'] },
    syncState: {
      status: 'synced',
      lastSyncedAt: '2026-07-31T07:15:00.000Z',
      lastAttemptAt: '2026-07-31T07:10:00.000Z',
      error: null,
      conflictCount: 0,
      lastRequestId: null,
      lastRequestStatus: 'completed',
    },
    audit: {
      approvalStatus: 'approved',
      auditStatus: 'checked',
      riskLevel: 'low',
      approvalGateTaskId: null,
      lastReviewedAt: '2026-07-31T07:20:00.000Z',
      lastReviewedBy: 'admin-1',
      conflictStatus: 'none',
      lastConflictAt: null,
      notes: null,
    },
    deleted: false,
    ...overrides,
  }
}

describe('workspace folder chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      exists: true,
      id: 'folder-1',
      data: () => folder(),
    })
    mockResolveContextReferences.mockImplementation(async (seeds: Array<{ type: string; id: string }>) => {
      return seeds.map((seed) => {
        if (seed.type === 'project') {
          return { type: 'project', id: seed.id, orgId: 'org-1', label: 'Launch project', href: '/portal/projects/project-1' }
        }
        if (seed.type === 'task') {
          return { type: 'task', id: seed.id, orgId: 'org-1', label: 'Campaign task' }
        }
        if (seed.type === 'document') {
          return { type: 'document', id: seed.id, orgId: 'org-1', label: 'Project brief' }
        }
        if (seed.type === 'workspace_connection') {
          return { type: 'workspace_connection', id: seed.id, orgId: 'org-1', label: 'Drive connection' }
        }
        return null
      }).filter(Boolean)
    })
  })

  it('resolves live folder context with metrics and relationships for admin users', async () => {
    const { workspaceFolderChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceFolder')
    const result = await workspaceFolderChatContextAdapter.resolve({
      kind: 'workspace_folder',
      id: 'folder-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toMatchObject({
      label: 'Campaign assets',
      href: '/admin/workspace/folders/folder-1',
    })
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Sync status', value: 'Synced' },
      { id: 'source', label: 'Source', value: 'Google Drive' },
      { id: 'visibility', label: 'Visibility', value: 'Admin Agents' },
      { id: 'risk', label: 'Risk', value: 'Low' },
    ]))
    expect(result.model.groups[0]).toMatchObject({
      items: [expect.objectContaining({ id: 'folder-1', state: 'ready' })],
    })
    expect(result.model.capabilities).toEqual(expect.arrayContaining(['sync', 'resync', 'permissions']))
    expect((result as { model: { relationships?: unknown[] } }).model.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'project', id: 'project-1', relation: 'Project' }),
        expect.objectContaining({ kind: 'task', id: 'task-1', relation: 'Task' }),
      ]),
    )
  })

  it('blocks unauthorized actor with not found result', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'folder-1',
      data: () => folder({ visibility: 'admin_only' }),
    })
    const { workspaceFolderChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceFolder')
    await expect(workspaceFolderChatContextAdapter.resolve({
      kind: 'workspace_folder',
      id: 'folder-1',
      user: { uid: 'agent:writer', role: 'ai', authKind: 'agent_api_key', orgId: 'org-1', agentId: 'writer' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('returns a usable fallback for workbench-linked directories', async () => {
    const { workspaceFolderChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceFolder')
    const result = await workspaceFolderChatContextAdapter.resolve({
      kind: 'workspace_folder',
      id: 'workbench-directory:abcd1234',
      contextReference: {
        type: 'workspace_folder',
        id: 'workbench-directory:abcd1234',
        orgId: 'org-1',
        label: 'project-dir',
        origin: 'mention',
        metadata: { path: 'Projects/Campaign X' },
      },
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })
    expect(result).toMatchObject({
      ok: true,
      model: {
        context: {
          label: 'Projects/Campaign X',
        },
        pulse: {
          label: 'Linked folder',
          metrics: expect.arrayContaining([
            { id: 'source', label: 'Source', value: 'Linked workbench path' },
            { id: 'path', label: 'Folder path', value: 'Projects/Campaign X' },
          ]),
        },
        groups: [{ id: 'linked-folder' }],
      },
    })
    expect(mockGet).not.toHaveBeenCalled()
  })
})
