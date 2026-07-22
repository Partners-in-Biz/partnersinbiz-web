import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockCreateConversation = jest.fn()
const mockResolveWorkspaceContext = jest.fn()
const mockAuthorizeLinkedComputer = jest.fn()
const mockAuthorizeWorkspaceRuntime = jest.fn()
const mockRequireProjectRuntimeReplica = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockAuthorizeConversationProject = jest.fn()
const mockCanReply = jest.fn(() => true)
const mockModuleAccess = jest.fn(async () => ({ ok: true }))
const mockDispatchGet = jest.fn()

let mockUser = { uid: 'member-2', role: 'client' as const, orgId: 'org-1' }
type Handler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Handler) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name !== 'agent_dispatch_configs') throw new Error(`Unexpected collection ${name}`)
      return { doc: jest.fn(() => ({ get: mockDispatchGet })) }
    }),
  },
}))
jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  createConversation: mockCreateConversation,
}))
jest.mock('@/lib/conversations/access', () => ({
  authorizeConversationProject: mockAuthorizeConversationProject,
  canReplyConversation: mockCanReply,
  publicConversationView: (value: unknown) => value,
}))
jest.mock('@/lib/client-provisioning/workspace-context', () => ({
  resolveConversationWorkspaceContext: mockResolveWorkspaceContext,
}))
jest.mock('@/lib/linked-computers/runtime-targets', () => ({
  authorizeLinkedComputerDispatch: mockAuthorizeLinkedComputer,
}))
jest.mock('@/lib/workspaces/runtime-authorization', () => ({
  authorizeWorkspaceRuntime: mockAuthorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing: (runtime: { organizationAccessible?: boolean; accessMode?: string }) => (
    runtime.organizationAccessible === true || runtime.accessMode === 'organization'
  ),
}))
jest.mock('@/lib/project-locations/runtime-binding', () => ({
  requireProjectRuntimeReplica: mockRequireProjectRuntimeReplica,
}))
jest.mock('@/lib/projects/access', () => ({ getProjectForUser: mockGetProjectForUser }))
jest.mock('@/lib/agents/runtime-targets', () => ({
  publicRuntimeTargetPresence: jest.fn(() => []),
}))
jest.mock('@/lib/organizations/module-policy-access', () => ({
  assertUserCanPerformOrganizationModuleAction: mockModuleAccess,
}))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(async () => undefined) }))

