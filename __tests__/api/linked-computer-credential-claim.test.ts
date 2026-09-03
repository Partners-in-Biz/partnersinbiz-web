/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const mockGetConnection = jest.fn()
const mockGetCredentials = jest.fn()
const mockRequireBinding = jest.fn()
const mockDeviceGet = jest.fn()
const mockCompleteJob = jest.fn()
const mockApplyJobResult = jest.fn()

jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: (...args: unknown[]) => mockGetConnection(...args),
  getDecryptedLlmCredentials: (...args: unknown[]) => mockGetCredentials(...args),
}))
jest.mock('@/lib/llm-providers/bindings', () => ({
  connectionCredentialVersion: (connection: { credentialVersion?: number }) => connection.credentialVersion || 1,
  requireDeliverableLlmCredentialBinding: (...args: unknown[]) => mockRequireBinding(...args),
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: (...args: unknown[]) => mockDeviceGet(...args) }),
    }),
  },
}))
jest.mock('@/lib/linked-computers/agent-job-store', () => ({
  claimOldestAgentHostJob: jest.fn(),
  completeAgentHostJob: (...args: unknown[]) => mockCompleteJob(...args),
}))
jest.mock('@/lib/linked-computers/agent-host-service', () => ({
  applyAgentHostJobResult: (...args: unknown[]) => mockApplyJobResult(...args),
}))

import { handleAgentHostClaim } from '@/app/api/v1/linked-computers/[deviceId]/agents/claim/route'

function request() {
  return new NextRequest('http://localhost/api/v1/linked-computers/device-1/agents/claim', {
    method: 'POST',
    body: JSON.stringify({ agentHostProtocolVersion: 3 }),
  })
}

function claimedJob() {
  return {
    jobId: 'job-1',
    kind: 'sync-credential' as const,
    status: 'claimed' as const,
    agentId: 'sales' as const,
    policyVersion: null,
    keepInSync: false,
    runtimeSkills: [],
    pibSkills: [],
    vpsExternalDir: null,
    preferredPort: 8773,
    protocolVersion: 3,
    credentialDelivery: {
      bindingId: 'binding-1',
      connectionId: 'user:u1:xai',
      credentialVersion: 2,
      provider: 'xai',
      hermesProvider: 'xai',
      envVar: 'XAI_API_KEY',
      canaryModel: 'grok-build-0.1',
    },
    leaseToken: 'lease-1',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  }
}

