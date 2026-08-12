const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ ms, toMillis: () => ms }),
  },
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  encryptLinkedRunPayload,
  linkedRunJobId,
  resolveLinkedComputerDispatchTarget,
} from '../../../services/agent-watcher/src/linked-run'

function deviceDoc(data: Record<string, unknown>) {
  return {
    get: async () => ({
      exists: true,
      data: () => data,
    }),
  }
}

function missingDoc() {
  return {
    get: async () => ({ exists: false, data: () => undefined }),
  }
}

describe('agent watcher linked-device Kanban preference', () => {
  const nowMs = Date.parse('2026-08-03T09:00:00.000Z')

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOCIAL_TOKEN_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  })

  it('prefers the Messages linked-run queue for a healthy user Mac pin', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'linked_devices') {
        return {
          doc: () => deviceDoc({
            status: 'active',
            ownerType: 'user',
            ownerUserId: 'user-1',
            platform: 'macos',
            deviceKind: 'computer',
            label: 'Peets-Mac-mini.local',
            runtimeTargetId: 'linked-device:mac-1',
            runtimeVersion: '1.1.23',
            credentialVersion: 1,
            availableAgentIds: ['theo'],
            capabilities: ['workspace.execute', 'workspace.sync'],
            lastHeartbeatAt: { toMillis: () => nowMs - 15_000 },
          }),
        }
      }
      if (name === 'linked_device_credentials') {
        return { doc: () => deviceDoc({ credentialVersion: 1 }) }
      }
      if (name === 'linked_device_grants') {
        return {
          doc: () => deviceDoc({
            status: 'active',
            capabilities: ['workspace.execute'],
          }),
        }
      }
      if (name === 'linked_device_workspace_mappings') {
        return {
          where: () => ({
            get: async () => ({
              docs: [{
                id: 'map-mac',
                data: () => ({
                  mappingId: 'map-mac',
                  deviceId: 'mac-1',
                  orgId: 'org-1',
                  workspaceId: 'partners',
                  status: 'active',
                }),
              }],
            }),
          }),
        }
      }
      if (name === 'projects') {
        return {
          doc: () => deviceDoc({
            name: 'Loyalty Plus',
          }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    await expect(resolveLinkedComputerDispatchTarget({
      runtimeTargetId: 'linked-device:mac-1',
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      projectId: 'proj-loyalty',
      nowMs,
    })).resolves.toEqual({
      kind: 'linked-computer',
      deviceId: 'mac-1',
      runtimeTargetId: 'linked-device:mac-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceId: 'partners',
      mappingId: 'map-mac',
      relativeFolder: '.',
      workingDirectory: '~/Cowork/partners/Loyalty Plus',
      credentialVersion: 1,
      machineLabel: 'Peets-Mac-mini.local',
      platform: 'macos',
      runtimeVersion: '1.1.23',
    })
  })

  it('keeps org/VPS linked devices on the direct Hermes path (null linked target)', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'linked_devices') {
        return {
          doc: () => deviceDoc({
            status: 'active',
            ownerType: 'organization',
            ownerOrgId: 'org-1',
            platform: 'linux',
            deviceKind: 'vps',
            label: 'Partners VPS',
            runtimeTargetId: 'linked-device:vps-1',
            availableAgentIds: ['theo'],
            capabilities: ['workspace.execute'],
            lastHeartbeatAt: { toMillis: () => nowMs - 5_000 },
          }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    await expect(resolveLinkedComputerDispatchTarget({
      runtimeTargetId: 'linked-device:vps-1',
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      nowMs,
    })).resolves.toBeNull()
  })

  it('returns null when no runtime pin is set so VPS default remains', async () => {
    await expect(resolveLinkedComputerDispatchTarget({
      runtimeTargetId: null,
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      nowMs,
    })).resolves.toBeNull()
  })

  it('fails closed for a stale/offline Mac pin instead of falling through to VPS', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'linked_devices') {
        return {
          doc: () => deviceDoc({
            status: 'active',
            ownerType: 'user',
            ownerUserId: 'user-1',
            platform: 'macos',
            deviceKind: 'computer',
            label: 'Peets-Mac-mini.local',
            runtimeTargetId: 'linked-device:mac-1',
            availableAgentIds: ['theo'],
            capabilities: ['workspace.execute'],
            lastHeartbeatAt: { toMillis: () => nowMs - 30 * 60_000 },
          }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    await expect(resolveLinkedComputerDispatchTarget({
      runtimeTargetId: 'linked-device:mac-1',
      orgId: 'org-1',
      ownerUid: 'user-1',
      agentId: 'theo',
      nowMs,
    })).rejects.toThrow(/offline or stale/i)
  })

  it('encrypts linked-run payloads with the Messages job-key derivation', () => {
    const jobId = linkedRunJobId('mac-1', 'kanban:task-1:1')
    const enc = encryptLinkedRunPayload({
      prompt: 'hello kanban',
      model: 'grok-4.6',
      provider: 'xai-oauth',
    }, 'mac-1', jobId)
    expect(enc.ciphertext).toBeTruthy()
    expect(enc.iv).toBeTruthy()
    expect(enc.tag).toBeTruthy()
    expect(jobId).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
