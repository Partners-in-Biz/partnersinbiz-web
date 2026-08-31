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
const mockMintMessagesDispatchDelegation = jest.fn()
const mockResolveAuthorizedWorkingDirectory = jest.fn()
const mockGetAgentDispatchHermesProfileLink = jest.fn()
const mockIsConfiguredCompatibilityRuntimeTarget = jest.fn()
const mockAuthorizeLinkedComputerDispatch = jest.fn()
const mockAuthorizeLinkedComputerRecoveryQueue = jest.fn()
const mockAuthorizeWorkspaceRuntime = jest.fn()
const mockRequireProjectRuntimeReplica = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockEnqueueLinkedRun = jest.fn()
const mockWaitForLinkedRunClaim = jest.fn()
const mockCancelLinkedRun = jest.fn()
const mockCallAgentPath = jest.fn()
const mockValidateMessageModelSelection = jest.fn()
const mockRequireReadyLlmCredentialBinding = jest.fn()
const mockResolveLlmCredentialRuntimeTarget = jest.fn()
const mockEnsureFreshXaiCredentialForDispatch = jest.fn()
const mockParseMentions = jest.fn()
const mockNotifyMentions = jest.fn()
const mockNotifyConversationMentions = jest.fn()
const mockSpawnObservableDelegations = jest.fn()

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

jest.mock('@/lib/api/delegations', () => {
  const actual = jest.requireActual('@/lib/api/delegations') as typeof import('@/lib/api/delegations')
  return {
    ...actual,
    mintMessagesDispatchDelegation: (...args: unknown[]) => mockMintMessagesDispatchDelegation(...args),
  }
})

jest.mock('@/lib/client-provisioning/working-directory', () => ({
  resolveAuthorizedWorkingDirectory: mockResolveAuthorizedWorkingDirectory,
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDispatchHermesProfileLink: mockGetAgentDispatchHermesProfileLink,
  isConfiguredCompatibilityRuntimeTarget: mockIsConfiguredCompatibilityRuntimeTarget,
  callAgentPath: mockCallAgentPath,
}))
jest.mock('@/lib/messages/model-catalog', () => ({
  validateMessageModelSelection: (...args: unknown[]) => mockValidateMessageModelSelection(...args),
}))
jest.mock('@/lib/llm-providers/bindings', () => ({
  requireReadyLlmCredentialBinding: (...args: unknown[]) => mockRequireReadyLlmCredentialBinding(...args),
}))
jest.mock('@/lib/llm-providers/sync-targets', () => ({
  resolveLlmCredentialRuntimeTarget: (...args: unknown[]) => mockResolveLlmCredentialRuntimeTarget(...args),
}))
jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  ensureFreshXaiCredentialForDispatch: (...args: unknown[]) => mockEnsureFreshXaiCredentialForDispatch(...args),
}))
jest.mock('@/lib/comments/mentions', () => ({
  parseMentions: (...args: unknown[]) => mockParseMentions(...args),
  notifyMentions: (...args: unknown[]) => mockNotifyMentions(...args),
}))
jest.mock('@/lib/comments/conversation-mentions', () => ({
  notifyConversationMentions: (...args: unknown[]) => mockNotifyConversationMentions(...args),
}))
const mockAttachDelegationBranchMessage = jest.fn()
const mockSetSkillCatalog = jest.fn()
const mockBuildDispatchBlock = jest.fn()
jest.mock('@/lib/hermes-features/service', () => {
  const actual = jest.requireActual('@/lib/hermes-features/service') as typeof import('@/lib/hermes-features/service')
  return {
    ...actual,
    hermesFeaturesService: {
      ...actual.hermesFeaturesService,
      spawnObservableDelegations: (...args: unknown[]) => mockSpawnObservableDelegations(...args),
      attachDelegationBranchMessage: (...args: unknown[]) => mockAttachDelegationBranchMessage(...args),
      setSkillCatalog: (...args: unknown[]) => mockSetSkillCatalog(...args),
      buildDispatchBlock: (...args: unknown[]) => mockBuildDispatchBlock(...args),
    },
  }
})


jest.mock('@/lib/linked-computers/runtime-targets', () => ({
  ...jest.requireActual('@/lib/linked-computers/runtime-targets'),
  authorizeLinkedComputerDispatch: mockAuthorizeLinkedComputerDispatch,
  authorizeLinkedComputerRecoveryQueue: mockAuthorizeLinkedComputerRecoveryQueue,
}))

jest.mock('@/lib/linked-computers/run-queue-store', () => ({
  enqueueLinkedRun: mockEnqueueLinkedRun,
  waitForLinkedRunClaim: mockWaitForLinkedRunClaim,
  cancelLinkedRun: mockCancelLinkedRun,
}))

