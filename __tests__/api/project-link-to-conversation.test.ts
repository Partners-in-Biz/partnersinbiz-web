import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockCanAccessConversation = jest.fn(() => true)
const mockCanAccessOrg = jest.fn(() => true)
const mockGetProjectForUser = jest.fn()
const mockProjectLinkedToOrganization = jest.fn(async () => true)
const mockCanProjectRole = jest.fn(() => true)
const mockGetLinkStatus = jest.fn()
const mockAutoLink = jest.fn()

let mockUser = { uid: 'user-1', role: 'client' as const, orgId: 'org-1' }
type MockHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))
jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
}))
jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: (...args: unknown[]) => mockCanAccessConversation(...args),
}))
jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))
jest.mock('@/lib/projects/organization-link', () => ({
  projectLinkedToOrganization: (...args: unknown[]) => mockProjectLinkedToOrganization(...args),
}))
jest.mock('@/lib/projects/collaboration', () => ({
  canProjectRole: (...args: unknown[]) => mockCanProjectRole(...args),
}))
jest.mock('@/lib/project-locations/auto-link-conversation-computer', () => ({
  getProjectConversationComputerLinkStatus: (...args: unknown[]) => mockGetLinkStatus(...args),
  autoLinkProjectToConversationComputer: (...args: unknown[]) => mockAutoLink(...args),
}))
jest.mock('@/lib/project-locations/public', () => ({
  publicProjectLocationReplica: (replica: unknown) => replica,
}))

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/link-to-conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/projects/:projectId/link-to-conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { uid: 'user-1', role: 'client', orgId: 'org-1' }
    mockCanAccessConversation.mockReturnValue(true)
    mockCanAccessOrg.mockReturnValue(true)
    mockCanProjectRole.mockReturnValue(true)
    mockProjectLinkedToOrganization.mockResolvedValue(true)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      workspaceContext: {
        workspaceId: 'ws-1',
        runtimeTarget: 'linked-device:mac-mini',
        runtimeLabel: 'Peets-Mac-mini',
      },
    })
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      projectAccess: { role: 'owner' },
      doc: { data: () => ({ orgId: 'org-1', name: 'Launch', projectFolderRelativePath: 'projects/project-1' }) },
    })
  })

  it('returns alreadyLinked when the project is already on the chat computer', async () => {
    mockGetLinkStatus.mockResolvedValue({
      status: 'linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/link-to-conversation/route')
    const response = await POST(request({ conversationId: 'conv-1' }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      linked: true,
      alreadyLinked: true,
      locationId: 'linked-device:mac-mini',
    })
    expect(mockAutoLink).not.toHaveBeenCalled()
  })

  it('creates the location replica and returns agent AGENTS.md guidance', async () => {
    mockGetLinkStatus.mockResolvedValue({
      status: 'not_linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
      reason: 'no_replica',
    })
    mockAutoLink.mockResolvedValue({
      linked: true,
      locationId: 'linked-device:mac-mini',
      replica: {
        replicaId: 'replica-1',
        projectId: 'project-1',
        orgId: 'org-1',
        locationId: 'linked-device:mac-mini',
        workspaceId: 'ws-1',
        mappingId: 'map-1',
        relativePath: 'projects/project-1',
        active: true,
        locationLabel: 'Peets-Mac-mini',
        locationKind: 'computer',
        locationPlatform: 'macos',
        locationVisibility: 'private',
        availability: 'online',
        syncStatus: 'ready',
        isCanonical: true,
      },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/link-to-conversation/route')
    const response = await POST(request({ conversationId: 'conv-1' }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.data).toMatchObject({
      linked: true,
      alreadyLinked: false,
      locationId: 'linked-device:mac-mini',
      agentGuidance: {
        writeAgentsMd: true,
      },
    })
    expect(body.data.agentGuidance.document).toEqual(expect.arrayContaining([
      'project id and name',
      'linked computer / location id',
      'workspace id',
    ]))
    expect(mockAutoLink).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      projectFolderRelativePath: 'projects/project-1',
    }))
  })

  it('rejects when the chat has no computer bound', async () => {
    mockGetLinkStatus.mockResolvedValue({
      status: 'no_computer',
      reason: 'conversation_has_no_computer',
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/link-to-conversation/route')
    const response = await POST(request({ conversationId: 'conv-1' }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.error).toMatch(/no computer/i)
  })
})
