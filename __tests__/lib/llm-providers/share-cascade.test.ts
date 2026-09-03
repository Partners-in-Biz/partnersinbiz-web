/**
 * @jest-environment node
 */

const mockEnqueueDelivery = jest.fn()
const mockEnqueueRevocations = jest.fn()
const mockListBindings = jest.fn()
const mockPutDesired = jest.fn()
const mockUpdateBinding = jest.fn()
const mockWriteAudit = jest.fn()
const mockResolveShare = jest.fn()
const mockDeviceGet = jest.fn()
const mockConnectionQueryGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        get: (...args: unknown[]) => {
          if (name === 'linked_devices') return mockDeviceGet(id, ...args)
          return Promise.resolve({ exists: false, id, data: () => undefined })
        },
        update: jest.fn(),
        set: jest.fn(),
      }),
      where: () => ({
        where: () => ({ get: (...args: unknown[]) => mockConnectionQueryGet(...args) }),
        get: (...args: unknown[]) => mockConnectionQueryGet(...args),
      }),
    }),
  },
}))

jest.mock('@/lib/llm-providers/sync-targets', () => ({
  resolveOrgShareLinkedComputerTargets: (...args: unknown[]) => mockResolveShare(...args),
}))

jest.mock('@/lib/llm-providers/bindings', () => ({
  listConnectionLlmCredentialBindings: (...args: unknown[]) => mockListBindings(...args),
  putDesiredLlmCredentialBinding: (...args: unknown[]) => mockPutDesired(...args),
  updateLlmCredentialBinding: (...args: unknown[]) => mockUpdateBinding(...args),
}))

jest.mock('@/lib/llm-providers/linked-delivery', () => ({
  enqueueCredentialDelivery: (...args: unknown[]) => mockEnqueueDelivery(...args),
  enqueueCredentialRevocationsForBindings: (...args: unknown[]) => mockEnqueueRevocations(...args),
}))

jest.mock('@/lib/llm-providers/audit', () => ({
  writeLlmCredentialAudit: (...args: unknown[]) => mockWriteAudit(...args),
}))

jest.mock('@/lib/linked-computers/store', () => ({
  putDeviceGrant: jest.fn(),
}))

import {
  enqueueCredentialRevocationsForBindings,
} from '@/lib/llm-providers/linked-delivery'
import {
  flagStaleRevokePending,
  reconcileShareBindingsForConnection,
  revokeMemberShareAccess,
} from '@/lib/llm-providers/share-cascade'
import type { LlmCredentialBinding, LlmProviderConnection } from '@/lib/llm-providers/types'

const connection: LlmProviderConnection = {
  id: 'org:org-1:openai-api',
  provider: 'openai-api',
  hermesProvider: 'openai',
  authKind: 'api_key',
  scope: 'org',
  orgId: 'org-1',
  ownerUid: null,
  label: 'OpenAI',
  status: 'connected',
  credentialsEnc: { ciphertext: 'c', iv: 'i', tag: 't' },
  scopeKeyRef: 'org:org-1',
  credentialHint: 'sk-…',
  meta: {},
  credentialVersion: 1,
  syncedAgentIds: [],
  lastValidatedAt: null,
  lastUsedAt: null,
  lastSyncedAt: null,
  lastError: null,
  shareTargets: {
    mode: 'organization',
    teamIds: [],
    userIds: [],
    agentIds: [],
    requireActiveDeviceGrant: true,
  },
  createdAt: null,
  updatedAt: null,
  createdBy: 'admin-1',
  createdByType: 'user',
}

function binding(overrides: Partial<LlmCredentialBinding> & Pick<LlmCredentialBinding, 'id' | 'deviceId' | 'agentId'>): LlmCredentialBinding {
  return {
    connectionId: connection.id,
    credentialVersion: 1,
    orgId: 'org-1',
    ownerUid: null,
    scope: 'org',
    provider: 'openai-api',
    hermesProvider: 'openai',
    runtimeTargetId: `linked-device:${overrides.deviceId}`,
    machineLabel: 'Mac',
    status: 'ready',
    liveAuthVerified: true,
    verifiedModelIds: [],
    lastError: null,
    deliveryJobId: null,
    lastVerifiedAt: null,
    createdAt: null,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('reconcileShareBindingsForConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDeviceGet.mockImplementation(async (deviceId: string) => ({
      exists: true,
      id: deviceId,
      data: () => ({
        deviceId,
        ownerType: 'user',
        ownerUserId: deviceId === 'mac-old' ? 'u-old' : 'u-new',
        status: 'active',
      }),
    }))
  })

  it('reconcile enqueues deliveries for new members and revocations for removed ones', async () => {
    mockResolveShare.mockResolvedValue({
      targets: [{
        kind: 'member_linked_computer',
        agentId: 'acme--pip',
        deviceId: 'mac-new',
        runtimeTargetId: 'linked-device:mac-new',
        label: 'New Mac · acme--pip',
        memberUserId: 'u-new',
      }],
      memberCount: 1,
    })
    mockListBindings.mockResolvedValue([
      binding({ id: 'bind-old', deviceId: 'mac-old', agentId: 'acme--pip' }),
      binding({
        id: 'bind-vps',
        deviceId: 'vps-1',
        agentId: 'pip',
      }),
    ])
    mockDeviceGet.mockImplementation(async (deviceId: string) => ({
      exists: true,
      id: deviceId,
      data: () => deviceId === 'vps-1'
        ? { deviceId, ownerType: 'organization', ownerOrgId: 'org-1', status: 'active' }
        : { deviceId, ownerType: 'user', ownerUserId: 'u-old', status: 'active' },
    }))
    mockEnqueueRevocations.mockResolvedValue(['rev-job-1'])
    mockPutDesired.mockResolvedValue({ id: 'bind-new' })
    mockEnqueueDelivery.mockResolvedValue({ jobId: 'del-job-1' })

    const result = await reconcileShareBindingsForConnection(connection, 'admin-1')

    expect(mockEnqueueRevocations).toHaveBeenCalledWith(
      connection,
      [expect.objectContaining({ id: 'bind-old', deviceId: 'mac-old' })],
      'share_targets_narrowed',
    )
    expect(mockEnqueueDelivery).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 'bind-new',
      target: expect.objectContaining({ deviceId: 'mac-new', kind: 'member_linked_computer' }),
    }))
    expect(result).toEqual({
      enqueuedDeliveries: ['del-job-1'],
      enqueuedRevocations: ['rev-job-1'],
    })
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'share_targets.changed',
      actorUserId: 'admin-1',
      connectionId: connection.id,
    }))
  })
})

