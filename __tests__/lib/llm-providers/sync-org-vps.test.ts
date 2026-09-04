/**
 * @jest-environment node
 */

const mockGetConnection = jest.fn()
const mockGetCredentials = jest.fn()
const mockResolveOrgTargets = jest.fn()
const mockResolveUserTargets = jest.fn()
const mockMarkSynced = jest.fn()
const mockMarkQueued = jest.fn()
const mockMarkError = jest.fn()
const mockCallHermesJson = jest.fn()
const mockCallAgentPath = jest.fn()
const mockListConnections = jest.fn()
const mockOrgMemberGet = jest.fn()
const mockPutBinding = jest.fn()
const mockUpdateBinding = jest.fn()
const mockEnqueueDelivery = jest.fn()
const mockXaiCredentialsNeedRefresh = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'orgMembers') {
        return {
          doc: () => ({ get: (...args: unknown[]) => mockOrgMemberGet(...args) }),
        }
      }
      return {
        doc: () => ({ get: jest.fn() }),
      }
    },
  },
}))

jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: (...args: unknown[]) => mockGetConnection(...args),
  getDecryptedLlmCredentials: (...args: unknown[]) => mockGetCredentials(...args),
  markLlmConnectionSynced: (...args: unknown[]) => mockMarkSynced(...args),
  markLlmConnectionSyncQueued: (...args: unknown[]) => mockMarkQueued(...args),
  markLlmConnectionSyncWarning: (...args: unknown[]) => mockMarkError(...args),
  listLlmProviderConnections: (...args: unknown[]) => mockListConnections(...args),
}))

const mockResolveShareTargets = jest.fn()

jest.mock('@/lib/llm-providers/sync-targets', () => ({
  resolveOrgLlmSyncTargets: (...args: unknown[]) => mockResolveOrgTargets(...args),
  resolveUserLlmSyncTargets: (...args: unknown[]) => mockResolveUserTargets(...args),
  resolveOrgShareLinkedComputerTargets: (...args: unknown[]) => mockResolveShareTargets(...args),
}))

jest.mock('@/lib/hermes/server', () => ({
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: (...args: unknown[]) => mockCallAgentPath(...args),
}))
jest.mock('@/lib/llm-providers/bindings', () => ({
  putDesiredLlmCredentialBinding: (...args: unknown[]) => mockPutBinding(...args),
  updateLlmCredentialBinding: (...args: unknown[]) => mockUpdateBinding(...args),
}))
jest.mock('@/lib/llm-providers/linked-delivery', () => ({
  enqueueCredentialDelivery: (...args: unknown[]) => mockEnqueueDelivery(...args),
  enqueuePersonalCredentialDelivery: (...args: unknown[]) => mockEnqueueDelivery(...args),
}))
jest.mock('@/lib/llm-providers/refresh', () => ({
  ensureFreshLlmProviderConnection: async (connection: unknown) => connection,
  xaiCredentialsNeedRefresh: (...args: unknown[]) => mockXaiCredentialsNeedRefresh(...args),
}))

