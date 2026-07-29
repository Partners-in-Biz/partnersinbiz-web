/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const mockGetConnection = jest.fn()
const mockGetCredentials = jest.fn()
const mockRequireBinding = jest.fn()
const mockDeviceGet = jest.fn()

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
})
