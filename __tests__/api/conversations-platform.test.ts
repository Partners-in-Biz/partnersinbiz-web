import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockCreateConversation = jest.fn()
const mockListConversations = jest.fn()
const mockOrgChatConfigGet = jest.fn()
const mockResolveVisibleAgents = jest.fn()
const mockAuthorizeWorkspaceRuntime = jest.fn()
const mockRequireProjectRuntimeReplica = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockGetOrgChatVisibilityPolicy = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }
let organizationMembers: Array<{ userId: string; role: string }> = []
let orgMemberRows: Array<{ id: string; data: Record<string, unknown> }> = []
let organizationSettings: Record<string, unknown> = {}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/idempotency', () => ({
  withIdempotency: (handler: MockHandler) => handler,
}))

jest.mock('@/lib/conversations/conversations', () => ({
  createConversation: mockCreateConversation,
  listConversations: mockListConversations,
  orgChatConfigDoc: jest.fn(() => ({ get: mockOrgChatConfigGet })),
  resolveVisibleAgents: mockResolveVisibleAgents,
}))
jest.mock('@/lib/conversations/chat-config', () => ({
  getOrgChatVisibilityPolicy: (...args: unknown[]) => mockGetOrgChatVisibilityPolicy(...args),
}))

jest.mock('@/lib/workspaces/runtime-authorization', () => ({
  authorizeWorkspaceRuntime: mockAuthorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing: (runtime: { organizationAccessible?: boolean; accessMode?: string }) => (
    runtime.organizationAccessible === true || runtime.accessMode === 'organization'
  ),
}))
jest.mock('@/lib/project-locations/runtime-binding', () => ({
  requireProjectRuntimeReplica: mockRequireProjectRuntimeReplica,
  projectRuntimeReplicaApiError: (error: unknown) => {
    if (error instanceof Error) {
      if (error.message === 'Computer unavailable'
        || error.message === 'Project files are not ready on this computer'
        || error.message === 'Project is not linked to this computer') {
        return { message: error.message, status: 409 as const }
      }
    }
    return { message: 'Project is not linked to this computer', status: 409 as const }
  },
}))
jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: mockGetProjectForUser,
}))
jest.mock('@/lib/client-provisioning/ensure-company-cowork', () => ({
  ensureCompanyCoworkFolderOnVps: async (workspace: Record<string, unknown>) => ({
    ok: true,
    workspace,
    createdOrVerified: true,
  }),
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
  organizationMembers = [
    { userId: 'client-1', role: 'member' },
    { userId: 'admin-2', role: 'member' },
  ]
  orgMemberRows = []
  organizationSettings = {}
  mockOrgChatConfigGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockResolveVisibleAgents.mockReturnValue(['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo'])
  mockCreateConversation.mockImplementation(async (input) => ({ id: 'conv-1', ...input }))
  mockListConversations.mockResolvedValue([{ id: 'conv-1', orgId: 'pib-platform-owner' }])
  mockAuthorizeWorkspaceRuntime.mockImplementation(async ({ runtimeTargetId }: { runtimeTargetId: string }) => {
    if (runtimeTargetId === 'local') return { kind: 'execution-location', locationId: 'peets-mac-mini', runtimeTargetId, machineLabel: "Local: Peet's Mac", locationKind: 'computer', organizationAccessible: false }
    if (runtimeTargetId === 'vps') return { kind: 'execution-location', locationId: 'partners-vps', runtimeTargetId, machineLabel: 'VPS', locationKind: 'vps', organizationAccessible: true }
    throw new Error('Execution location not authorized')
  })
  mockRequireProjectRuntimeReplica.mockResolvedValue({ replicaId: 'replica-project-runtime' })
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      exists: true,
      data: () => ({ orgId: 'org-1', name: 'Website launch' }),
    },
    projectAccess: { role: 'manager', source: 'legacy_org', canViewInternal: true },
  })
  mockGetOrgChatVisibilityPolicy.mockResolvedValue({
    enableClientToAdminChat: true,
    enableClientToPiBTeamChat: false,
  })

  const usersById: Record<string, Record<string, unknown>> = {
    'admin-1': { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [], email: 'peet@example.com', displayName: 'Peet' },
    'admin-2': { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [], email: 'ops@example.com', displayName: 'Ops' },
    'restricted-admin': { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['org-1'], email: 'restricted@example.com', displayName: 'Restricted' },
    'client-1': { role: 'client', email: 'client@example.com', displayName: 'Client' },
  }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({ exists: !!usersById[uid], data: () => usersById[uid] ?? {} }),
        }),
        where: () => ({
          get: async () => ({
            docs: Object.entries(usersById)
              .filter(([, data]) => data.role === 'admin')
              .map(([id, data]) => ({ id, data: () => data })),
          }),
        }),
      }
    }
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: ['pip', 'sales', 'docs', 'theo', 'maya'].includes(agentId),
            data: () => ({
              agentId,
              enabled: true,
              name:
                agentId === 'pip'
                  ? 'Pip'
                  : agentId === 'sales'
                  ? 'Sales'
                  : agentId === 'docs'
                  ? 'Docs'
                  : agentId === 'theo'
                  ? 'Theo'
                  : agentId === 'maya'
                  ? 'Maya'
                  : agentId,
            }),
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => ({
            exists: orgId === 'pib-platform-owner' || orgId === 'org-1',
            data: () => ({
              members: organizationMembers,
              settings: organizationSettings,
            }),
          }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: (id: string) => ({
          get: async () => {
            const row = orgMemberRows.find((entry) => entry.id === id)
            return { exists: Boolean(row), data: () => row?.data ?? {} }
          },
        }),
        where: (field: string, _op: string, value: string) => ({
          get: async () => ({
            docs: orgMemberRows
              .filter((row) => row.data[field] === value)
              .map((row) => ({ id: row.id, data: () => row.data })),
          }),
        }),
      }
    }
    if (name === 'org_workspaces') {
      const workspaceData = {
        workspaceId: 'acme',
        orgId: 'org-1',
        orgSlug: 'acme',
        orgName: 'Acme',
        agentDomain: 'acme',
        agentName: 'Ava',
        vpsPath: '/var/lib/hermes/Cowork/partners/Acme',
        localPath: '~/Cowork/partners/Acme',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/acme',
        localAgentDomainPath: '~/Cowork/Cowork/agents/acme',
        sourceOfTruth: 'vps',
        syncMode: 'hybrid',
        defaultRuntimeTarget: 'vps',
        status: 'active',
        folderVersion: 1,
        companyId: 'company-1',
        contactIds: ['contact-1'],
      }
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: id === 'acme',
            id,
            data: () => workspaceData,
          }),
        }),
        where: () => ({
          where: () => ({
            get: async () => ({ docs: [{ id: 'acme', data: () => workspaceData }] }),
            limit: () => ({ get: async () => ({ docs: [{ id: 'acme', data: () => workspaceData }] }) }),
          }),
        }),
      }
    }
    if (name === 'companies') {
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: id === 'company-1',
            id,
            data: () => ({ id, orgId: 'org-1', name: 'Acme', deleted: false }),
          }),
        }),
      }
    }
    if (name === 'agent_dispatch_configs') {
      return {
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({
              runtimeTargets: {
                vps: {
                  id: 'vps',
                  label: 'VPS',
                  baseUrl: 'https://hermes.example/profiles/pip',
                  apiKey: 'test-key',
                  enabled: true,
                },
                local: {
                  id: 'local',
                  label: "Local: Peet's Mac",
                  hostId: 'peets-mac-mini',
                  baseUrl: 'https://local-hermes.example/profiles/pip',
                  apiKey: 'local-test-key',
                  enabled: true,
                  capabilities: ['local-files'],
                  lastSeenAt: new Date().toISOString(),
                },
              },
            }),
          }),
        }),
      }
    }
    if (name === 'projects') {
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: id === 'project-1',
            id,
            data: () => ({ orgId: 'org-1', name: 'Website launch' }),
          }),
        }),
        where: () => ({
          get: async () => ({ docs: [] }),
        }),
      }
    }
    if (name === 'project_location_replicas') {
      return { where: () => ({ get: async () => ({ docs: [] }) }) }
    }
    if (name === 'projectOrganizations') {
      return {
        doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
        where: () => ({ get: async () => ({ docs: [] }) }),
      }
    }
    if (name === 'projectMembers') {
      return { where: () => ({ get: async () => ({ docs: [] }) }) }
    }
    if (name === 'project_user_library') {
      return { where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('platform-scoped unified conversations', () => {
  it('returns browser-safe Workspace summaries without physical filesystem paths', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }
    const { GET } = await import('@/app/api/v1/workspaces/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=org-1'))

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.workspaces[0]).toEqual(expect.objectContaining({
      workspaceId: 'acme',
      sourceOfTruth: 'vps',
      syncMode: 'hybrid',
      folderVersion: 1,
    }))
    expect(body.data.workspaces[0]).not.toHaveProperty('vpsPath')
    expect(body.data.workspaces[0]).not.toHaveProperty('localPath')
    expect(body.data.workspaces[0]).not.toHaveProperty('agentDomainPath')
    expect(body.data.workspaces[0]).not.toHaveProperty('localAgentDomainPath')
    expect(JSON.stringify(body.data.workspaces)).not.toContain('/var/lib/hermes')
    expect(JSON.stringify(body.data.workspaces)).not.toContain('~/Cowork')
  })

  it('lets a super admin create a top-level platform conversation without a client org document', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        participants: [{ kind: 'agent', agentId: 'pip' }, { kind: 'user', uid: 'admin-2' }],
        title: 'Internal planning',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      startedBy: 'admin-1',
      title: 'Internal planning',
    }))
    expect(mockCreateConversation.mock.calls[0][0]).not.toHaveProperty('workspaceContext')
    const body = await readJson(res)
    expect(body.data.conversation.id).toBe('conv-1')
  })

  it('creates a Bot-to-Bot inbox without promoting Pip as orchestrator', async () => {
    mockResolveVisibleAgents.mockReturnValue(['pip', 'theo', 'maya'])
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        channelKind: 'bot_inbox',
        botInbox: { fromAgentId: 'theo', toAgentId: 'maya', status: 'open' },
        participants: [
          { kind: 'agent', agentId: 'maya' },
          { kind: 'agent', agentId: 'theo' },
        ],
        title: 'Inbox · Theo → Maya',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      channelKind: 'bot_inbox',
      botInbox: expect.objectContaining({ fromAgentId: 'theo', toAgentId: 'maya' }),
      title: 'Inbox · Theo → Maya',
    }))
    const created = mockCreateConversation.mock.calls[0][0]
    expect(created.orchestration).toBeUndefined()
    expect(created.participants.filter((participant: { kind: string }) => participant.kind === 'agent').map((participant: { agentId: string }) => participant.agentId)).toEqual(['maya', 'theo'])
  })

  it('allows a sales-role client to start a role-specific non-linked specialist conversation without runtime grant', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    mockResolveVisibleAgents.mockReturnValue(['pip', 'sales'])
    orgMemberRows = [
      {
        id: 'org-1_client-1',
        data: {
          orgId: 'org-1',
          uid: 'client-1',
          role: 'member',
          department: 'Sales',
          jobTitle: 'Account Executive',
        },
      },
    ]

    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'agent', agentId: 'sales' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      startedBy: 'client-1',
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'client-1' }),
        expect.objectContaining({ kind: 'agent', agentId: 'sales' }),
      ]),
    }))
  })

  it('blocks a client from starting a non-visible specialist conversation', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    mockResolveVisibleAgents.mockReturnValue(['pip'])

    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'agent', agentId: 'sales' }],
      }),
    }))

    expect(res.status).toBe(403)
    const body = await readJson(res)
    expect(body.error).toBe('This member is not allowed to use that agent on the selected computer')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('lists top-level platform conversations for the current admin', async () => {
    const { GET } = await import('@/app/api/v1/conversations/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/conversations?orgId=pib-platform-owner'))

    expect(res.status).toBe(200)
    expect(mockListConversations).toHaveBeenCalledWith('pib-platform-owner', expect.objectContaining({ uid: 'admin-1' }), 30, expect.any(Object))
  })

  it('lets a client start a platform-workspace conversation with listed org members', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'pib-platform-owner' }
    mockGetOrgChatVisibilityPolicy.mockResolvedValueOnce({
      enableClientToAdminChat: true,
      enableClientToPiBTeamChat: true,
    })
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        participants: [{ kind: 'user', uid: 'admin-2' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      startedBy: 'client-1',
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'client-1' }),
        expect.objectContaining({ kind: 'user', uid: 'admin-2' }),
      ]),
    }))
  })

  it('rejects a project session on a Workspace computer that is not linked to that project', async () => {
    mockRequireProjectRuntimeReplica.mockRejectedValueOnce(new Error('Project is not linked to this computer'))
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1', scope: 'project', scopeRefId: 'project-1', workspaceId: 'acme',
        runtimeTarget: 'vps', participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))

    expect(res.status).toBe(409)
    expect((await readJson(res)).error).toBe('Project is not linked to this computer')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('blocks client conversation starts when the messages start policy denies their org role', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }
    organizationSettings = {
      modulePolicies: {
        messages: {
          actions: {
            start: { owner: true, admin: true, member: false },
          },
        },
      },
    }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'user', uid: 'admin-1' }],
      }),
    }))

    expect(res.status).toBe(403)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('blocks client chats with PiB team members while that policy is disabled', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'user', uid: 'admin-1' }],
      }),
    }))

    expect(res.status).toBe(403)
    expect((await readJson(res)).error).toBe('Client cannot create chats with PiB team in this organisation')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('allows client chats with PiB admins when enableClientToPiBTeamChat is enabled', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    mockGetOrgChatVisibilityPolicy.mockResolvedValueOnce({
      enableClientToAdminChat: true,
      enableClientToPiBTeamChat: true,
    })
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'user', uid: 'admin-1' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      startedBy: 'client-1',
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'client-1' }),
        expect.objectContaining({ kind: 'user', uid: 'admin-1', role: 'admin' }),
      ]),
    }))
  })

  it('lets a super admin start an agent conversation inside a client portal org without client membership', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        participants: [{ kind: 'agent', agentId: 'pip' }],
        title: 'Client portal agent handoff',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      startedBy: 'admin-1',
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'admin-1' }),
        expect.objectContaining({ kind: 'agent', agentId: 'pip' }),
      ]),
    }))
  })

  it('binds a new conversation to a selected client workspace and runtime target', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'workspace',
        workspaceId: 'acme',
        runtimeTarget: 'local',
        participants: [{ kind: 'agent', agentId: 'pip' }],
        title: 'Acme workspace chat',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith({
      userId: 'admin-1', orgId: 'org-1', workspaceId: 'acme', runtimeTargetId: 'local', agentId: 'pip',
    })
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      scope: 'workspace',
      scopeRefId: 'acme',
      workspaceContext: expect.objectContaining({
        workspaceId: 'acme',
        runtimeLabel: "Local: Peet's Mac",
        ownerUserId: 'admin-1',
        shareMode: 'private',
        companyId: 'company-1',
        contactIds: ['contact-1'],
      }),
    }))
  })

  it('binds a project conversation to its concrete Workspace project folder', async () => {
    mockRequireProjectRuntimeReplica.mockResolvedValueOnce({
      replicaId: 'replica-project-runtime',
      relativePath: 'clients/acme/website-launch',
    })
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'project',
        scopeRefId: 'project-1',
        workspaceId: 'acme',
        runtimeTarget: 'vps',
        participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockRequireProjectRuntimeReplica).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'acme', actorUserId: 'admin-1',
      runtime: expect.objectContaining({ kind: 'execution-location', locationId: 'partners-vps' }),
    }))
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project',
      scopeRefId: 'project-1',
      workspaceContext: expect.objectContaining({
        folderScope: 'project',
        folderRelativePath: 'clients/acme/website-launch',
        projectId: 'project-1',
        projectName: 'Website launch',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Acme/clients/acme/website-launch',
        localWorkingPath: '~/Cowork/partners/Acme/clients/acme/website-launch',
      }),
    }))
  })

  it('binds a company conversation to the CRM company Cowork root without switching organisations', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'company',
        scopeRefId: 'company-1',
        workspaceId: 'acme',
        runtimeTarget: 'vps',
        participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1', orgId: 'org-1', workspaceId: 'acme', runtimeTargetId: 'vps',
    }))
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', scope: 'company', scopeRefId: 'company-1',
      workspaceContext: expect.objectContaining({
        orgId: 'org-1', workspaceId: 'acme', companyId: 'company-1', companyName: 'Acme',
        companyWorkspaceId: 'acme', folderScope: 'company',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Acme',
      }),
    }))
  })

  it('rejects a project session when the caller lacks project-level access', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1', scope: 'project', scopeRefId: 'project-1', workspaceId: 'acme',
        runtimeTarget: 'vps', participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))

    expect(res.status).toBe(403)
    expect(mockAuthorizeWorkspaceRuntime).not.toHaveBeenCalled()
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects workspace-scoped conversations without an explicit workspace id', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'workspace',
        participants: [{ kind: 'agent', agentId: 'pip' }],
        title: 'Missing workspace id',
      }),
    }))

    expect(res.status).toBe(400)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects an unknown Workspace runtime instead of silently falling back', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'workspace',
        workspaceId: 'acme',
        runtimeTarget: 'unknown-runtime',
        participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))
    expect(res.status).toBe(400)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects an organisation-shared session on a private computer', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1', scope: 'workspace', workspaceId: 'acme', runtimeTarget: 'local',
        shareMode: 'org', participants: [{ kind: 'agent', agentId: 'pip' }],
      }),
    }))

    expect(res.status).toBe(400)
    expect((await readJson(res)).error).toBe('Organisation-shared sessions require an organisation-available computer')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects a participant-shared session on a private computer', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1', scope: 'workspace', workspaceId: 'acme', runtimeTarget: 'local',
        shareMode: 'shared',
        participants: [
          { kind: 'agent', agentId: 'pip' },
          { kind: 'user', uid: 'admin-2' },
        ],
      }),
    }))

    expect(res.status).toBe(400)
    expect((await readJson(res)).error).toBe('Shared sessions require an organisation-available computer')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('keeps private Workspace conversations separated from other human participants', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        scope: 'workspace',
        workspaceId: 'acme',
        runtimeTarget: 'vps',
        shareMode: 'private',
        participants: [
          { kind: 'agent', agentId: 'pip' },
          { kind: 'user', uid: 'admin-2' },
        ],
      }),
    }))
    expect(res.status).toBe(400)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('returns platform admins as people for the top-level participant picker', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/contacts/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/orgs/pib-platform-owner/contacts'), {
      params: Promise.resolve({ orgId: 'pib-platform-owner' }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual([
      expect.objectContaining({ uid: 'admin-2', role: 'admin', email: 'ops@example.com' }),
    ])
  })

  it('hides PiB team users from people picker when admin-chat-with-PiB is disabled', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/contacts/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/orgs/org-1/contacts'), {
      params: Promise.resolve({ orgId: 'org-1' }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'admin-2', role: 'client', email: 'ops@example.com' }),
    ]))
    expect(body.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'admin-1' }),
      expect.objectContaining({ uid: 'restricted-admin' }),
    ]))
  })

  it('returns linked orgMember profiles when embedded organisation members are missing', async () => {
    organizationMembers = []
    orgMemberRows = [
      {
        id: 'org-1_client-1',
        data: {
          orgId: 'org-1',
          uid: 'client-1',
          role: 'admin',
          firstName: 'Client',
          lastName: 'Owner',
        },
      },
    ]

    const { GET } = await import('@/app/api/v1/orgs/[orgId]/contacts/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/orgs/org-1/contacts'), {
      params: Promise.resolve({ orgId: 'org-1' }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual([
      expect.objectContaining({
        uid: 'client-1',
        role: 'admin',
        displayName: 'Client Owner',
        email: 'client@example.com',
      }),
    ])
  })
})
