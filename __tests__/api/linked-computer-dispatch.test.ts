import {
  authorizeLinkedComputerDispatch,
  discoverAuthorizedRuntimeTargets,
  linkedComputerReceiptPayload,
  requireMatchingExecutionReceipt,
} from '@/lib/linked-computers/runtime-targets'
import { generateKeyPairSync, sign } from 'node:crypto'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Record<string, Row>>) {
  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return { async get() { const row = seed[name]?.[id]; return { exists: Boolean(row), id, data: () => row } } }
        },
        async get() {
          return { docs: Object.entries(seed[name] ?? {}).map(([id, row]) => ({ id, data: () => row })) }
        },
      }
    },
  }
}

const now = Date.parse('2026-07-12T12:00:00.000Z')
const base = {
  linked_devices: {
    owned: { deviceId: 'owned', ownerUserId: 'user-a', runtimeTargetId: 'target-owned', label: 'Office Mac', platform: 'macos', runtimeVersion: '2.0.0', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 3, lastSeenAt: new Date(now - 30_000).toISOString() },
    shared: { deviceId: 'shared', ownerUserId: 'user-b', runtimeTargetId: 'target-shared', label: 'Studio PC', platform: 'windows', runtimeVersion: '2.0.0', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 7, lastSeenAt: new Date(now - 30_000).toISOString() },
    stale: { deviceId: 'stale', ownerUserId: 'user-a', runtimeTargetId: 'target-stale', label: 'Old Mac', platform: 'macos', runtimeVersion: '1.0.0', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 1, lastSeenAt: new Date(now - 900_000).toISOString() },
  },
  linked_device_grants: {
    'org-a_owned': { deviceId: 'owned', orgId: 'org-a', status: 'active', allowedUserIds: [], capabilities: ['workspace.execute'] },
    'org-a_shared': { deviceId: 'shared', orgId: 'org-a', status: 'active', allowedUserIds: ['user-a'], capabilities: ['workspace.execute'] },
    'org-a_stale': { deviceId: 'stale', orgId: 'org-a', status: 'active', allowedUserIds: [], capabilities: ['workspace.execute'] },
  },
  linked_device_workspace_mappings: {
    'map-owned': { mappingId: 'map-owned', deviceId: 'owned', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
    'map-shared': { mappingId: 'map-shared', deviceId: 'shared', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
    'map-stale': { mappingId: 'map-stale', deviceId: 'stale', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
  },
  linked_device_credentials: {
    owned: { credentialVersion: 3, revokedAt: null }, shared: { credentialVersion: 7, revokedAt: null }, stale: { credentialVersion: 1, revokedAt: null },
  },
  orgMembers: {
    'org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
    'org-a_user-b': { orgId: 'org-a', uid: 'user-b', status: 'active' },
  },
}

describe('linked computer runtime authorization', () => {
  it('discovers only owned or explicitly shared, granted, fresh, healthy and mapped devices', async () => {
    const targets = await discoverAuthorizedRuntimeTargets({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' }, { db: fakeDb(base), nowMs: () => now })
    expect(targets.map((target) => target.deviceId)).toEqual(['owned', 'shared'])
    expect(targets[0]).toEqual(expect.objectContaining({ id: 'target-owned', workspaceId: 'workspace-a', mappingId: 'map-owned', selectable: true }))
    expect(JSON.stringify(targets)).not.toMatch(/credentialVersion|ownerUserId|baseUrl|apiKey|publicKey|path/i)
  })

  it('denies guessed runtime or device identifiers', async () => {
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-guessed' }, { db: fakeDb(base), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('denies dispatch immediately after caller or owner membership loss', async () => {
    const missingCaller = structuredClone(base); delete missingCaller.orgMembers['org-a_user-a']
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned' }, { db: fakeDb(missingCaller), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_membership_required' })
    const missingOwner = structuredClone(base); delete missingOwner.orgMembers['org-a_user-b']
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-shared' }, { db: fakeDb(missingOwner), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_membership_required' })
  })

  it('denies an otherwise valid device when its Workspace mapping is missing', async () => {
    const rows = structuredClone(base); delete rows.linked_device_workspace_mappings['map-owned']
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned' }, { db: fakeDb(rows), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_mapping_required' })
  })

  it('does not leak a device mapping from Workspace B into Workspace A discovery', async () => {
    const rows = structuredClone(base)
    rows.linked_device_workspace_mappings['map-owned'].workspaceId = 'workspace-b'
    const targets = await discoverAuthorizedRuntimeTargets({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' }, { db: fakeDb(rows), nowMs: () => now })
    expect(targets.find((target) => target.deviceId === 'owned')).toBeUndefined()
  })

  it('never falls back when an explicit device is unavailable', async () => {
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-stale' }, { db: fakeDb(base), nowMs: () => now, compatibilityTargets: [{ id: 'vps', label: 'VPS', kind: 'platform-vps' }] }))
      .rejects.toMatchObject({ code: 'linked_device_stale' })
  })

  it('requires a signed execution receipt to match device, target, credential, mapping, runtime and run/request binding', async () => {
    const keys = generateKeyPairSync('ed25519')
    const authorized = await authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned' }, { db: fakeDb(base), nowMs: () => now })
    const receipt = { deviceId: 'owned', runtimeTargetId: 'target-owned', credentialVersion: 3, mappingId: 'map-owned', acceptedAt: new Date(now).toISOString(), toolStartedAt: new Date(now + 1).toISOString(), runtimeVersion: '2.0.0', outcome: 'accepted', runId: 'run-1', requestId: 'assistant-1', signature: '' }
    receipt.signature = sign(null, Buffer.from(linkedComputerReceiptPayload(receipt)), keys.privateKey).toString('base64url')
    expect(requireMatchingExecutionReceipt(authorized, receipt, { publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), runId: 'run-1', requestId: 'assistant-1', nowMs: () => now + 2 })).toEqual(expect.objectContaining({ deviceId: 'owned', machineLabel: 'Office Mac' }))
    expect(() => requireMatchingExecutionReceipt(authorized, { ...receipt, mappingId: 'map-other' }, { publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), runId: 'run-1', requestId: 'assistant-1', nowMs: () => now + 2 })).toThrow('linked computers: execution receipt mismatch')
  })

})