import { ensureFreshXaiCredentialForDispatch, syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'

function mockAgentPathWithEnvVerify() {
  mockCallAgentPath.mockImplementation(async (_agentId: unknown, path: unknown, init?: { method?: string }) => {
    if (path === '/v1/responses') {
      return { response: { ok: true, status: 200 }, data: { output_text: 'PIB_CREDENTIAL_OK' } }
    }
    if (path === '/v1/models') {
      return { response: { ok: true, status: 200 }, data: { data: [{ id: 'grok-build-0.1' }] } }
    }
    if (path === '/admin/env' && (!init?.method || init.method === 'GET')) {
      return {
        response: { ok: true, status: 200 },
        data: { env: { XAI_API_KEY: { is_set: true } } },
      }
    }
    if (path === '/admin/auth/providers' && (!init?.method || init.method === 'GET')) {
      return {
        response: { ok: true, status: 200 },
        data: {
          providers: {
            'xai-oauth': {
              configured: true,
              has_access_token: true,
              has_refresh_token: true,
              hermes_shape: true,
              usable: true,
            },
            'openai-codex': {
              configured: true,
              has_access_token: true,
              has_refresh_token: true,
              hermes_shape: true,
              usable: true,
            },
          },
        },
      }
    }
    return { response: { ok: true, status: 200 }, data: {} }
  })
  mockCallHermesJson.mockImplementation(async (_link: unknown, path: unknown, init?: { method?: string }) => {
    if (path === '/v1/responses') {
      return { response: { ok: true, status: 200 }, data: { output_text: 'PIB_CREDENTIAL_OK' } }
    }
    if (path === '/v1/models') {
      return { response: { ok: true, status: 200 }, data: { data: [{ id: 'grok-build-0.1' }] } }
    }
    if (path === '/admin/env' && (!init?.method || init.method === 'GET')) {
      return {
        response: { ok: true, status: 200 },
        data: { env: { XAI_API_KEY: { is_set: true } } },
      }
    }
    if (path === '/admin/auth/providers' && (!init?.method || init.method === 'GET')) {
      return {
        response: { ok: true, status: 200 },
        data: {
          providers: {
            'xai-oauth': {
              configured: true,
              has_access_token: true,
              has_refresh_token: true,
              hermes_shape: true,
              usable: true,
            },
          },
        },
      }
    }
    return { response: { ok: true, status: 200 }, data: {} }
  })
}

describe('org VPS vs personal credential sync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'member', accessPolicy: { allowPersonalLlmOnOrgVps: false } }),
    })
    mockListConnections.mockResolvedValue([])
    mockPutBinding.mockResolvedValue({ id: 'binding-1' })
    mockUpdateBinding.mockResolvedValue(undefined)
    mockEnqueueDelivery.mockResolvedValue({ jobId: 'job-1' })
    mockMarkQueued.mockResolvedValue(undefined)
    mockXaiCredentialsNeedRefresh.mockReturnValue(false)
    mockResolveShareTargets.mockResolvedValue({ targets: [], memberCount: 0 })
    mockAgentPathWithEnvVerify()
  })

  it('syncs user-scoped credentials to the member linked computers', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'user',
      orgId: 'acme',
      ownerUid: 'u1',
      status: 'connected',
      authKind: 'api_key',
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'xai-secret' })
    mockResolveUserTargets.mockResolvedValue({
      targets: [{
        kind: 'user_linked_computer',
        agentId: 'pip',
        runtimeTargetId: 'mac-1',
        deviceId: 'device-mac',
        label: 'Peet Mac · pip',
      }],
      linkedComputerCount: 1,
      includedOrgVps: false,
    })
    mockMarkSynced.mockResolvedValue(undefined)

    const result = await syncLlmConnectionToHermes('user:u1:xai')

    expect(result.synced).toEqual([])
    expect(result.queued).toEqual([{ agentId: 'pip', bindingId: 'binding-1', jobId: 'job-1' }])
    expect(result.failed).toEqual([])
    expect(mockResolveUserTargets).toHaveBeenCalled()
    expect(mockResolveUserTargets).toHaveBeenCalledWith(expect.objectContaining({ includeOrgVps: false }))
    expect(mockCallAgentPath).not.toHaveBeenCalled()
    expect(mockEnqueueDelivery).toHaveBeenCalled()
    expect(mockMarkQueued).toHaveBeenCalledWith('user:u1:xai')
  })

  it('fails verification when Hermes OAuth tokens are not in native shape', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'org:acme:xai-oauth',
      provider: 'xai-oauth',
      hermesProvider: 'xai-oauth',
      scope: 'org',
      orgId: 'acme',
      ownerUid: null,
      status: 'connected',
      authKind: 'oauth_token',
    })
    mockGetCredentials.mockResolvedValue({
      access_token: 'at-1',
      refresh_token: 'rt-1',
    })
    mockResolveOrgTargets.mockResolvedValue({
      targets: [{
        kind: 'org_hermes_link',
        agentId: 'pip',
        label: 'Org VPS · pip',
        hermesLink: { orgId: 'acme', profile: 'pip', baseUrl: 'https://vps.example', apiKey: 'k', enabled: true },
      }],
      orgVpsDeviceCount: 1,
      hasHermesProfileLink: false,
    })
    mockCallHermesJson.mockImplementation(async (_link: unknown, path: unknown, init?: { method?: string }) => {
      if (String(path).startsWith('/admin/auth/providers/') && init?.method === 'PUT') {
        return { response: { ok: true, status: 200 }, data: { updated: true } }
      }
      if (path === '/admin/auth/providers') {
        return {
          response: { ok: true, status: 200 },
          // Old broken flat shape — Hermes cannot use this
          data: {
            providers: {
              'xai-oauth': {
                configured: true,
                has_access_token: true,
                has_refresh_token: true,
              },
            },
          },
        }
      }
      return { response: { ok: true, status: 200 }, data: {} }
    })

    const result = await syncLlmConnectionToHermes('org:acme:xai-oauth')

    expect(result.synced).toEqual([])
    expect(result.failed[0]?.error).toMatch(/outdated|unusable|Hermes/i)
    expect(mockMarkError).toHaveBeenCalled()
  })

  it('never enables org VPS targets for personal credentials even when legacy Team access allows it', async () => {
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: { allowPersonalLlmOnOrgVps: true, modules: {}, recordScopes: {}, agentRuntimeAccess: {}, preset: 'custom' },
      }),
    })
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'user',
      orgId: 'acme',
      ownerUid: 'u1',
      status: 'connected',
      authKind: 'api_key',
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'xai-secret' })
    mockResolveUserTargets.mockResolvedValue({
      targets: [{
        kind: 'user_linked_computer',
        agentId: 'pip',
        runtimeTargetId: 'mac-1',
        deviceId: 'device-mac',
        label: 'Peet Mac · pip',
      }],
      linkedComputerCount: 1,
      includedOrgVps: true,
    })
    mockMarkSynced.mockResolvedValue(undefined)

    const result = await syncLlmConnectionToHermes('user:u1:xai')

    expect(result.synced).toEqual([])
    expect(result.queued).toHaveLength(1)
    expect(result.includedOrgVps).toBe(false)
    expect(mockResolveUserTargets).toHaveBeenCalledWith(expect.objectContaining({
      includeOrgVps: false,
    }))
  })

  it('keeps personal delivery off the org VPS regardless of organisation provider coverage', async () => {
    mockOrgMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: { allowPersonalLlmOnOrgVps: true, modules: {}, recordScopes: {}, agentRuntimeAccess: {}, preset: 'custom' },
      }),
    })
    mockListConnections.mockResolvedValue([{
      id: 'org:acme:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'org',
      status: 'connected',
      hasCredentials: true,
    }])
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'user',
      orgId: 'acme',
      ownerUid: 'u1',
      status: 'connected',
      authKind: 'api_key',
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'xai-secret' })
    mockResolveUserTargets.mockResolvedValue({
      targets: [{
        kind: 'user_linked_computer',
        agentId: 'pip',
        runtimeTargetId: 'mac-1',
        deviceId: 'device-mac',
        label: 'Peet Mac · pip',
      }],
      linkedComputerCount: 1,
      includedOrgVps: false,
    })
    mockMarkSynced.mockResolvedValue(undefined)

    const result = await syncLlmConnectionToHermes('user:u1:xai')

    expect(result.skippedVpsBecauseOrgProvider).toBe(false)
    expect(mockResolveUserTargets).toHaveBeenCalledWith(expect.objectContaining({
      includeOrgVps: false,
    }))
    expect(result.message).toMatch(/never copied to the shared organisation VPS/i)
  })

  it('syncs org-scoped credentials only to resolved org VPS targets', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'org:acme:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'org',
      orgId: 'acme',
      status: 'connected',
      authKind: 'api_key',
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'xai-secret' })
    mockResolveOrgTargets.mockResolvedValue({
      targets: [{
        kind: 'org_hermes_link',
        agentId: 'pip',
        label: 'Organisation Hermes · pip',
        hermesLink: { orgId: 'acme', profile: 'pip', baseUrl: 'https://vps.example', apiKey: 'k', enabled: true },
      }],
      orgVpsDeviceCount: 0,
      hasHermesProfileLink: true,
    })
    mockMarkSynced.mockResolvedValue(undefined)

    const result = await syncLlmConnectionToHermes('org:acme:xai')

    expect(result.synced).toEqual(['pip'])
    expect(result.failed).toEqual([])
    expect(mockCallHermesJson).toHaveBeenCalledWith(
      expect.anything(),
      '/admin/env',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(mockMarkSynced).toHaveBeenCalledWith('org:acme:xai', ['pip'])
  })

  it('returns no_sync_target when the organisation has no VPS', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'org:acme:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'org',
      orgId: 'acme',
      status: 'connected',
      authKind: 'api_key',
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'xai-secret' })
    mockResolveOrgTargets.mockResolvedValue({
      targets: [],
      orgVpsDeviceCount: 0,
      hasHermesProfileLink: false,
      reasonIfEmpty: 'No organisation VPS is linked yet.',
    })

    const result = await syncLlmConnectionToHermes('org:acme:xai')

    expect(result.skippedReason).toBe('no_sync_target')
    expect(result.synced).toEqual([])
    expect(mockMarkError).toHaveBeenCalled()
  })

  it('refreshes and verifies a due xAI account on the selected profile before dispatch', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'org:acme:xai-oauth',
      provider: 'xai-oauth',
      hermesProvider: 'xai-oauth',
      scope: 'org',
      orgId: 'acme',
      ownerUid: null,
      status: 'connected',
      authKind: 'oauth_token',
    })
    mockGetCredentials.mockResolvedValue({ access_token: 'at-1', refresh_token: 'rt-1' })
    mockXaiCredentialsNeedRefresh.mockReturnValue(true)
    mockResolveOrgTargets.mockResolvedValue({
      targets: [{
        kind: 'org_hermes_link',
        agentId: 'pip',
        label: 'Organisation Hermes · pip',
        hermesLink: { orgId: 'acme', profile: 'pip', baseUrl: 'https://vps.example', apiKey: 'k', enabled: true },
      }],
      orgVpsDeviceCount: 0,
      hasHermesProfileLink: true,
    })
    mockMarkSynced.mockResolvedValue(undefined)

    await expect(ensureFreshXaiCredentialForDispatch({
      connectionId: 'org:acme:xai-oauth',
      agentId: 'pip',
    })).resolves.toEqual({ refreshed: true })

    expect(mockResolveOrgTargets).toHaveBeenCalledWith('acme', ['pip'])
    expect(mockCallHermesJson).toHaveBeenCalledWith(
      expect.anything(),
      '/admin/auth/providers/xai-oauth',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
