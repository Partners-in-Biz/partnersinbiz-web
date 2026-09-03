import {
  authorizeAdoptedLinkedComputerDispatch,
  authorizeLinkedComputerDispatch,
  authorizeLinkedComputerRecoveryQueue,
  discoverAuthorizedRuntimeTargets,
  hermesUpdateRequired,
  linkedComputerReceiptPayload,
  requireMatchingExecutionReceipt,
  linkedRuntimeUpdateRequired,
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
    owned: { deviceId: 'owned', ownerUserId: 'user-a', runtimeTargetId: 'target-owned', label: 'Office Mac', platform: 'macos', runtimeVersion: '2.0.0', hermesVersion: '0.20.6', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 3, lastSeenAt: new Date(now - 30_000).toISOString() },
    shared: { deviceId: 'shared', ownerUserId: 'user-b', runtimeTargetId: 'target-shared', label: 'Studio PC', platform: 'windows', runtimeVersion: '2.0.0', hermesVersion: '0.20.6', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 7, lastSeenAt: new Date(now - 30_000).toISOString() },
    stale: { deviceId: 'stale', ownerUserId: 'user-a', runtimeTargetId: 'target-stale', label: 'Old Mac', platform: 'macos', runtimeVersion: '1.0.0', hermesVersion: '0.20.6', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 1, lastSeenAt: new Date(now - 900_000).toISOString() },
  },
  linked_device_grants: {
    'org-a_owned': { deviceId: 'owned', orgId: 'org-a', status: 'active', allowedUserIds: [], capabilities: ['workspace.execute'] },
    'org-a_shared': { deviceId: 'shared', orgId: 'org-a', status: 'active', allowedUserIds: ['user-a'], capabilities: ['workspace.execute'] },
    'org-a_stale': { deviceId: 'stale', orgId: 'org-a', status: 'active', allowedUserIds: [], capabilities: ['workspace.execute'] },
  },
  linked_device_workspace_mappings: {
    'map-owned': { mappingId: 'map-owned', deviceId: 'owned', orgId: 'org-a', workspaceId: 'workspace-a', label: 'Office Mac folder', status: 'active' },
    'map-shared': { mappingId: 'map-shared', deviceId: 'shared', orgId: 'org-a', workspaceId: 'workspace-a', label: 'Studio folder', status: 'active' },
    'map-stale': { mappingId: 'map-stale', deviceId: 'stale', orgId: 'org-a', workspaceId: 'workspace-a', label: 'Old folder', status: 'active' },
  },
  linked_device_credentials: {
    owned: { credentialVersion: 3, revokedAt: null }, shared: { credentialVersion: 7, revokedAt: null }, stale: { credentialVersion: 1, revokedAt: null },
  },
  orgMembers: {
    'org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
    'org-a_user-b': { orgId: 'org-a', uid: 'user-b', status: 'active' },
  },
  project_execution_locations: {},
}