const source = {
  id: 'conv-source',
  orgId: 'org-1',
  title: 'Website launch',
  scope: 'project' as const,
  scopeRefId: 'project-1',
  startedBy: 'owner-1',
  participants: [
    { kind: 'user' as const, uid: 'owner-1', role: 'client' as const },
    { kind: 'agent' as const, agentId: 'pip' as const, name: 'Pip' },
  ],
  participantUids: ['owner-1'],
  participantAgentIds: ['pip' as const],
  messageCount: 2,
  archived: false,
  workspaceContext: {
    workspaceId: 'workspace-1', orgId: 'org-1', orgName: 'Acme', orgSlug: 'acme', agentDomain: 'acme',
    sourceOfTruth: 'vps' as const, runtimeTarget: 'vps-old', runtimeLabel: 'Old computer',
    ownerUserId: 'owner-1', shareMode: 'org' as const, projectId: 'project-1', projectName: 'Website launch',
    companyId: null, contactIds: [],
  },
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-source/continue', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ convId: 'conv-source' }) }

describe('POST conversation runtime continuation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { uid: 'member-2', role: 'client', orgId: 'org-1' }
    mockGetConversation.mockResolvedValue(source)
    mockAuthorizeLinkedComputer.mockResolvedValue({ machineLabel: 'Studio Mac' })
    mockAuthorizeWorkspaceRuntime.mockResolvedValue({
      kind: 'linked-computer', deviceId: 'studio', locationId: 'linked-device:studio',
      runtimeTargetId: 'linked-device:studio', machineLabel: 'Studio Mac',
      accessMode: 'organization',
    })
    mockRequireProjectRuntimeReplica.mockResolvedValue({
      replicaId: 'replica-studio',
      relativePath: 'clients/acme/studio-launch',
    })
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { data: () => ({ orgId: 'org-1' }) },
      projectAccess: { role: 'contributor' },
    })
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: 'project-1' })
    mockResolveWorkspaceContext.mockResolvedValue({
      ...source.workspaceContext,
      runtimeTarget: 'linked-device:studio',
      runtimeLabel: 'Studio Mac',
      ownerUserId: 'member-2',
    })
    mockCreateConversation.mockResolvedValue({ id: 'conv-next', title: source.title })
    mockDispatchGet.mockResolvedValue({ data: () => ({ runtimeTargets: {} }) })
  })

  it('creates a successor session with immutable organisation/project context and a new computer binding', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)
    expect(response.status).toBe(201)
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'member-2', orgId: 'org-1', workspaceId: 'workspace-1', runtimeTargetId: 'linked-device:studio',
      agentId: 'pip',
    }))
    expect(mockResolveWorkspaceContext).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', workspaceId: 'workspace-1', projectId: 'project-1', runtimeTarget: 'linked-device:studio',
      ownerUserId: 'member-2', shareMode: 'org', folderRelativePath: 'clients/acme/studio-launch',
      companyId: null,
    }))
    expect(mockRequireProjectRuntimeReplica).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'member-2',
      runtime: expect.objectContaining({ locationId: 'linked-device:studio' }),
    }))
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', startedBy: 'member-2', scope: 'project', scopeRefId: 'project-1',
      lineage: { kind: 'runtime_continuation', parentConversationId: 'conv-source', rootConversationId: 'conv-source' },
    }))
  })

  it('preserves company Cowork identity when continuing on another computer', async () => {
    mockGetConversation.mockResolvedValueOnce({
      ...source,
      scope: 'company',
      scopeRefId: 'company-hunt',
      workspaceContext: {
        ...source.workspaceContext,
        projectId: undefined,
        projectName: undefined,
        folderScope: 'company',
        companyId: 'company-hunt',
        companyName: 'Hunt and Gun',
        companyWorkspaceId: 'hunt-and-gun',
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)
    expect(response.status).toBe(201)
    expect(mockResolveWorkspaceContext).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
    }))
    expect(mockResolveWorkspaceContext.mock.calls[0][0].projectId).toBeUndefined()
  })

  it('preserves legacy project confinement when the old Workspace context lacks projectId', async () => {
    mockGetConversation.mockResolvedValueOnce({
      ...source,
      scope: 'project',
      scopeRefId: 'project-1',
      workspaceContext: { ...source.workspaceContext, projectId: undefined, folderScope: 'organisation' },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)

    expect(response.status).toBe(201)
    expect(mockResolveWorkspaceContext).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      folderRelativePath: 'clients/acme/studio-launch',
    }))
  })

  it('denies non-repliers and never mutates the source session runtime', async () => {
    mockCanReply.mockReturnValueOnce(false)
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)
    expect(response.status).toBe(403)
    expect(mockCreateConversation).not.toHaveBeenCalled()
    expect(source.workspaceContext.runtimeTarget).toBe('vps-old')
  })

  it('rejects missing Workspace context and unavailable linked computers', async () => {
    mockGetConversation.mockResolvedValueOnce({ ...source, workspaceContext: undefined })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    expect((await POST(request({ runtimeTarget: 'linked-device:studio' }), context)).status).toBe(400)

    mockAuthorizeWorkspaceRuntime.mockRejectedValueOnce(new Error('Computer unavailable'))
    expect((await POST(request({ runtimeTarget: 'linked-device:studio' }), context)).status).toBe(409)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects continuation when the destination computer is not linked to the project', async () => {
    mockRequireProjectRuntimeReplica.mockRejectedValueOnce(new Error('Project is not linked to this computer'))
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Project is not linked to this computer')
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects continuation after project access is revoked', async () => {
    mockAuthorizeConversationProject.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:studio' }), context)

    expect(response.status).toBe(403)
    expect(mockAuthorizeWorkspaceRuntime).not.toHaveBeenCalled()
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects an organisation-shared continuation onto a private computer', async () => {
    mockAuthorizeWorkspaceRuntime.mockResolvedValueOnce({
      kind: 'linked-computer', deviceId: 'private-studio', locationId: 'linked-device:private-studio',
      runtimeTargetId: 'linked-device:private-studio', machineLabel: 'Private Studio Mac', accessMode: 'owner',
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:private-studio' }), context)

    expect(response.status).toBe(400)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })

  it('rejects a participant-shared continuation onto a private computer', async () => {
    mockGetConversation.mockResolvedValueOnce({
      ...source,
      workspaceContext: { ...source.workspaceContext, shareMode: 'shared' },
    })
    mockAuthorizeWorkspaceRuntime.mockResolvedValueOnce({
      kind: 'linked-computer', deviceId: 'private-studio', locationId: 'linked-device:private-studio',
      runtimeTargetId: 'linked-device:private-studio', machineLabel: 'Private Studio Mac', accessMode: 'owner',
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/continue/route')
    const response = await POST(request({ runtimeTarget: 'linked-device:private-studio' }), context)

    expect(response.status).toBe(400)
    expect(mockCreateConversation).not.toHaveBeenCalled()
  })
})