describe('linked computer LLM credential claims', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      scope: 'user',
      ownerUid: 'u1',
      orgId: 'org-1',
      status: 'connected',
      credentialVersion: 2,
    })
    mockGetCredentials.mockResolvedValue({ apiKey: 'secret-value' })
    mockRequireBinding.mockResolvedValue({ id: 'binding-1' })
    mockCompleteJob.mockImplementation(async (input: { jobId: string }) => ({
      ...claimedJob(),
      jobId: input.jobId,
      status: 'failed',
    }))
    mockApplyJobResult.mockResolvedValue(undefined)
    mockDeviceGet.mockResolvedValue({
      exists: true,
      data: () => ({
        ownerType: 'user',
        ownerUserId: 'u1',
        status: 'active',
      }),
    })
  })

  it('reveals secrets only after the authenticated owner and exact binding pass', async () => {
    const response = await handleAgentHostClaim(
      request(),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      async () => claimedJob(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.credentialDelivery.credentials).toEqual({ apiKey: 'secret-value' })
    expect(mockRequireBinding).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 'binding-1',
      deviceId: 'device-1',
      agentId: 'sales',
      ownerUid: 'u1',
    }))
  })

  it('does not reveal a personal secret to a different device owner', async () => {
    mockDeviceGet.mockResolvedValue({
      exists: true,
      data: () => ({ ownerType: 'user', ownerUserId: 'attacker', status: 'active' }),
    })
    const response = await handleAgentHostClaim(
      request(),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'attacker', credentialVersion: 7 }) as never,
      async () => claimedJob(),
    )
    expect(response.status).toBe(403)
    expect(mockGetCredentials).not.toHaveBeenCalled()
  })

  it('never delivers the rotating xAI refresh token to a linked machine', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai-oauth',
      provider: 'xai-oauth',
      scope: 'user',
      ownerUid: 'u1',
      orgId: 'org-1',
      status: 'connected',
      credentialVersion: 2,
    })
    mockGetCredentials.mockResolvedValue({
      access_token: 'short-lived-access',
      refresh_token: 'single-use-refresh',
    })
    const response = await handleAgentHostClaim(
      request(),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      async () => claimedJob(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.credentialDelivery.credentials).toEqual({
      access_token: 'short-lived-access',
      refresh_token: '',
    })
    expect(JSON.stringify(body)).not.toContain('single-use-refresh')
  })

  it('drains a superseded credential generation instead of blocking newer jobs', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      provider: 'xai',
      scope: 'user',
      ownerUid: 'u1',
      orgId: 'org-1',
      status: 'connected',
      credentialVersion: 3,
    })
    const claim = jest.fn()
      .mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce(null)
    const response = await handleAgentHostClaim(
      request(),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      claim,
    )
    expect(response.status).toBe(204)
    expect(mockCompleteJob).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-1',
      jobId: 'job-1',
      leaseToken: 'lease-1',
      ok: false,
      error: 'Superseded by a newer credential generation',
    }))
    expect(mockApplyJobResult).toHaveBeenCalled()
    expect(mockGetCredentials).not.toHaveBeenCalled()
  })

  it('accepts protocol 3 or 4 and hides managedProfile jobs from v3 runtimes', async () => {
    const managedJob = {
      ...claimedJob(),
      kind: 'install' as const,
      agentId: 'partners--pip',
      catalogAgentId: 'pip',
      managedProfile: {
        orgId: 'org-1',
        orgSlug: 'partners',
        agentId: 'pip',
        profile: 'partners--pip',
      },
      credentialDelivery: undefined,
    }
    const claim = jest.fn()
      .mockResolvedValueOnce(managedJob)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(managedJob)

    const v3 = await handleAgentHostClaim(
      new NextRequest('http://localhost/api/v1/linked-computers/device-1/agents/claim', {
        method: 'POST',
        body: JSON.stringify({ agentHostProtocolVersion: 3 }),
      }),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      claim,
    )
    expect(v3.status).toBe(204)
    expect(mockCompleteJob).not.toHaveBeenCalled()

    const v4 = await handleAgentHostClaim(
      new NextRequest('http://localhost/api/v1/linked-computers/device-1/agents/claim', {
        method: 'POST',
        body: JSON.stringify({ agentHostProtocolVersion: 4 }),
      }),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      claim,
    )
    expect(v4.status).toBe(200)
    expect(await v4.json()).toEqual({ success: true, data: managedJob })

    const rejected = await handleAgentHostClaim(
      new NextRequest('http://localhost/api/v1/linked-computers/device-1/agents/claim', {
        method: 'POST',
        body: JSON.stringify({ agentHostProtocolVersion: 2 }),
      }),
      'device-1',
      async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
      claim,
    )
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({
      error: 'Agent host protocol version 3 or 4 required. Update the linked computer runtime.',
    })
  })

  it('cancels credential jobs when an existing org grant is not active', async () => {
    const pausedGrant = {
      exists: true,
      data: () => ({ status: 'paused' }),
    }
    const { adminDb } = jest.requireMock('@/lib/firebase/admin') as {
      adminDb: { collection: (name: string) => { doc: () => { get: () => Promise<unknown> } } }
    }
    const original = adminDb.collection
    adminDb.collection = (name: string) => ({
      doc: () => ({
        get: () => name === 'linked_device_grants' ? Promise.resolve(pausedGrant) : mockDeviceGet(),
      }),
    })
    try {
      const response = await handleAgentHostClaim(
        request(),
        'device-1',
        async () => ({ deviceId: 'device-1', ownerUserId: 'u1', credentialVersion: 7 }) as never,
        async () => ({ ...claimedJob(), orgId: 'org-1' }),
      )
      expect(response.status).toBe(204)
      expect(mockCompleteJob).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: 'device grant not active',
      }))
      expect(mockGetCredentials).not.toHaveBeenCalled()
    } finally {
      adminDb.collection = original
    }
  })
})
