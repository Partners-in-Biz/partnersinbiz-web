import { NextRequest } from 'next/server'
import { generateKeyPairSync, sign } from 'node:crypto'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
}
function receiptPayload(receipt: Record<string, unknown>): string {
  return [receipt.deviceId, receipt.runtimeTargetId, receipt.credentialVersion, receipt.mappingId, receipt.runtimeVersion, receipt.acceptedAt, receipt.toolStartedAt, receipt.outcome, receipt.runId, receipt.requestId].join('\n')
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockGetConversation = jest.fn()
const mockCreateMessage = jest.fn()
const mockListMessages = jest.fn()
const mockTouchConversation = jest.fn()
const mockMessagesCollection = jest.fn()
const mockCreateHermesRun = jest.fn()
const mockResolveAuthorizedWorkingDirectory = jest.fn()
const mockGetAgentDispatchHermesProfileLink = jest.fn()
const mockIsConfiguredCompatibilityRuntimeTarget = jest.fn()
const mockAuthorizeLinkedComputerDispatch = jest.fn()
const mockEnqueueLinkedRun = jest.fn()
const mockWaitForLinkedRunClaim = jest.fn()
const mockCancelLinkedRun = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'pib-platform-owner' }
let organizationSettings: Record<string, unknown> = {}
let organizationMembers: Array<{ userId: string; role: string }> = []

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  createMessage: mockCreateMessage,
  listMessages: mockListMessages,
  touchConversation: mockTouchConversation,
  messagesCollection: mockMessagesCollection,
}))

jest.mock('@/lib/hermes/server', () => ({
  createHermesRun: mockCreateHermesRun,
}))

jest.mock('@/lib/client-provisioning/working-directory', () => ({
  resolveAuthorizedWorkingDirectory: mockResolveAuthorizedWorkingDirectory,
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDispatchHermesProfileLink: mockGetAgentDispatchHermesProfileLink,
  isConfiguredCompatibilityRuntimeTarget: mockIsConfiguredCompatibilityRuntimeTarget,
  callAgentPath: mockCallAgentPath,
}))


jest.mock('@/lib/linked-computers/runtime-targets', () => ({
  ...jest.requireActual('@/lib/linked-computers/runtime-targets'),
  authorizeLinkedComputerDispatch: mockAuthorizeLinkedComputerDispatch,
}))

jest.mock('@/lib/linked-computers/run-queue-store', () => ({
  enqueueLinkedRun: mockEnqueueLinkedRun,
  waitForLinkedRunClaim: mockWaitForLinkedRunClaim,
  cancelLinkedRun: mockCancelLinkedRun,
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(true)
  mockEnqueueLinkedRun.mockResolvedValue({ jobId: 'job-linked-1' })
  mockWaitForLinkedRunClaim.mockResolvedValue({ status: 'claimed', claimedAtMs: Date.now() })
  mockCancelLinkedRun.mockResolvedValue(undefined)
  mockUser = { uid: 'client-1', role: 'client', orgId: 'pib-platform-owner' }
  organizationSettings = {}
  organizationMembers = [{ userId: 'client-1', role: 'member' }]

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              displayName: uid === 'client-1' ? 'Client User' : 'Pip',
              email: `${uid}@example.com`,
            }),
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => ({
            exists: orgId === 'org-1' || orgId === 'pib-platform-owner',
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
        doc: (_id: string) => ({
          get: async () => ({ exists: false, data: () => undefined }),
        }),
      }
    }
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              agentId,
              enabled: true,
              name: agentId === 'maya' ? 'Maya' : 'Pip',
              defaultModel: 'anthropic/claude-sonnet-4.6',
              baseUrl: 'https://hermes.example.com',
              skillPolicy: {
                runtimeSkills: ['content-engine', 'social-media-manager'],
                pibSkills: ['content-engine', 'social-media-manager'],
                globalSkills: ['google-workspace'],
                capabilities: ['read', 'draft', 'write'],
                approvalGates: ['publish'],
                primaryOwnerOf: ['content-engine'],
              },
            }),
          }),
        }),
      }
    }
    if (name === 'conversation_attachments') {
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: id === 'upload-1',
            data: () => ({
              conversationId: 'conv-1',
              orgId: 'pib-platform-owner',
              name: 'Screenshot.png',
              contentType: 'image/png',
              sizeBytes: 1234,
              storagePath: 'conversation-attachments/private/screenshot.png',
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
  mockCreateMessage.mockImplementation(async (_convId: string, input: Record<string, unknown>) => ({
    id: input.role === 'assistant' ? 'assistant-1' : 'msg-1',
    ...input,
  }))
  mockMessagesCollection.mockReturnValue({
    doc: () => ({
      update: jest.fn().mockResolvedValue(undefined),
    }),
  })
  mockTouchConversation.mockResolvedValue(undefined)
  mockListMessages.mockResolvedValue([])
  mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
    orgId: 'org-1',
    profile: 'pip',
    baseUrl: 'https://hermes.example.com',
    apiKey: 'secret',
    enabled: true,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  })
  mockCallAgentPath.mockResolvedValue({
    response: { ok: true, status: 200 },
    data: {
      data: [
        { id: 'anthropic/claude-sonnet-4.6', provider: 'anthropic', display_name: 'Claude Sonnet 4.6' },
        { id: 'openai/gpt-5.5', provider: 'openai', display_name: 'GPT-5.5' },
      ],
    },
  })
  mockCreateHermesRun.mockResolvedValue({
    ok: true,
    status: 202,
    data: { runId: 'run-1' },
    runDocId: 'run-doc-1',
    executionReceipt: { requestedRuntimeTargetId: 'legacy-profile', acceptedRuntimeTargetId: 'legacy-profile', requestedAt: '2026-07-12T20:00:00.000Z', acceptedAt: '2026-07-12T20:00:00.001Z', outcome: 'accepted' },
  })
  mockResolveAuthorizedWorkingDirectory.mockResolvedValue({
    ok: true,
    directory: '/Users/peetstander/Cowork/Partners in Biz/projects/website',
    pathClass: 'project',
  })
})