describe('enqueueCredentialRevocationsForBindings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('offline device becomes revoke_pending', async () => {
    const { enqueueCredentialRevocationsForBindings: actualEnqueue } = jest.requireActual(
      '@/lib/llm-providers/linked-delivery',
    ) as { enqueueCredentialRevocationsForBindings: typeof enqueueCredentialRevocationsForBindings }

    mockDeviceGet.mockResolvedValue({ exists: false, data: () => undefined })
    mockUpdateBinding.mockResolvedValue(undefined)
    mockWriteAudit.mockResolvedValue(undefined)

    const jobIds = await actualEnqueue(
      connection,
      [binding({ id: 'bind-offline', deviceId: 'mac-offline', agentId: 'acme--pip' })],
      'share_targets_narrowed',
    )

    expect(jobIds).toEqual([])
    expect(mockUpdateBinding).toHaveBeenCalledWith('bind-offline', {
      status: 'revoke_pending',
      liveAuthVerified: false,
      lastError: 'share_targets_narrowed',
    })
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'binding.revoke_pending',
      bindingId: 'bind-offline',
      reason: 'share_targets_narrowed',
    }))
  })
})

describe('revokeMemberShareAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConnectionQueryGet.mockResolvedValue({
      docs: [{ id: connection.id, data: () => connection }],
    })
    mockListBindings.mockResolvedValue([
      binding({ id: 'bind-a', deviceId: 'mac-a', agentId: 'acme--pip' }),
      binding({ id: 'bind-b', deviceId: 'mac-b', agentId: 'acme--pip' }),
    ])
    mockDeviceGet.mockImplementation(async (deviceId: string) => ({
      exists: true,
      id: deviceId,
      data: () => ({
        deviceId,
        ownerType: 'user',
        ownerUserId: deviceId === 'mac-a' ? 'user-a' : 'user-b',
        status: 'active',
      }),
    }))
    mockEnqueueRevocations.mockResolvedValue(['rev-a'])
  })

  it('member removal revokes bindings on that member\'s devices only', async () => {
    const result = await revokeMemberShareAccess({
      orgId: 'org-1',
      userId: 'user-a',
      reason: 'member_removed',
    })

    expect(mockEnqueueRevocations).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      [expect.objectContaining({ id: 'bind-a', deviceId: 'mac-a' })],
      'member_removed',
    )
    expect(mockEnqueueRevocations.mock.calls[0][1]).toHaveLength(1)
    expect(result.bindingIds).toEqual(['bind-a'])
  })
})

describe('flagStaleRevokePending', () => {
  it('stale sweep flags once', async () => {
    const updateBinding = jest.fn()
    const updateConnection = jest.fn()
    const writeAudit = jest.fn()
    const nowMs = 2_000_000_000_000
    const stale = binding({
      id: 'bind-stale',
      deviceId: 'mac-1',
      agentId: 'acme--pip',
      status: 'revoke_pending',
      updatedAt: nowMs - (25 * 60 * 60 * 1000),
    })
    const alreadyFlagged = binding({
      id: 'bind-flagged',
      deviceId: 'mac-2',
      agentId: 'acme--pip',
      status: 'revoke_pending',
      updatedAt: nowMs - (30 * 60 * 60 * 1000),
      staleFlaggedAt: nowMs - 1000,
    })

    const first = await flagStaleRevokePending({
      nowMs,
      listPending: async () => [stale, alreadyFlagged],
      updateBinding,
      updateConnection,
      writeAudit,
    })
    expect(first.flagged).toBe(1)
    expect(updateBinding).toHaveBeenCalledWith('bind-stale', expect.objectContaining({
      lastError: 'Revocation not acknowledged for 24h. Rotate this key.',
    }))
    expect(updateConnection).toHaveBeenCalledWith(connection.id, expect.objectContaining({
      'meta.rotateRecommended': true,
    }))
    expect(writeAudit).toHaveBeenCalledTimes(1)

    stale.staleFlaggedAt = nowMs
    updateBinding.mockClear()
    writeAudit.mockClear()
    const second = await flagStaleRevokePending({
      nowMs,
      listPending: async () => [stale, alreadyFlagged],
      updateBinding,
      updateConnection,
      writeAudit,
    })
    expect(second.flagged).toBe(0)
    expect(writeAudit).not.toHaveBeenCalled()
  })
})
