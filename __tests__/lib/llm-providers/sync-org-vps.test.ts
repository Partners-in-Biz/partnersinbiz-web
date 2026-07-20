/**
 * @jest-environment node
 */
import type { ApiUser } from '@/lib/api/types'

const mockGet = jest.fn()
const mockGetConnection = jest.fn()
const mockGetCredentials = jest.fn()
const mockResolveTargets = jest.fn()
const mockMarkSynced = jest.fn()
const mockMarkError = jest.fn()
const mockCallHermesJson = jest.fn()
const mockCallAgentPath = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: (...args: unknown[]) => mockGet(...args) }),
    }),
  },
}))

jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: (...args: unknown[]) => mockGetConnection(...args),
  getDecryptedLlmCredentials: (...args: unknown[]) => mockGetCredentials(...args),
  markLlmConnectionSynced: (...args: unknown[]) => mockMarkSynced(...args),
  markLlmConnectionError: (...args: unknown[]) => mockMarkError(...args),
}))

jest.mock('@/lib/llm-providers/sync-targets', () => ({
  resolveOrgLlmSyncTargets: (...args: unknown[]) => mockResolveTargets(...args),
}))

jest.mock('@/lib/hermes/server', () => ({
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: (...args: unknown[]) => mockCallAgentPath(...args),
}))

import { canWriteOrgLlmConnection } from '@/lib/llm-providers/org-guard'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'

describe('org VPS vs personal credential sync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('never pushes user-scoped credentials to Hermes/VPS', async () => {
    mockGetConnection.mockResolvedValue({
      id: 'user:u1:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      scope: 'user',
      orgId: 'acme',
      status: 'connected',
      authKind: 'api_key',
    })

    const result = await syncLlmConnectionToHermes('user:u1:xai')

    expect(result.skippedReason).toBe('user_scope_local_only')
    expect(result.synced).toEqual([])
    expect(mockGetCredentials).not.toHaveBeenCalled()
    expect(mockResolveTargets).not.toHaveBeenCalled()
    expect(mockCallHermesJson).not.toHaveBeenCalled()
    expect(mockCallAgentPath).not.toHaveBeenCalled()
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
    mockResolveTargets.mockResolvedValue({
      targets: [{
        kind: 'org_hermes_link',
        agentId: 'pip',
        label: 'Organisation Hermes · pip',
        hermesLink: { orgId: 'acme', profile: 'pip', baseUrl: 'https://vps.example', apiKey: 'k', enabled: true },
      }],
      orgVpsDeviceCount: 0,
      hasHermesProfileLink: true,
    })
    mockCallHermesJson.mockResolvedValue({ response: { ok: true, status: 200 }, data: {} })
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

  it('returns no_org_vps_target when the organisation has no VPS', async () => {
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
    mockResolveTargets.mockResolvedValue({
      targets: [],
      orgVpsDeviceCount: 0,
      hasHermesProfileLink: false,
      reasonIfEmpty: 'No organisation VPS is linked yet.',
    })
    mockMarkError.mockResolvedValue(undefined)

    const result = await syncLlmConnectionToHermes('org:acme:xai')

    expect(result.skippedReason).toBe('no_org_vps_target')
    expect(mockCallHermesJson).not.toHaveBeenCalled()
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })
})

describe('canWriteOrgLlmConnection', () => {
  it('allows platform admin and org owner/admin only', async () => {
    expect(await canWriteOrgLlmConnection({ role: 'admin', uid: 'a' } as ApiUser, 'acme')).toBe(true)
    expect(await canWriteOrgLlmConnection({ role: 'ai', uid: 'a' } as ApiUser, 'acme')).toBe(true)

    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'owner', status: 'active' }) })
    expect(await canWriteOrgLlmConnection({ role: 'client', uid: 'u1' } as ApiUser, 'acme')).toBe(true)

    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', status: 'active' }) })
    expect(await canWriteOrgLlmConnection({ role: 'client', uid: 'u1' } as ApiUser, 'acme')).toBe(true)

    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'member', status: 'active' }) })
    expect(await canWriteOrgLlmConnection({ role: 'client', uid: 'u1' } as ApiUser, 'acme')).toBe(false)

    mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
    expect(await canWriteOrgLlmConnection({ role: 'client', uid: 'u1' } as ApiUser, 'acme')).toBe(false)
  })
})