jest.mock('@/lib/workspaces/runtime-authorization', () => ({
  authorizeWorkspaceRuntime: mockAuthorizeWorkspaceRuntime,
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
jest.mock('@/lib/projects/access', () => ({ getProjectForUser: mockGetProjectForUser }))
jest.mock('@/lib/client-provisioning/company-cowork-dispatch', () => ({
  ...jest.requireActual('@/lib/client-provisioning/company-cowork-dispatch'),
  enrichCompanyCoworkWorkspaceContext: async (workspace: Record<string, unknown>) => workspace,
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
  mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(true)
  mockAuthorizeWorkspaceRuntime.mockImplementation(async ({ runtimeTargetId }: { runtimeTargetId: string }) => ({
    kind: 'execution-location', locationId: runtimeTargetId === 'local' ? 'peets-mac-mini' : 'partners-vps',
    runtimeTargetId, machineLabel: runtimeTargetId === 'local' ? "Peet's Mac" : 'Partners VPS',
    locationKind: runtimeTargetId === 'local' ? 'computer' : 'vps',
    transportIdentity: `test-transport:${runtimeTargetId}`,
  }))
  mockRequireProjectRuntimeReplica.mockResolvedValue({ replicaId: 'replica-project-runtime' })
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'pib-platform-owner' }) },
    projectAccess: { role: 'manager' },
  })
  mockEnqueueLinkedRun.mockResolvedValue({ jobId: 'job-linked-1' })
  mockAuthorizeLinkedComputerRecoveryQueue.mockReset()
  mockWaitForLinkedRunClaim.mockResolvedValue({ status: 'running', acceptanceReceipt: { deviceId: 'device-a', machineLabel: 'Verified Mac', runtimeVersion: '2.0.0', acceptedAt: '2026-07-13T09:00:00.000Z' } })
  mockCancelLinkedRun.mockResolvedValue(undefined)
  mockUser = { uid: 'client-1', role: 'client', orgId: 'pib-platform-owner' }
  organizationSettings = {}
  organizationMembers = [{ userId: 'client-1', role: 'member' }]
  mockMintMessagesDispatchDelegation.mockResolvedValue(null)
  mockRequireReadyLlmCredentialBinding.mockResolvedValue({ id: 'binding-test' })
  mockEnsureFreshXaiCredentialForDispatch.mockResolvedValue({ refreshed: false })
  mockResolveLlmCredentialRuntimeTarget.mockImplementation(async (input: { runtimeTargetId?: string }) => ({
    runtimeTargetId: input.runtimeTargetId || 'vps',
    deviceId: null,
    ownerType: input.runtimeTargetId === 'local' ? 'user' : 'organization',
  }))
  mockParseMentions.mockReturnValue([])
  mockNotifyMentions.mockResolvedValue(undefined)
  mockNotifyConversationMentions.mockResolvedValue({ notifiedUserIds: [], pushAttempted: 0 })
  mockSpawnObservableDelegations.mockResolvedValue({
    id: 'del_test_1',
    orgId: 'pib-platform-owner',
    agentId: 'pip',
    conversationId: 'conv-1',
    parentRunHint: 'messages:conv-1',
    maxConcurrent: 3,
    children: [{ id: 'child_1', goal: 'work', status: 'running', agentId: 'maya', runId: 'run-1' }],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  })
  mockSetSkillCatalog.mockResolvedValue([])
  mockBuildDispatchBlock.mockResolvedValue({
    block: '',
    expansionsCount: 0,
    enabledToolsets: [],
    loadedSkillIds: [],
    contextFileNames: [],
  })
  mockAttachDelegationBranchMessage.mockImplementation(async (_org: string, id: string, branchMessageId: string) => ({
    id,
    orgId: 'pib-platform-owner',
    agentId: 'pip',
    conversationId: 'conv-1',
    branchMessageId,
    parentRunHint: 'messages:conv-1',
    maxConcurrent: 3,
    children: [{ id: 'child_1', goal: 'work', status: 'running', agentId: 'maya', runId: 'run-1' }],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }))
  mockValidateMessageModelSelection.mockImplementation(async (input: { model?: unknown; provider?: unknown }) => {
    const model = typeof input.model === 'string' ? input.model : ''
    const provider = typeof input.provider === 'string' ? input.provider : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+~=-]{0,191}$/.test(model)) {
      return { ok: false, status: 400, error: 'Invalid model id.' }
    }
    if (model === 'anthropic/not-real') {
      return { ok: false, status: 400, error: 'Selected model is not available for this agent runtime.' }
    }
    return {
      ok: true,
      selection: {
        model,
        provider,
        llmConnectionId: 'org:pib-platform-owner:openai-api',
        llmCredentialBindingId: 'binding-test',
      },
    }
  })

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
    if (name === 'projectOrganizations') {
      return {
        doc: (id: string) => ({
          get: async () => {
            const orgId = 'pib-platform-owner'
            const suffix = `_${orgId}`
            const projectId = id.endsWith(suffix) ? id.slice(0, -suffix.length) : ''
            return {
              exists: Boolean(projectId),
              data: () => projectId ? { projectId, orgId, status: 'active' } : undefined,
            }
          },
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
  const mockMessageUpdate = jest.fn().mockResolvedValue(undefined)
  mockMessagesCollection.mockReturnValue({
    doc: () => ({
      update: mockMessageUpdate,
    }),
  })
  ;(globalThis as { __mockMessageUpdate?: jest.Mock }).__mockMessageUpdate = mockMessageUpdate
  mockTouchConversation.mockResolvedValue(undefined)
  mockListMessages.mockResolvedValue([])
  mockGetAgentDispatchHermesProfileLink.mockImplementation(async (
    agentId: string,
    _orgId: string,
    options?: { runtimeTarget?: string | null },
  ) => {
    const runtimeTargetId = options?.runtimeTarget ?? 'vps'
    return {
      orgId: 'org-1',
      profile: agentId,
      baseUrl: 'https://hermes.example.com',
      apiKey: 'secret',
      enabled: true,
      runtimeTargetId,
      transportIdentity: `test-transport:${runtimeTargetId}`,
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    }
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
    directory: '/Users/peetstander/Cowork/partners/Partners in Biz/projects/website',
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
    body: JSON.stringify({
      content: 'Use the selected model',
      model,
      provider,
      llmConnectionId: 'org:pib-platform-owner:openai-api',
      llmCredentialBindingId: 'binding-test',
    }),
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

  it('stores parsed mentions on human messages and emits mention notifications', async () => {
    mockParseMentions.mockReturnValue([
      { type: 'user', id: 'client-2', raw: '@user:client-2' },
      { type: 'agent', id: 'maya', raw: '@agent:maya' },
    ])
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
    const res = await POST(req({ content: 'Hi @user:client-2, can @agent:maya review this?' }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'user',
      mentions: [
        { type: 'user', id: 'client-2', raw: '@user:client-2' },
        { type: 'agent', id: 'maya', raw: '@agent:maya' },
      ],
      mentionIds: ['user:client-2', 'agent:maya'],
    }))
    expect(mockNotifyConversationMentions).toHaveBeenCalledWith({
      orgId: 'pib-platform-owner',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      mentions: [
        { type: 'user', id: 'client-2', raw: '@user:client-2' },
        { type: 'agent', id: 'maya', raw: '@agent:maya' },
      ],
      actorName: 'Client User',
      snippet: 'Hi @user:client-2, can @agent:maya review this?',
    })
    // @agent:maya also opens an isolated specialist branch (not the primary dispatcher).
    expect(mockSpawnObservableDelegations).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      conversationId: 'conv-1',
      goals: expect.arrayContaining([
        expect.objectContaining({ agentId: 'maya' }),
      ]),
    }))
  })

  it('does not notify when no mentions exist in the user message', async () => {
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
    expect(mockNotifyMentions).not.toHaveBeenCalled()
    expect(mockNotifyConversationMentions).not.toHaveBeenCalled()
    expect(mockSpawnObservableDelegations).not.toHaveBeenCalled()
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

  it('dispatches a non-linked specialist without requiring a runtime grant', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['sales'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'sales', name: 'Sales' },
      ],
      workspaceContext: {
        runtimeTarget: 'vps',
        runtimeLabel: 'Office Mac',
        workspaceId: 'acme',
        orgId: 'pib-platform-owner',
        orgName: 'Partners in Biz',
        orgSlug: 'partners',
        ownerUserId: 'client-1',
        shareMode: 'private',
        sourceOfTruth: 'vps',
        folderScope: 'workspace',
        companyId: null,
        contactIds: [],
      } as unknown,
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const body = await readJson(res)
    expect(body.data.assistantMessage.id).toBe('assistant-1')
    expect(body.data.dispatchAgentId).toBe('sales')
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

  it('mints a fresh user-delegation token on every human-triggered Hermes turn including read-only chat', async () => {
    mockMintMessagesDispatchDelegation.mockResolvedValue({
      id: 'dlg-hello-1',
      token: 'pib_dlg_fresh_hello_token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      actingForUserId: 'client-1',
      agentId: 'pip',
      orgIds: ['pib-platform-owner'],
      scopes: [],
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
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req({ content: 'Hello' }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockMintMessagesDispatchDelegation).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ uid: 'client-1', role: 'client' }),
      orgId: 'pib-platform-owner',
      agentId: 'pip',
      conversationId: 'conv-1',
    }))
    const hermesArgs = mockCreateHermesRun.mock.calls[0][2]
    expect(hermesArgs.prompt).toContain('Authorization: Bearer pib_dlg_fresh_hello_token')
    expect(hermesArgs.prompt).toContain('Use ONLY the Bearer token in THIS block')
    expect(hermesArgs.prompt).not.toMatch(/send any chat message to (re)?mint/i)
    expect(hermesArgs.prompt).not.toMatch(/re-send a message to mint a token/i)
  })

  it('mints a user-delegation token and injects it into the Hermes prompt + metadata', async () => {
    mockMintMessagesDispatchDelegation.mockResolvedValue({
      id: 'dlg-messages-1',
      token: 'pib_dlg_testtoken1234567890abcdef',
      expiresAt: '2099-01-01T00:00:00.000Z',
      actingForUserId: 'client-1',
      agentId: 'pip',
      orgIds: ['pib-platform-owner'],
      scopes: ['documents:create', 'documents:update'],
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
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req({ content: 'Create the CRM spec document' }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockMintMessagesDispatchDelegation).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ uid: 'client-1', role: 'client' }),
      orgId: 'pib-platform-owner',
      agentId: 'pip',
      conversationId: 'conv-1',
    }))
    const hermesArgs = mockCreateHermesRun.mock.calls[0][2]
    expect(hermesArgs.prompt).toContain('[Partners in Biz API auth — user delegation]')
    expect(hermesArgs.prompt).toContain('Authorization: Bearer pib_dlg_testtoken1234567890abcdef')
    expect(hermesArgs.prompt).toContain('X-Org-Id: pib-platform-owner')
    expect(hermesArgs.prompt).toContain('Do not use AI_API_KEY')
    expect(hermesArgs.metadata).toEqual(expect.objectContaining({
      delegationId: 'dlg-messages-1',
      authKind: 'user_delegation',
      actingForUserId: 'client-1',
    }))
    expect(hermesArgs.metadata).not.toHaveProperty('token')
    expect((globalThis as { __mockMessageUpdate?: jest.Mock }).__mockMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ delegationId: 'dlg-messages-1', runId: 'run-1' }),
    )
  })

  it('enforces the selected local project folder as the Hermes run working directory', async () => {
    mockRequireProjectRuntimeReplica.mockResolvedValueOnce({
      replicaId: 'replica-project-runtime',
      relativePath: 'clients/partners/website',
    })
    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'pib-platform-owner', profile: 'pip', baseUrl: 'https://local.example', apiKey: 'local-key', enabled: true,
      runtimeTargetId: 'local', runtimeKind: 'local', machineLabel: "Peet's Mac",
      transportIdentity: 'test-transport:local',
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
        vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
        localPath: '/Users/peetstander/Cowork/partners/Partners in Biz',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
        localAgentDomainPath: '/Users/peetstander/Cowork/Cowork/agents/partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
        folderScope: 'project',
        projectId: 'website',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Partners in Biz/projects/website',
        localWorkingPath: '/Users/peetstander/Cowork/partners/Partners in Biz/projects/website',
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockResolveAuthorizedWorkingDirectory).toHaveBeenCalledWith({
      workspaceContext: expect.objectContaining({ projectId: 'website', runtimeTarget: 'local' }),
      projectId: 'website',
      projectRelativePath: 'clients/partners/website',
    })
    expect(mockCreateHermesRun.mock.calls[0][2]).toEqual(expect.objectContaining({
      working_directory: '/Users/peetstander/Cowork/partners/Partners in Biz/projects/website',
      working_directory_root: '/Users/peetstander/Cowork/partners/Partners in Biz',
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
    const binding = { kind: 'linked-computer', deviceId: 'device-a', locationId: 'linked-device:device-a', runtimeTargetId: 'linked-device:device-a', machineLabel: 'Office Mac', mappingId: 'map-a', workspaceId: 'partners', credentialVersion: 2, runtimeVersion: '2.0.0', platform: 'macos', lastSeenAt: new Date().toISOString(), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
    mockAuthorizeLinkedComputerDispatch.mockResolvedValue(binding)
    mockAuthorizeWorkspaceRuntime.mockResolvedValue(binding)
    mockRequireProjectRuntimeReplica.mockResolvedValueOnce({
      replicaId: 'replica-project-runtime',
      relativePath: 'clients/partners/website',
    })
    const acceptedAt = new Date().toISOString()
    const receipt = { deviceId: 'device-a', runtimeTargetId: binding.runtimeTargetId, credentialVersion: 2, mappingId: 'map-a', runtimeVersion: '2.0.0', acceptedAt, toolStartedAt: acceptedAt, outcome: 'accepted', runId: 'run-1', requestId: 'assistant-1', signature: '' }
    receipt.signature = sign(null, Buffer.from(receiptPayload(receipt)), keys.privateKey).toString('base64url')
    mockCreateHermesRun.mockResolvedValue({ ok: true, status: 202, data: { runId: 'run-1' }, runDocId: 'run-doc-1', executionReceipt: receipt })
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'], participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }], workspaceContext: { runtimeTarget: binding.runtimeTargetId, runtimeLabel: 'Office Mac', workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps', shareMode: 'private', ownerUserId: 'client-1', projectId: 'website', folderScope: 'project', companyId: null, contactIds: [] } })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(response.status).toBe(201)
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'client-1', orgId: 'pib-platform-owner', workspaceId: 'partners', runtimeTargetId: binding.runtimeTargetId,
    }))
    expect(mockEnqueueLinkedRun).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      mappingId: 'map-a',
      requestId: 'assistant-1',
      projectId: 'website',
      projectReplicaId: 'replica-project-runtime',
      relativeFolder: 'clients/partners/website',
    }))
    expect(mockWaitForLinkedRunClaim).not.toHaveBeenCalled()
    expect(mockCancelLinkedRun).not.toHaveBeenCalled()
    expect(mockGetAgentDispatchHermesProfileLink).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('queues company Cowork linked runs with the company local workingDirectory', async () => {
    const keys = generateKeyPairSync('ed25519')
    mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(false)
    const binding = {
      kind: 'linked-computer',
      deviceId: 'device-a',
      locationId: 'linked-device:device-a',
      runtimeTargetId: 'linked-device:device-a',
      machineLabel: 'Office Mac',
      mappingId: 'map-a',
      workspaceId: 'partners',
      credentialVersion: 2,
      runtimeVersion: '1.1.3',
      platform: 'macos',
      lastSeenAt: new Date().toISOString(),
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }
    mockAuthorizeWorkspaceRuntime.mockResolvedValue(binding)
    mockWaitForLinkedRunClaim.mockResolvedValue({
      status: 'running',
      acceptanceReceipt: {
        deviceId: 'device-a',
        machineLabel: 'Verified Mac',
        runtimeVersion: '1.1.3',
        acceptedAt: '2026-07-13T09:00:00.000Z',
      },
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      scope: 'company',
      scopeRefId: 'company-hunt',
      workspaceContext: {
        runtimeTarget: binding.runtimeTargetId,
        runtimeLabel: 'Office Mac',
        workspaceId: 'partners',
        companyWorkspaceId: 'hunt-and-gun',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'hunt-and-gun',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
        localAgentDomainPath: '/Users/peetstander/Cowork/Cowork/agents/hunt-and-gun',
        vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        localPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        localWorkingPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        folderScope: 'company',
        companyId: 'company-hunt',
        companyName: 'Hunt and Gun',
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(response.status).toBe(201)
    expect(mockEnqueueLinkedRun).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      mappingId: 'map-a',
      relativeFolder: '.',
      workingDirectory: '/Users/peetstander/Cowork/partners/Hunt and Gun',
    }))
    const prompt = String(mockEnqueueLinkedRun.mock.calls[0][0].payload.prompt)
    expect(prompt).toContain('bound to the Hunt and Gun Cowork folder')
    expect(prompt).toContain('agentDomain: hunt-and-gun')
    expect(prompt).toContain('Do not treat this as a Partners in Biz platform session')
  })

  it('fails closed when a company Cowork linked computer is below runtime 1.1.3', async () => {
    mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(false)
    const binding = {
      kind: 'linked-computer',
      deviceId: 'device-a',
      locationId: 'linked-device:device-a',
      runtimeTargetId: 'linked-device:device-a',
      machineLabel: 'Office Mac',
      mappingId: 'map-a',
      workspaceId: 'partners',
      credentialVersion: 2,
      runtimeVersion: '1.1.2',
      platform: 'macos',
      lastSeenAt: new Date().toISOString(),
      publicKey: 'pk',
    }
    mockAuthorizeWorkspaceRuntime.mockResolvedValue(binding)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: binding.runtimeTargetId,
        runtimeLabel: 'Office Mac',
        workspaceId: 'partners',
        companyWorkspaceId: 'hunt-and-gun',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'hunt-and-gun',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        folderScope: 'company',
        companyId: 'company-hunt',
        companyName: 'Hunt and Gun',
        localWorkingPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(response.status).toBe(201)
    expect(mockEnqueueLinkedRun).not.toHaveBeenCalled()
    const mockMessageUpdate = (globalThis as { __mockMessageUpdate?: jest.Mock }).__mockMessageUpdate
    expect(mockMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      workspaceDispatchFailureCode: 'linked_device_update_required',
    }))
  })

  it('dispatches VPS company Cowork chats with Hunt and Gun working_directory and company prompt framing', async () => {
    mockResolveAuthorizedWorkingDirectory.mockResolvedValue({
      ok: true,
      directory: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      pathClass: 'company',
    })
    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'pib-platform-owner',
      profile: 'pip',
      baseUrl: 'https://hermes.example.com',
      apiKey: 'secret',
      enabled: true,
      runtimeTargetId: 'vps',
      runtimeKind: 'vps',
      machineLabel: 'Partners VPS',
      transportIdentity: 'test-transport:vps',
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    })
    mockCreateHermesRun.mockResolvedValue({ ok: true, status: 202, data: { runId: 'run-vps-1' }, runDocId: 'run-doc-vps' })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      scope: 'company',
      scopeRefId: 'company-hunt',
      workspaceContext: {
        runtimeTarget: 'vps',
        runtimeLabel: 'Partners VPS',
        workspaceId: 'partners',
        companyWorkspaceId: 'hunt-and-gun',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'hunt-and-gun',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
        localAgentDomainPath: '/Users/peetstander/Cowork/Cowork/agents/hunt-and-gun',
        vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        localPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        localWorkingPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        folderScope: 'company',
        companyId: 'company-hunt',
        companyName: 'Hunt and Gun',
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(response.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledWith(
      expect.anything(),
      'client-1',
      expect.objectContaining({
        working_directory: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        working_directory_root: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      }),
    )
    const prompt = String(mockCreateHermesRun.mock.calls[0][2].prompt)
    expect(prompt).toContain('bound to the Hunt and Gun Cowork folder')
    expect(prompt).toContain('Do not treat this as a Partners in Biz platform session')
    expect(prompt).not.toContain('top-level Partners in Biz workspace')
  })

  it('keeps an arbitrary configured operator target on the compatibility resolver', async () => {
    mockIsConfiguredCompatibilityRuntimeTarget.mockResolvedValue(true)
    mockGetConversation.mockResolvedValue({ id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'], participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }], workspaceContext: { runtimeTarget: 'operator-cape-town', runtimeLabel: 'Operator Cape Town', workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps', shareMode: 'private', ownerUserId: 'client-1', companyId: null, contactIds: [] } })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({ runtimeTargetId: 'operator-cape-town' }))
    expect(mockGetAgentDispatchHermesProfileLink).toHaveBeenCalledWith('pip', 'pib-platform-owner', { runtimeTarget: 'operator-cape-town' })
  })

  it('rejects an unavailable bound computer before storing the user message', async () => {
    mockAuthorizeWorkspaceRuntime.mockRejectedValue(new Error('Computer unavailable'))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: 'local',
        runtimeLabel: "Peet's Mac",
        workspaceId: 'partners',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(409)
    expect(await readJson(response)).toEqual(expect.objectContaining({ error: 'Computer unavailable' }))
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockTouchConversation).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('queues a message on the exact authorised computer while it reconnects', async () => {
    const binding = {
      kind: 'linked-computer',
      deviceId: 'device-recovering',
      locationId: 'linked-device:device-recovering',
      runtimeTargetId: 'target-recovering',
      machineLabel: 'Peets-Mac-mini.local',
      mappingId: 'map-recovering',
      mappingLabel: 'Client Growth',
      workspaceId: 'partners',
      credentialVersion: 2,
      runtimeVersion: '1.1.24',
      platform: 'macos',
      deviceKind: 'computer',
      lastSeenAt: new Date().toISOString(),
      publicKey: 'pk',
      availableAgentIds: [],
      accessMode: 'owner',
    }
    const actual = jest.requireActual('@/lib/linked-computers/runtime-targets') as typeof import('@/lib/linked-computers/runtime-targets')
    mockAuthorizeWorkspaceRuntime.mockRejectedValue(new actual.LinkedComputerDispatchError('linked_device_stale'))
    mockAuthorizeLinkedComputerRecoveryQueue.mockResolvedValue(binding)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: 'target-recovering',
        runtimeLabel: 'Peets-Mac-mini.local',
        workspaceId: 'partners',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(201)
    expect(mockAuthorizeLinkedComputerRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      runtimeTargetId: 'target-recovering', workspaceId: 'partners', agentId: 'pip',
    }))
    expect(mockEnqueueLinkedRun).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-recovering',
      runtimeTargetId: 'target-recovering',
      mappingId: 'map-recovering',
      queuedReason: 'runtime_restarting',
    }))
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect((await readJson(response)).data.assistantMessage).toEqual(expect.objectContaining({
      status: 'queued',
      queuedReason: 'runtime_restarting',
    }))
  })

  it('keeps a reconnecting Linux desktop queued on its selected computer', async () => {
    const binding = {
      kind: 'linked-computer',
      deviceId: 'linux-desktop-recovering',
      locationId: 'linked-device:linux-desktop-recovering',
      runtimeTargetId: 'linux-desktop-recovering',
      machineLabel: 'Studio Linux desktop',
      mappingId: 'map-linux-desktop',
      mappingLabel: 'Client Growth',
      workspaceId: 'partners',
      credentialVersion: 2,
      runtimeVersion: '1.1.24',
      platform: 'linux',
      deviceKind: 'computer',
      lastSeenAt: new Date().toISOString(),
      publicKey: 'pk',
      availableAgentIds: [],
      accessMode: 'owner',
    }
    const actual = jest.requireActual('@/lib/linked-computers/runtime-targets') as typeof import('@/lib/linked-computers/runtime-targets')
    mockAuthorizeWorkspaceRuntime.mockRejectedValue(new actual.LinkedComputerDispatchError('linked_device_stale'))
    mockAuthorizeLinkedComputerRecoveryQueue.mockResolvedValue(binding)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: {
        runtimeTarget: 'linux-desktop-recovering',
        runtimeLabel: 'Studio Linux desktop',
        workspaceId: 'partners',
        orgId: 'pib-platform-owner',
        orgSlug: 'partners',
        orgName: 'Partners in Biz',
        agentDomain: 'partners',
        sourceOfTruth: 'vps',
        shareMode: 'private',
        ownerUserId: 'client-1',
        companyId: null,
        contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(201)
    expect(mockEnqueueLinkedRun).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'linux-desktop-recovering',
      runtimeTargetId: 'linux-desktop-recovering',
      mappingId: 'map-linux-desktop',
      queuedReason: 'runtime_restarting',
    }))
    expect(mockGetAgentDispatchHermesProfileLink).not.toHaveBeenCalledWith('pip', 'pib-platform-owner', expect.objectContaining({ runtimeTarget: 'vps' }))
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('rejects an unlinked project computer before storing the user message', async () => {
    mockRequireProjectRuntimeReplica.mockRejectedValueOnce(new Error('Project is not linked to this computer'))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }],
      scope: 'project', scopeRefId: 'website',
      workspaceContext: {
        runtimeTarget: 'local', runtimeLabel: "Peet's Mac", workspaceId: 'partners',
        orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners',
        sourceOfTruth: 'vps', shareMode: 'private', ownerUserId: 'client-1', projectId: 'website',
        companyId: null, contactIds: [],
      },
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(409)
    expect((await readJson(response)).error).toBe('Project is not linked to this computer')
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockTouchConversation).not.toHaveBeenCalled()
  })

  it('rejects revoked project access before storing the user message', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', scope: 'project', scopeRefId: 'website',
      participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client' }, { kind: 'agent', agentId: 'pip', name: 'Pip' }],
      workspaceContext: {
        runtimeTarget: 'vps', runtimeLabel: 'Partners VPS', workspaceId: 'partners', orgId: 'pib-platform-owner',
        orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps',
        shareMode: 'org', ownerUserId: 'client-1', projectId: 'website', folderScope: 'project',
        companyId: null, contactIds: [],
      },
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockAuthorizeWorkspaceRuntime).not.toHaveBeenCalled()
  })

  it('rejects project message history after project access is revoked', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1', orgId: 'pib-platform-owner', scope: 'project', scopeRefId: 'website',
      participantUids: ['client-1'], participantAgentIds: ['pip'],
      participants: [{ kind: 'user', uid: 'client-1', role: 'client' }],
      workspaceContext: {
        runtimeTarget: 'vps', runtimeLabel: 'Partners VPS', workspaceId: 'partners', orgId: 'pib-platform-owner',
        orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps',
        shareMode: 'private', ownerUserId: 'client-1', projectId: 'website', folderScope: 'project',
        companyId: null, contactIds: [],
      },
    })

    const { GET } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/messages'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockListMessages).not.toHaveBeenCalled()
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

  it('still dispatches Hermes when hermes_features enrichment throws (collection / durable-store faults)', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockSetSkillCatalog.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'collection')"),
    )
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
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })
    const body = await readJson(res)

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    expect(body.data?.assistantMessage?.status).not.toBe('failed')
    expect(String(body.data?.assistantMessage?.error || '')).not.toMatch(/collection/)
    expect(errorSpy).toHaveBeenCalledWith(
      '[conversation-hermes-features-enrichment-failed]',
      expect.objectContaining({ convId: 'conv-1', agentId: 'pip' }),
    )
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

  it('fails closed when authorization and dispatch resolve the same target id to different hosts', async () => {
    // Host-identity binding is under test, not Team grants — use platform admin.
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner' }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockAuthorizeWorkspaceRuntime.mockResolvedValue({
      kind: 'execution-location',
      locationId: 'partners-vps',
      runtimeTargetId: 'vps',
      machineLabel: 'Partners VPS',
      locationKind: 'vps',
      organizationAccessible: true,
      transportIdentity: 'pip-host-identity',
    })
    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'pib-platform-owner',
      profile: 'maya',
      baseUrl: 'https://maya-host.example.com',
      apiKey: 'secret',
      enabled: true,
      runtimeTargetId: 'vps',
      transportIdentity: 'maya-host-identity',
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['admin-1'],
      participantAgentIds: ['maya'],
      participants: [
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
        { kind: 'agent', agentId: 'maya', name: 'Maya' },
      ],
      workspaceContext: {
        runtimeTarget: 'vps', runtimeLabel: 'Partners VPS', workspaceId: 'partners',
        orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners',
        vpsPath: '/srv/partners', localPath: '/Users/partners', sourceOfTruth: 'vps',
        shareMode: 'private', ownerUserId: 'admin-1', companyId: null, contactIds: [],
      },
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(201)
    expect(mockAuthorizeWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      runtimeTargetId: 'vps',
      agentId: 'maya',
    }))
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      runtimeDispatchFailureCode: 'runtime_target_binding_mismatch',
      error: 'The selected computer changed before the agent could start. Pick Partners VPS again and retry.',
    }))
    expect(JSON.stringify(await readJson(response))).not.toContain('maya-host.example.com')
    errorSpy.mockRestore()
  })

  it('allows Theo VPS dispatch when authorization and agent link share one physical host identity', async () => {
    // Host-identity binding is under test, not Team grants — use platform admin.
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner' }
    const physicalIdentity = 'shared-partners-vps-identity'
    mockAuthorizeWorkspaceRuntime.mockResolvedValue({
      kind: 'execution-location',
      locationId: 'partners-vps',
      runtimeTargetId: 'vps',
      machineLabel: 'Partners VPS',
      locationKind: 'vps',
      organizationAccessible: true,
      transportIdentity: physicalIdentity,
    })
    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'pib-platform-owner',
      profile: 'theo',
      baseUrl: 'https://hermes.example/profiles/theo',
      apiKey: 'secret',
      enabled: true,
      runtimeTargetId: 'vps',
      transportIdentity: physicalIdentity,
      capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['admin-1'],
      participantAgentIds: ['theo'],
      participants: [
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
        { kind: 'agent', agentId: 'theo', name: 'Theo' },
      ],
      workspaceContext: {
        runtimeTarget: 'vps', runtimeLabel: 'Partners VPS', workspaceId: 'partners',
        orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz', agentDomain: 'partners',
        vpsPath: '/srv/partners', localPath: '/Users/partners', sourceOfTruth: 'vps',
        shareMode: 'private', ownerUserId: 'admin-1', companyId: null, contactIds: [],
      },
    })

    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const response = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalled()
    expect(mockGetAgentDispatchHermesProfileLink).toHaveBeenCalledWith('theo', 'pib-platform-owner', expect.objectContaining({
      runtimeTarget: 'vps',
    }))
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
      error: 'Agent dispatch could not reach the selected computer. Retry or pick another runtime.',
    }))
    const body = await readJson(res)
    expect(body.data.assistantMessage.status).toBe('failed')
  })

  it('dispatches a /compress run on the selected agent and plans durable compression', async () => {
    const now = Date.now()
    const mk = (id: number, role: 'user' | 'assistant', content: string) => ({
      id: `m${id}`,
      conversationId: 'conv-1',
      role,
      content,
      authorKind: role === 'user' ? 'user' : 'agent',
      authorId: role === 'user' ? 'client-1' : 'pip',
      authorDisplayName: role === 'user' ? 'Client User' : 'Pip',
      status: 'completed',
      createdAt: { toMillis: () => now + id },
    })
    const messages = [
      mk(1, 'user', 'old request one'),
      mk(2, 'assistant', 'old reply one'),
      mk(3, 'user', 'old request two'),
      mk(4, 'assistant', 'old reply two'),
      mk(5, 'user', 'recent request'),
      mk(6, 'assistant', 'recent reply'),
    ]
    mockListMessages.mockResolvedValue(messages)
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      startedBy: 'client-1',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      contextCompression: null,
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: '',
        slashCommand: {
          id: 'compress',
          token: '/compress',
          label: 'Compress context',
          executorKind: 'hermes_features',
          args: 'here 2',
        },
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Context compression task]')
    expect(prompt).toContain('[Conversation context to compress')
    // Older exchanges are the summary input; the latest 2 exchanges stay intact.
    expect(prompt).toContain('old request one')
    expect(prompt).toContain('old reply one')
    expect(prompt).not.toContain('old request two')
    expect(prompt).not.toContain('recent request')
    expect(prompt).toContain('id: compress')

    const assistantCall = mockCreateMessage.mock.calls.find(
      (call) => call[1]?.role === 'assistant',
    )
    expect(assistantCall?.[1]?.contextCompressionPlan).toEqual({
      keepTurns: 2,
      compressedThroughMessageId: 'm2',
    })
  })

  it('completes /context synchronously without dispatching a Hermes run', async () => {
    mockListMessages.mockResolvedValue([
      {
        id: 'm1', conversationId: 'conv-1', role: 'user', content: 'hi', authorKind: 'user',
        authorId: 'client-1', authorDisplayName: 'Client User', status: 'completed',
        createdAt: { toMillis: () => 1 },
      },
      {
        id: 'm2', conversationId: 'conv-1', role: 'assistant', content: 'hello', authorKind: 'agent',
        authorId: 'pip', authorDisplayName: 'Pip', status: 'completed',
        createdAt: { toMillis: () => 2 },
      },
    ])
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      startedBy: 'client-1',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      contextCompression: null,
      model: 'deepseek/deepseek-v4-flash',
      provider: 'deepseek',
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: '',
        slashCommand: {
          id: 'context',
          token: '/context',
          label: 'Context usage',
          executorKind: 'hermes_features',
          args: '',
        },
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    const body = await readJson(res)
    expect(body.data.assistantMessage.content).toContain('**Context usage — this conversation**')
    expect(body.data.assistantMessage.content).toContain('Exchanges: 1')
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
    expect(mockRequireReadyLlmCredentialBinding).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 'binding-test',
      connectionId: 'org:pib-platform-owner:openai-api',
      agentId: 'pip',
    }))
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

  it('allows client-selected model overrides when the model is available', async () => {
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

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledWith(
      expect.any(Object),
      'client-1',
      expect.objectContaining({
        model: 'openai/gpt-5.5',
        provider: 'openai',
      }),
    )
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