describe('linked computer runtime authorization', () => {
  it('enforces strict minimum linked runtime semver', () => {
    expect(linkedRuntimeUpdateRequired('2.0.0', '2.0.0')).toBe(false)
    expect(linkedRuntimeUpdateRequired('2.1.0', '2.0.0')).toBe(false)
    expect(linkedRuntimeUpdateRequired('1.9.9', '2.0.0')).toBe(true)
    expect(linkedRuntimeUpdateRequired('invalid', '2.0.0')).toBe(true)
    expect(linkedRuntimeUpdateRequired('2.0.0', 'invalid')).toBe(true)
  })

  it('marks a device non-selectable when Hermes is missing or below the channel min', async () => {
    expect(hermesUpdateRequired({ hermesVersion: undefined }, '0.20.6')).toBe(true)
    expect(hermesUpdateRequired({ hermesVersion: '0.20.5' }, '0.20.6')).toBe(true)
    expect(hermesUpdateRequired({ hermesVersion: '0.20.6' }, '0.20.6')).toBe(false)
    expect(hermesUpdateRequired({ hermesVersion: '0.21.0' }, '0.20.6')).toBe(false)

    const rows = structuredClone(base) as Record<string, Record<string, Row>>
    rows.linked_devices.owned = { ...rows.linked_devices.owned, hermesVersion: '0.20.3' }
    const targets = await discoverAuthorizedRuntimeTargets(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' },
      { db: fakeDb(rows), nowMs: () => now },
    )
    expect(targets.find((target) => target.deviceId === 'owned')).toEqual(expect.objectContaining({
      selectable: false,
      unavailableReason: 'hermes_update_required',
    }))
  })
  it('keeps authorized stale devices visible but unavailable', async () => {
    const targets = await discoverAuthorizedRuntimeTargets({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' }, { db: fakeDb(base), nowMs: () => now })
    expect(targets.map((target) => target.deviceId)).toEqual(['owned', 'shared', 'stale'])
    expect(targets[0]).toEqual(expect.objectContaining({
      id: 'target-owned', locationId: 'linked-device:owned', workspaceId: 'workspace-a',
      mappingId: 'map-owned', mappingLabel: 'Office Mac folder', selectable: true,
      enabled: true, isLocal: true, isFresh: true, isHealthy: true,
      ageSeconds: 30, lastHealthStatus: 'ok',
    }))
    expect(targets[2]).toEqual(expect.objectContaining({ id: 'target-stale', selectable: false, unavailableReason: 'stale' }))
    expect(JSON.stringify(targets)).not.toMatch(/credentialVersion|ownerUserId|baseUrl|apiKey|publicKey|path/i)
  })

  it('keeps a fresh degraded machine visible while its heartbeat has withdrawn execution', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.owned = {
      ...rows.linked_devices.owned,
      health: 'degraded',
      capabilities: ['workspace.sync'],
      availableAgentIds: [],
    }
    const targets = await discoverAuthorizedRuntimeTargets(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' },
      { db: fakeDb(rows), nowMs: () => now },
    )
    expect(targets.find((target) => target.deviceId === 'owned')).toEqual(expect.objectContaining({
      selectable: false,
      isFresh: true,
      isHealthy: false,
      unavailableReason: 'offline',
      lastHealthStatus: 'degraded',
    }))
    await expect(authorizeLinkedComputerDispatch(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_offline' })
  })

  it('authorizes only an exact, previously seen linked computer for its recovery queue', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.owned = {
      ...rows.linked_devices.owned,
      health: 'degraded',
      capabilities: ['workspace.sync'],
      lastSeenAt: new Date(now - 30_000).toISOString(),
      availableAgentIds: [],
    }
    await expect(authorizeLinkedComputerRecoveryQueue(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', mappingId: 'map-owned', agentId: 'pip' },
      { db: fakeDb(rows), nowMs: () => now },
    )).resolves.toEqual(expect.objectContaining({ deviceId: 'owned', mappingId: 'map-owned' }))

    await expect(authorizeLinkedComputerRecoveryQueue(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-guessed', mappingId: 'map-owned', agentId: 'pip' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('keeps recovery queueing fail-closed for known agent, upgrade, and credential changes', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.owned = {
      ...rows.linked_devices.owned,
      health: 'degraded',
      capabilities: ['workspace.sync'],
      availableAgentIds: ['pip'],
    }
    await expect(authorizeLinkedComputerRecoveryQueue(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', agentId: 'theo' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_agent_unavailable' })

    rows.linked_devices.owned.runtimeVersion = '1.0.0'
    const previousMinimum = process.env.LINKED_RUNTIME_MIN_VERSION
    process.env.LINKED_RUNTIME_MIN_VERSION = '2.0.0'
    try {
      await expect(authorizeLinkedComputerRecoveryQueue(
        { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', agentId: 'pip' },
        { db: fakeDb(rows), nowMs: () => now },
      )).rejects.toMatchObject({ code: 'linked_device_update_required' })
    } finally {
      if (previousMinimum === undefined) delete process.env.LINKED_RUNTIME_MIN_VERSION
      else process.env.LINKED_RUNTIME_MIN_VERSION = previousMinimum
    }

    rows.linked_devices.owned.runtimeVersion = '2.0.0'
    rows.linked_device_credentials.owned.revokedAt = new Date(now).toISOString()
    await expect(authorizeLinkedComputerRecoveryQueue(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', agentId: 'pip' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('lists every active workspace mapping on the same computer and authorizes the chosen mapping', async () => {
    const rows = structuredClone(base) as any
    rows.linked_device_workspace_mappings['map-owned-growth'] = {
      mappingId: 'map-owned-growth', deviceId: 'owned', orgId: 'org-a', workspaceId: 'workspace-a',
      label: 'Client Growth', status: 'active',
    }
    const targets = await discoverAuthorizedRuntimeTargets(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' },
      { db: fakeDb(rows), nowMs: () => now },
    )
    expect(targets.filter((target) => target.deviceId === 'owned')).toEqual([
      expect.objectContaining({ mappingId: 'map-owned', mappingLabel: 'Office Mac folder' }),
      expect.objectContaining({ mappingId: 'map-owned-growth', mappingLabel: 'Client Growth' }),
    ])
    await expect(authorizeLinkedComputerDispatch(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', mappingId: 'map-owned-growth' },
      { db: fakeDb(rows), nowMs: () => now },
    )).resolves.toEqual(expect.objectContaining({
      deviceId: 'owned', mappingId: 'map-owned-growth', mappingLabel: 'Client Growth',
    }))
    await expect(authorizeLinkedComputerDispatch(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', mappingId: 'map-missing' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_mapping_not_authorized' })
  })

  it('authorizes every current and future active organisation member without copying user ids into the grant', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.vps = { deviceId: 'vps', deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', createdByUserId: 'admin-a', runtimeTargetId: 'target-vps', label: 'Partners VPS', platform: 'linux', runtimeVersion: '2.0.0', hermesVersion: '0.20.6', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 9, lastSeenAt: new Date(now - 30_000).toISOString() }
    rows.linked_device_grants['org-a_vps'] = { deviceId: 'vps', orgId: 'org-a', status: 'active', accessMode: 'organization', allowedUserIds: [], capabilities: ['workspace.execute'] }
    rows.linked_device_workspace_mappings['map-vps'] = { mappingId: 'map-vps', deviceId: 'vps', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }
    rows.linked_device_credentials.vps = { credentialVersion: 9, revokedAt: null }
    rows.orgMembers['org-a_future-member'] = { orgId: 'org-a', uid: 'future-member' }

    const targets = await discoverAuthorizedRuntimeTargets({ userId: 'future-member', orgId: 'org-a', workspaceId: 'workspace-a' }, { db: fakeDb(rows), nowMs: () => now })
    expect(targets).toContainEqual(expect.objectContaining({
      id: 'target-vps', platform: 'linux', selectable: true,
      deviceKind: 'vps', ownerType: 'organization', visibility: 'organization',
    }))
    expect(JSON.stringify(targets)).not.toMatch(/ownerOrgId|createdByUserId/)
  })

  it('preserves selected-user grants and denies unselected organisation members', async () => {
    const rows = structuredClone(base) as any
    rows.linked_device_grants['org-a_shared'].accessMode = 'selected_users'
    rows.orgMembers['org-a_user-c'] = { orgId: 'org-a', uid: 'user-c', status: 'active' }

    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-shared' }, { db: fakeDb(rows), nowMs: () => now }))
      .resolves.toEqual(expect.objectContaining({ deviceId: 'shared', locationId: 'linked-device:shared' }))
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-c', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-shared' }, { db: fakeDb(rows), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('resolves a retired runtime alias only through its explicit adopted-device replacement edge', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.owned.adoptedFromLocationId = 'office-mac-legacy'
    rows.project_execution_locations['office-mac-legacy'] = {
      locationId: 'office-mac-legacy', runtimeTargetId: 'local', legacyCompatibilityTargetId: 'legacy-local',
      status: 'retired', adoptedDeviceId: 'owned', replacedByLocationId: 'linked-device:owned',
    }
    const targets = await discoverAuthorizedRuntimeTargets(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' },
      { db: fakeDb(rows), nowMs: () => now },
    )
    expect(targets).toContainEqual(expect.objectContaining({
      id: 'target-owned', legacyRuntimeTargetIds: ['legacy-local', 'local'], selectable: true,
    }))
    await expect(authorizeAdoptedLinkedComputerDispatch(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'local' },
      { db: fakeDb(rows), nowMs: () => now },
    )).resolves.toEqual(expect.objectContaining({ deviceId: 'owned', runtimeTargetId: 'target-owned' }))

    rows.project_execution_locations['office-mac-legacy'].replacedByLocationId = 'linked-device:shared'
    await expect(authorizeAdoptedLinkedComputerDispatch(
      { userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'local' },
      { db: fakeDb(rows), nowMs: () => now },
    )).rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('never leaks an organisation-owned runtime across tenant boundaries', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.vps = { deviceId: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', createdByUserId: 'admin-a', runtimeTargetId: 'target-vps', label: 'Partners VPS', platform: 'linux', runtimeVersion: '2.0.0', status: 'active', health: 'ok', capabilities: ['workspace.execute'], credentialVersion: 9, lastSeenAt: new Date(now - 30_000).toISOString() }
    rows.linked_device_grants['org-a_vps'] = { deviceId: 'vps', orgId: 'org-a', status: 'active', accessMode: 'organization', allowedUserIds: [], capabilities: ['workspace.execute'] }
    rows.linked_device_workspace_mappings['map-vps'] = { mappingId: 'map-vps', deviceId: 'vps', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }
    rows.linked_device_credentials.vps = { credentialVersion: 9, revokedAt: null }
    rows.orgMembers['org-b_user-b'] = { orgId: 'org-b', uid: 'user-b', status: 'active' }

    await expect(authorizeLinkedComputerDispatch({ userId: 'user-b', orgId: 'org-b', workspaceId: 'workspace-a', runtimeTargetId: 'target-vps' }, { db: fakeDb(rows), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_not_authorized' })
  })

  it('returns offline and update-required runtimes with stable unavailable reasons', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.offline = { ...rows.linked_devices.owned, deviceId: 'offline', runtimeTargetId: 'target-offline', label: 'Offline Mac', health: 'degraded', credentialVersion: 4 }
    rows.linked_devices.update = { ...rows.linked_devices.owned, deviceId: 'update', runtimeTargetId: 'target-update', label: 'Update Mac', runtimeVersion: '1.0.0', credentialVersion: 5 }
    for (const [deviceId, version] of [['offline', 4], ['update', 5]] as const) {
      rows.linked_device_grants[`org-a_${deviceId}`] = { deviceId, orgId: 'org-a', status: 'active', accessMode: 'owner', allowedUserIds: [], capabilities: ['workspace.execute'] }
      rows.linked_device_workspace_mappings[`map-${deviceId}`] = { mappingId: `map-${deviceId}`, deviceId, orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }
      rows.linked_device_credentials[deviceId] = { credentialVersion: version, revokedAt: null }
    }
    const previousMinimum = process.env.LINKED_RUNTIME_MIN_VERSION
    process.env.LINKED_RUNTIME_MIN_VERSION = '2.0.0'
    try {
      const targets = await discoverAuthorizedRuntimeTargets({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a' }, { db: fakeDb(rows), nowMs: () => now })
      expect(targets).toContainEqual(expect.objectContaining({
        id: 'target-offline', selectable: false, unavailableReason: 'offline',
        isFresh: true, isHealthy: false, lastHealthStatus: 'degraded', ageSeconds: 30,
      }))
      expect(targets).toContainEqual(expect.objectContaining({ id: 'target-update', selectable: false, unavailableReason: 'update_required', updateRequired: true }))
      await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-offline' }, { db: fakeDb(rows), nowMs: () => now }))
        .rejects.toMatchObject({ code: 'linked_device_offline' })
    } finally {
      if (previousMinimum === undefined) delete process.env.LINKED_RUNTIME_MIN_VERSION
      else process.env.LINKED_RUNTIME_MIN_VERSION = previousMinimum
    }
  })

  it('offers a linked computer only for Hermes agents reported healthy on that machine', async () => {
    const rows = structuredClone(base) as any
    rows.linked_devices.owned.availableAgentIds = ['pip']
    const targets = await discoverAuthorizedRuntimeTargets({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', agentId: 'theo' }, { db: fakeDb(rows), nowMs: () => now })
    expect(targets).toContainEqual(expect.objectContaining({ id: 'target-owned', selectable: false, unavailableReason: 'agent_unavailable', availableAgentIds: ['pip'] }))
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', agentId: 'theo' }, { db: fakeDb(rows), nowMs: () => now }))
      .rejects.toMatchObject({ code: 'linked_device_agent_unavailable' })
    await expect(authorizeLinkedComputerDispatch({ userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'target-owned', agentId: 'pip' }, { db: fakeDb(rows), nowMs: () => now }))
      .resolves.toEqual(expect.objectContaining({ deviceId: 'owned', availableAgentIds: ['pip'] }))
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