function req(input: { content?: string } = {}) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({ content: input.content ?? 'Hello' }),
  })
}

function reqWithAttachments() {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({
      content: 'image',
      attachments: [
        {
          id: 'upload-1',
          name: 'Screenshot.png',
          url: 'https://cdn.example.com/screenshot.png',
          contentType: 'image/png',
          sizeBytes: 1234,
        },
      ],
    }),
  })
}

function reqWithModel(model = 'openai/gpt-5.5', provider = 'openai') {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({ content: 'Use the selected model', model, provider }),
  })
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('unified conversation message routing', () => {
  it('does not dispatch an agent run for human-only conversations', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    const body = await readJson(res)
    expect(body.data.message.id).toBe('msg-1')
    expect(body.data.assistantMessage).toBeUndefined()
  })

  it('blocks client replies when the messages reply policy denies their org role', async () => {
    organizationSettings = {
      modulePolicies: {
        messages: {
          actions: {
            reply: { owner: true, admin: true, member: false },
          },
        },
      },
    }
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('still dispatches an agent run when an agent participant is present', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const body = await readJson(res)
    expect(body.data.assistantMessage.id).toBe('assistant-1')
    expect(body.data.runId).toBe('run-1')
    expect(body.data.dispatchAgentId).toBe('pip')
  })

  it('gives Pip project task lineage and smart creation rules for tagged project chat', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      scope: 'project',
      scopeRefId: 'project-1',
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req({ content: 'Plan the next campaign phase' }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Project chat orchestration]')
    expect(prompt).toContain('projectId: project-1')
    expect(prompt).toContain('conversationId: conv-1')
    expect(prompt).toContain('requestMessageId: msg-1')
    expect(prompt).toContain('responseMessageId: assistant-1')
    expect(prompt).toContain('project_task_proposal')
    expect(prompt).toContain('Create a clear, bounded, low-risk single task immediately')
  })

  it('enforces the selected local project folder as the Hermes run working directory', async () => {
    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'pib-platform-owner', profile: 'pip', baseUrl: 'https://local.example', apiKey: 'local-key', enabled: true,
      runtimeTargetId: 'local', runtimeKind: 'local', machineLabel: "Peet's Mac",
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: 'local',
        runtimeLabel: 'Local',
        workspaceId: 'partners',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'partners',
        vpsPath: '/var/lib/hermes/Cowork/Partners in Biz',
        localPath: '/Users/peetstander/Cowork/Partners in Biz',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
        localAgentDomainPath: '/Users/peetstander/Cowork/Cowork/agents/partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
        folderScope: 'project',
        projectId: 'website',
        vpsWorkingPath: '/var/lib/hermes/Cowork/Partners in Biz/projects/website',
        localWorkingPath: '/Users/peetstander/Cowork/Partners in Biz/projects/website',
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockResolveAuthorizedWorkingDirectory).toHaveBeenCalledWith({
      workspaceContext: expect.objectContaining({ projectId: 'website', runtimeTarget: 'local' }),
    })
    expect(mockCreateHermesRun.mock.calls[0][2]).toEqual(expect.objectContaining({
      working_directory: '/Users/peetstander/Cowork/Partners in Biz/projects/website',
      metadata: expect.objectContaining({
        requestedRuntimeTargetId: 'local',
        runtimeTargetId: 'local',
        runtimeKind: 'local',
        runtimeMachineLabel: "Peet's Mac",
        workspacePathClass: 'project',
      }),
    }))
    const metadata = mockCreateHermesRun.mock.calls[0][2].metadata
    expect(metadata).not.toHaveProperty('vpsWorkingPath')
    expect(metadata).not.toHaveProperty('localWorkingPath')
    expect(metadata).not.toHaveProperty('workspaceContext')
  })

  it('dispatches an authorized linked target through the outbound claim queue without direct transport', async () => {
    const keys = generateKeyPairSync('ed25519')
    mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(false)
    const binding = { kind: 'linked-computer', deviceId: 'device-a', runtimeTargetId: 'linked-device:device-a', machineLabel: 'Office Mac', mappingId: 'map-a', workspaceId: 'partners', credentialVersion: 2, runtimeVersion: '2.0.0', platform: 'macos', lastSeenAt: new Date().toISOString(), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
    mockAuthorizeLinkedComputerDispatch.mockResolvedValue(binding)
    const acceptedAt = new Date().toISOString()
    const receipt = { deviceId: 'device-a', runtimeTargetId: binding.runtimeTargetId, credentialVersion: 2, mappingId: 'map-a', runtimeVersion: '2.0.0', acceptedAt, toolStartedAt: acceptedAt, outcome: 'accepted', runId: 'run-1', requestId: 'assistant-1', signature: '' }
    receipt.signature = sign(null, Buffer.from(receiptPayload(receipt)), keys.privateKey).toString('base64url')
    mockCreateHermesRun.mockResolvedValue({ ok: true, status: 202, data: { runId: 'run-1' }, runDocId: 'run-doc-1', executionReceipt: receipt })
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'], participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }], workspaceContext: { runtimeTarget: binding.runtimeTargetId, runtimeLabel: 'Office Mac', workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps', shareMode: 'private', ownerUserId: 'client-1', companyId: null, contactIds: [] } })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(response.status).toBe(201)
    expect(mockEnqueueLinkedRun).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', mappingId: 'map-a', requestId: 'assistant-1' }))
    expect(mockWaitForLinkedRunClaim).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-linked-1' }))
    expect(mockGetAgentDispatchHermesProfileLink).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('keeps an arbitrary configured operator target on the compatibility resolver', async () => {
    mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(true)
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'], participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }], workspaceContext: { runtimeTarget: 'operator-cape-town', runtimeLabel: 'Operator Cape Town', workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps', shareMode: 'private', ownerUserId: 'client-1', companyId: null, contactIds: [] } })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(mockGetAgentDispatchHermesProfileLink).toHaveBeenCalledWith('pip', 'pib-platform-owner', { runtimeTarget: 'operator-cape-town' })
    expect(mockAuthorizeLinkedComputerDispatch).not.toHaveBeenCalled()
  })

  it('returns a stable safe dispatch failure without reflecting an exception', async () => {
    const unsafe = 'POST https://gateway.example/v1/runs apiKey=super-secret /Users/peet/private'
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockCreateHermesRun.mockRejectedValue(new Error(unsafe))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }],
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    const serialized = JSON.stringify(await readJson(res)) + JSON.stringify(update.mock.calls) + JSON.stringify(errorSpy.mock.calls)
    expect(serialized).not.toMatch(/gateway\.example|super-secret|Users\/peet/)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      workspaceDispatchFailureCode: 'dispatch_unavailable',
      error: 'Agent run could not be started on the gateway.',
    }))
    errorSpy.mockRestore()
  })

  it('does not create a Hermes request when an explicit local target is stale', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockGetAgentDispatchHermesProfileLink.mockRejectedValue(Object.assign(
      new Error('Selected runtime target local is stale'),
      { code: 'runtime_target_stale', requestedTargetId: 'local' },
    ))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }],
      workspaceContext: { runtimeTarget: 'local' },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      runtimeDispatchFailureCode: 'runtime_target_stale',
      requestedRuntimeTargetId: 'local',
    }))
    expect(errorSpy).toHaveBeenCalledWith('[conversation-agent-dispatch-failed]', {
      convId: 'conv-1', agentId: 'pip', code: 'runtime_target_stale', requestedRuntimeTargetId: 'local',
    })
    errorSpy.mockRestore()
  })

  it('does not reflect unsafe target or exception strings into logs or stored metadata', async () => {
    const unsafe = 'https://evil.example/path\napiKey=super-secret'
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockGetAgentDispatchHermesProfileLink.mockRejectedValue(Object.assign(new Error(unsafe), {
      code: 'runtime_target_invalid_id', requestedTargetId: unsafe,
    }))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }],
      workspaceContext: { runtimeTarget: unsafe },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('evil.example')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('super-secret')
    expect(JSON.stringify(update.mock.calls)).not.toContain('evil.example')
    expect(JSON.stringify(update.mock.calls)).not.toContain('super-secret')
    expect(errorSpy).toHaveBeenCalledWith('[conversation-agent-dispatch-failed]', {
      convId: 'conv-1', agentId: 'pip', code: 'runtime_target_invalid_id', requestedRuntimeTargetId: 'invalid',
    })
    errorSpy.mockRestore()
  })

  it('stores a typed safe failure when workspace directory authorization fails', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockResolveAuthorizedWorkingDirectory.mockResolvedValue({
      ok: false,
      code: 'workspace_directory_outside_root',
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: 'local',
        runtimeLabel: 'Local',
        workspaceId: 'partners',
        localPath: '/authorized/root',
        localWorkingPath: '/secret/path',
        vpsPath: '/authorized/root',
        vpsWorkingPath: '/secret/path',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'partners',
        agentDomainPath: '/agents/partners',
        localAgentDomainPath: '/agents/partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: 'The selected workspace directory is unavailable or not authorized.',
      workspaceDispatchFailureCode: 'workspace_directory_outside_root',
    }))
    expect(JSON.stringify(await readJson(res))).not.toContain('/secret/path')
  })

  it('includes the CEO data-first dashboard rule in every agent prompt', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req({ content: 'Build me a dashboard for marketing performance' }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(201)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[CEO data-decision operating rule]')
    expect(prompt).toContain('Do not default to permanent dashboards')
    expect(prompt).toContain('Confirm the needed facts are stored in the database')
    expect(prompt).toContain('If the database does not contain the required facts, do not infer or fabricate the answer.')
    expect(prompt).toContain('Request or create a reusable gather skill/workflow, then rerun analysis after the gather exists.')
    expect(prompt).toContain('Use or create a reusable gather skill/workflow')
    expect(prompt).toContain('GET /api/v1/agent/growth-command-queue')
    expect(prompt).toContain('Treat its sourceReports and queue as the stored-data input')
    expect(prompt).toContain('Temporary throw-away HTML is allowed only for a named one-off question where visual comparison materially improves the answer')
    expect(prompt).toContain('Run focused analysis for the specific decision')
    expect(prompt).toContain('Create temporary throw-away HTML only when useful')
    expect(prompt).toContain('Do not make server Markdown, local files, logs, or a hidden dashboard the CEO-facing delivery surface')
    expect(prompt).toContain('Return the decision, evidence, reusable workflow, and next actions in this dynamic chat window')
    expect(prompt).toContain('If you persist Markdown/docs for internal memory, summarize every actionable outcome in chat')
    expect(prompt).toContain('Temporary HTML is allowed only as a throw-away linked/attached artifact inside the chat thread')
    expect(prompt).toContain('When you need CEO approval, return a structured rich message, not a Markdown-only card')
    expect(prompt).toContain('type "approval_card"')
    expect(prompt).toContain('Approval cards must include: title, body, statusLabel, evidence, dataSkill, analysisQuestion, decisions, recommendation, replyTemplate, and safetyNote')
    expect(prompt).toContain('If the growth-command-queue returns a queue item with approvalRequired=true, answer with an approval_card')
    expect(prompt).toContain('Use approval_card for deal follow-ups, Marketing Studio publish/schedule decisions')
    expect(prompt).toContain('"rich_parts":[{"type":"approval_card"')
    expect(prompt).toContain('Build me a dashboard for marketing performance')
  })

  it('routes multi-agent conversations through Pip with council-style orchestration guidance', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip', 'maya', 'theo'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
        { kind: 'agent', agentId: 'maya', name: 'Maya' },
        { kind: 'agent', agentId: 'theo', name: 'Theo' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Multi-agent orchestration]')
    expect(prompt).toContain('Council-style multi-agent orchestration requirements:')
    expect(prompt).toContain('Hermes subagents for bounded one-off analysis')
    expect(prompt).toContain('Theo=engineering')
    expect(mockCreateHermesRun.mock.calls[0][2].metadata).toEqual(expect.objectContaining({
      dispatchAgentId: 'pip',
      requestedAgentIds: ['pip', 'maya', 'theo'],
      orchestrationMode: 'pip-orchestrator',
    }))
  })

  it('injects selected agent skills and approval gates into the dispatched prompt', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['maya'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'maya', name: 'Maya' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Selected agent skills]')
    expect(prompt).toContain('agent: Maya (maya)')
    expect(prompt).toContain('available-skills: content-engine, social-media-manager, google-workspace')
    expect(prompt).toContain('capabilities: read, draft, write')
    expect(prompt).toContain('approval-gates: publish')
  })

  it('injects council-mode guidance when the /council slash command is used', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Should we launch the new workflow this week?',
        slashCommand: {
          id: 'council',
          token: '/council',
          label: 'Council mode',
          executorKind: 'agent_intent',
          args: 'Should we launch the new workflow this week?',
        },
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('id: council')
    expect(prompt).toContain('Council mode requirements:')
    expect(prompt).toContain('Select the relevant PiB specialist perspectives')
    expect(prompt).toContain('consensus/recommendation')
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      slashCommand: expect.objectContaining({
        id: 'council',
        token: '/council',
        args: 'Should we launch the new workflow this week?',
      }),
    }))
  })

  it('returns a failed assistant message instead of a 500 when agent runtime resolution fails', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockGetAgentDispatchHermesProfileLink.mockRejectedValue(new Error('No reachable runtime target configured'))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: 'Agent dispatch is not configured for this Preview environment.',
    }))
    const body = await readJson(res)
    expect(body.data.assistantMessage.status).toBe('failed')
  })

  it('stores validated message attachments with the user message', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithAttachments(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      attachments: [
        {
          id: 'upload-1',
          name: 'Screenshot.png',
          url: '/api/v1/conversations/conv-1/attachments/upload-1',
          contentType: 'image/png',
          sizeBytes: 1234,
        },
      ],
    }))
  })

  it('passes admin-selected model and provider overrides into the Hermes run', async () => {
    mockUser = { uid: 'admin-1', role: 'admin' }
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithModel(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCallAgentPath).toHaveBeenCalledWith('pip', '/v1/models', { method: 'GET' })
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'user',
      model: 'openai/gpt-5.5',
      provider: 'openai',
    }))
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      model: 'openai/gpt-5.5',
      provider: 'openai',
    }))
    expect(mockCreateHermesRun).toHaveBeenCalledWith(
      expect.any(Object),
      'admin-1',
      expect.objectContaining({
        model: 'openai/gpt-5.5',
        provider: 'openai',
        metadata: expect.objectContaining({
          model: 'openai/gpt-5.5',
          provider: 'openai',
        }),
      }),
    )
  })

  it('rejects client-supplied model overrides before storing messages', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithModel(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('rejects unavailable model overrides before storing messages', async () => {
    mockUser = { uid: 'admin-1', role: 'admin' }
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithModel('anthropic/not-real', 'anthropic'), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('rejects malformed model overrides before storing messages', async () => {
    mockUser = { uid: 'admin-1', role: 'admin' }
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithModel('bad model<script>', ''), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.error).toContain('Invalid model id')
    expect(mockCallAgentPath).not.toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })
})
