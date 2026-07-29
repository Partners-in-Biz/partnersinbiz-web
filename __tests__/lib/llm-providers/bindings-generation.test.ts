/**
 * @jest-environment node
 */

const mockBindingGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: (...args: unknown[]) => mockBindingGet(...args) }),
    }),
  },
}))

import { requireMatchingLlmCredentialBindingGeneration } from '@/lib/llm-providers/bindings'

const expected = {
  bindingId: 'binding-1',
  connectionId: 'org:org-1:xai-oauth',
  credentialVersion: 2,
  deviceId: 'device-1',
  ownerUid: null,
  orgId: 'org-1',
  scope: 'org' as const,
  agentId: 'pip',
}

describe('credential receipt generation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBindingGet.mockResolvedValue({
      exists: true,
      id: 'binding-1',
      data: () => ({
        id: 'binding-1',
        connectionId: expected.connectionId,
        credentialVersion: 2,
        deviceId: 'device-1',
        ownerUid: null,
        orgId: 'org-1',
        scope: 'org',
        agentId: 'pip',
        status: 'ready',
      }),
    })
  })

  it('accepts the exact generation even after its status has advanced', async () => {
    await expect(requireMatchingLlmCredentialBindingGeneration(expected))
      .resolves.toEqual(expect.objectContaining({ credentialVersion: 2, status: 'ready' }))
  })

  it('rejects an old revoke receipt after a newer re-auth generation exists', async () => {
    await expect(requireMatchingLlmCredentialBindingGeneration({
      ...expected,
      credentialVersion: 1,
    })).rejects.toThrow(/generation does not match/)
  })
})
