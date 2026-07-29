const mockCollection = jest.fn()

jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: { collection: mockCollection },
}))

import {
  resolveWatcherLlmRoute,
  resolveWatcherRuntimePreference,
} from '../../../services/agent-watcher/src/llm-routing'

function queryDocs(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    where: jest.fn(() => ({
      get: jest.fn(async () => ({
        docs: rows.map((row) => ({ id: row.id, data: () => row.data })),
      })),
    })),
  }
}

describe('agent watcher machine/account routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes a chat-origin task to the owner Mac and exact ready personal binding', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'linked_devices') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                status: 'active',
                ownerType: 'user',
                ownerUserId: 'user-1',
                runtimeTargetId: 'linked-device:mac-1',
                availableAgentIds: ['theo'],
              }),
            }),
          }),
        }
      }
      if (name === 'llm_credential_bindings') {
        return queryDocs([{
          id: 'binding-personal-xai',
          data: {
            connectionId: 'user:user-1:xai-oauth',
            runtimeTargetId: 'linked-device:mac-1',
            deviceId: 'mac-1',
            orgId: 'org-1',
            ownerUid: 'user-1',
            scope: 'user',
            agentId: 'theo',
            provider: 'xai-oauth',
            hermesProvider: 'xai-oauth',
            status: 'ready',
            liveAuthVerified: true,
            credentialVersion: 1,
          },
        }])
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    await expect(resolveWatcherLlmRoute({
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      provider: 'xai-oauth',
      connectionId: 'user:user-1:xai-oauth',
      runtimeTargetId: 'linked-device:mac-1',
    })).resolves.toEqual({
      provider: 'xai-oauth',
      connectionId: 'user:user-1:xai-oauth',
      credentialBindingId: 'binding-personal-xai',
      resolvedSource: 'personal',
      runtimeTargetId: 'linked-device:mac-1',
    })
  })

  it('fails closed when the selected machine/profile has no live binding', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'linked_devices') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                status: 'active',
                ownerType: 'user',
                ownerUserId: 'user-1',
                runtimeTargetId: 'linked-device:mac-1',
                availableAgentIds: ['theo'],
              }),
            }),
          }),
        }
      }
      if (name === 'llm_credential_bindings') return queryDocs([])
      throw new Error(`Unexpected collection ${name}`)
    })

    await expect(resolveWatcherLlmRoute({
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      provider: 'xai-oauth',
      runtimeTargetId: 'linked-device:mac-1',
    })).rejects.toThrow(/not live-ready.*automatic credential sync/i)
  })

  it('maps linked device ownership to the matching watcher endpoint', async () => {
    mockCollection.mockImplementation(() => ({
      doc: (deviceId: string) => ({
        get: async () => ({
          exists: true,
          data: () => deviceId === 'vps-1'
            ? {
                status: 'active',
                ownerType: 'organization',
                ownerOrgId: 'org-1',
                availableAgentIds: ['theo'],
              }
            : {
                status: 'active',
                ownerType: 'user',
                ownerUserId: 'user-1',
                availableAgentIds: ['theo'],
              },
        }),
      }),
    }))

    await expect(resolveWatcherRuntimePreference({
      runtimeTargetId: 'linked-device:vps-1',
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
    })).resolves.toBe('vps')
    await expect(resolveWatcherRuntimePreference({
      runtimeTargetId: 'linked-device:mac-1',
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
    })).resolves.toBe('local')
  })
})
