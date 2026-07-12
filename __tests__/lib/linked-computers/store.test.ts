import {
  consumePairingChallenge,
  createDevice,
  createPairingChallenge,
  listOwnedDevices,
  putDeviceGrant,
  putWorkspaceMapping,
  recordDeviceHeartbeat,
  removeOwnedDevice,
  transitionDeviceStatus,
  updateOwnedDevice,
} from '@/lib/linked-computers/store'
import { assertDeviceOrgAccess } from '@/lib/linked-computers/policy'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row> = {}, failCreatePrefix?: string) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! })
  const db = {
    collection: jest.fn((name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, _op: string, value: unknown) => ({
        collection: name, field, value,
        get: async () => ({ docs: [...rows.entries()].filter(([path, row]) => path.startsWith(`${name}/`) && row[field] === value).map(([path, row]) => ({ id: path.split('/').at(-1), data: () => row })) }),
      }),
    })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending = new Map(rows)
      const result = await fn({
      get: async (document: { path?: string; collection?: string; field?: string; value?: unknown }) => {
        if (document.collection) {
          const docs = [...pending.entries()].filter(([path, value]) => path.startsWith(`${document.collection}/`) && value[document.field!] === document.value).map(([path, value]) => ({ ref: ref(path), data: () => value }))
          return { docs }
        }
        return { exists: pending.has(document.path!), data: () => pending.get(document.path!) }
      },
      create: (document: { path: string }, value: Row) => {
        if (failCreatePrefix && document.path.startsWith(failCreatePrefix)) throw new Error('forced write failure')
        if (pending.has(document.path)) throw new Error('already exists')
        pending.set(document.path, value)
      },
      set: (document: { path: string }, value: Row, options?: { merge?: boolean }) => {
        pending.set(document.path, options?.merge ? { ...pending.get(document.path), ...value } : value)
      },
      update: (document: { path: string }, value: Row) => {
        pending.set(document.path, { ...pending.get(document.path), ...value })
      },
      })
      rows.clear()
      for (const [key, value] of pending) rows.set(key, value)
      return result
    }),
  }
  return { db, rows }
}

const now = () => '2026-07-12T10:00:00.000Z'

describe('linked computers tenant domain', () => {
  it('binds a new device to the authenticated owner and writes a redacted audit event', async () => {
    const { db, rows } = fakeDb()
    await createDevice({
      deviceId: 'device-a', actorUserId: 'user-a', runtimeTargetId: 'target-a',
      publicKeyFingerprint: 'sha256:public', label: 'Peet Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0', capabilities: ['workspace.execute'],
    }, { db: db as never, now })

    expect(rows.get('linked_devices/device-a')).toMatchObject({ ownerUserId: 'user-a', status: 'active' })
    expect([...rows.entries()].find(([key]) => key.startsWith('linked_computer_audit_events/'))?.[1]).toMatchObject({
      actorUserId: 'user-a', deviceId: 'device-a', action: 'device.paired',
    })
    expect(JSON.stringify([...rows.values()])).not.toMatch(/privateKey|rawCredential|secret|\/Users\//i)
  })

  it('hashes, expires, and atomically consumes a user-owned pairing challenge once', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
    })
    const challenge = await createPairingChallenge({
      challengeId: 'challenge-a', actorUserId: 'user-a', deviceId: 'device-a', secret: 'human-code',
    }, { db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:00:00.000Z') })
    expect(challenge).toEqual({ challengeId: 'challenge-a', expiresAt: '2026-07-12T10:10:00.000Z' })
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).not.toHaveProperty('secret')
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).toMatchObject({ maxAttempts: 5 })
    expect([...rows.values()]).toContainEqual(expect.objectContaining({ action: 'pairing.created', challengeId: 'challenge-a' }))

    await consumePairingChallenge({ challengeId: 'challenge-a', secret: 'human-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:01:00.000Z'),
    })
    expect([...rows.values()]).toContainEqual(expect.objectContaining({ action: 'pairing.consumed', challengeId: 'challenge-a', deviceId: 'device-a' }))
    await expect(consumePairingChallenge({ challengeId: 'challenge-a', secret: 'human-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:02:00.000Z'),
    })).rejects.toThrow('already consumed')
  })

  it('persists failed pairing attempts before denying the exchange', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
    })
    await createPairingChallenge({
      challengeId: 'challenge-a', actorUserId: 'user-a', deviceId: 'device-a', secret: 'right-code',
    }, { db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:00:00.000Z') })
    await expect(consumePairingChallenge({ challengeId: 'challenge-a', secret: 'wrong-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:01:00.000Z'),
    })).rejects.toThrow('invalid pairing secret')
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).toMatchObject({ attempts: 1 })
  })

  it('ignores caller-controlled pairing expiry and attempt limits in favour of server bounds', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
    })
    await createPairingChallenge({
      challengeId: 'challenge-a', actorUserId: 'user-a', deviceId: 'device-a', secret: 'code',
      expiresAt: '2099-01-01T00:00:00.000Z', maxAttempts: 999999,
    } as never, { db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:00:00.000Z') })
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).toMatchObject({
      expiresAt: '2026-07-12T10:10:00.000Z', maxAttempts: 5,
    })
  })

  it('derives ownership from the trusted actor and allowlists browser-safe device fields', async () => {
    const spoof = fakeDb()
    await createDevice({
      deviceId: 'device-a', actorUserId: 'attacker', ownerUserId: 'victim', runtimeTargetId: 'target-a',
      publicKeyFingerprint: 'sha256:public', label: 'Fake', platform: 'macos', architecture: 'arm64',
      runtimeVersion: '1.0.0', capabilities: ['workspace.execute'],
      rawCredential: 'secret', localPath: '/Users/victim/private', internalUrl: 'http://internal.invalid',
    } as never, { db: spoof.db as never, now })
    expect(spoof.rows.get('linked_devices/device-a')).toMatchObject({ ownerUserId: 'attacker' })
    expect(spoof.rows.get('linked_devices/device-a')).not.toHaveProperty('rawCredential')
    expect(spoof.rows.get('linked_devices/device-a')).not.toHaveProperty('localPath')
    expect(spoof.rows.get('linked_devices/device-a')).not.toHaveProperty('internalUrl')

    const pairing = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'victim', status: 'active' },
    })
    await expect(createPairingChallenge({ challengeId: 'challenge-a', actorUserId: 'attacker', deviceId: 'device-a', secret: 'code' }, {
      db: pairing.db as never, now, nowMs: () => Date.parse('2026-07-12T10:00:00.000Z'),
    })).rejects.toThrow('device owner')
  })

  it('hydrates only safe grant and mapping summaries for owned devices', async () => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', label: 'Mac', platform: 'macos', architecture: 'arm64', runtimeVersion: '2.0.0', capabilities: ['workspace.execute'], status: 'active', credentialVersion: 2, health: 'ok', lastSeenAt: 'seen' },
      'linked_device_grants/grant-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active', allowedUserIds: ['secret-user'] },
      'linked_device_workspace_mappings/map-a': { deviceId: 'device-a', mappingId: 'map-a', orgId: 'org-a', workspaceId: 'ws-a', label: 'Acme Workspace', status: 'active', localPath: '/Users/private' },
    })
    const [result] = await listOwnedDevices('user-a', { db: db as never })
    expect(result).toMatchObject({ health: 'ok', grants: [{ orgId: 'org-a', status: 'active' }], mappings: [{ mappingId: 'map-a', orgId: 'org-a', workspaceId: 'ws-a', label: 'Acme Workspace', status: 'active' }] })
    expect(JSON.stringify(result)).not.toMatch(/secret-user|\/Users|rawCredential|endpoint|publicKey/i)
  })

  it('rolls back every write when audit persistence fails', async () => {

    const rollback = fakeDb({}, 'linked_computer_audit_events/')
    await expect(createDevice({
      deviceId: 'device-a', actorUserId: 'user-a', runtimeTargetId: 'target-a',
      publicKeyFingerprint: 'sha256:public', label: 'Mac', platform: 'macos', architecture: 'arm64',
      runtimeVersion: '1.0.0', capabilities: ['workspace.execute'],
    }, { db: rollback.db as never, now })).rejects.toThrow('forced write failure')
    expect(rollback.rows.has('linked_devices/device-a')).toBe(false)
  })

  it('allows only valid device lifecycle transitions by the owner', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
    })
    await transitionDeviceStatus({ deviceId: 'device-a', actorUserId: 'user-a', status: 'paused' }, { db: db as never, now })
    expect(rows.get('linked_devices/device-a')).toMatchObject({ status: 'paused', pausedAt: now() })
    await expect(transitionDeviceStatus({ deviceId: 'device-a', actorUserId: 'user-b', status: 'revoked' }, { db: db as never, now }))
      .rejects.toThrow('device owner')
    await expect(transitionDeviceStatus({ deviceId: 'device-a', actorUserId: 'user-a', status: 'removed' }, { db: db as never, now }))
      .rejects.toThrow('invalid status transition')
  })

  it('lists only owner devices and persists only the allowlisted label', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', label: 'Old', platform: 'macos', architecture: 'arm64', runtimeVersion: '1', capabilities: [], status: 'active', credentialVersion: 1, createdAt: 'created', updatedAt: 'updated', lastSeenAt: null },
      'linked_devices/device-b': { deviceId: 'device-b', ownerUserId: 'owner-b', label: 'Other', platform: 'windows', architecture: 'x64', runtimeVersion: '1', capabilities: [], status: 'active', credentialVersion: 1, createdAt: 'created', updatedAt: 'updated', lastSeenAt: null },
    })
    await expect(listOwnedDevices('owner-a', { db: db as never })).resolves.toEqual([expect.objectContaining({ deviceId: 'device-a', label: 'Old' })])
    await updateOwnedDevice({ deviceId: 'device-a', actorUserId: 'owner-a', label: 'New', localPath: '/Users/private', credential: 'secret' } as never, { db: db as never, now })
    expect(rows.get('linked_devices/device-a')).toMatchObject({ label: 'New', updatedAt: now() })
    expect(rows.get('linked_devices/device-a')).not.toHaveProperty('localPath')
    expect(rows.get('linked_devices/device-a')).not.toHaveProperty('credential')
  })

  it('records server-controlled heartbeat freshness only for active devices', async () => {
    const { db, rows } = fakeDb({ 'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active' } })
    await recordDeviceHeartbeat({ deviceId: 'device-a', runtimeVersion: '2', capabilities: ['workspace.execute'], health: 'ok', lastSeenAt: 'attacker-time' } as never, { db: db as never, now })
    expect(rows.get('linked_devices/device-a')).toMatchObject({ lastSeenAt: now(), updatedAt: now(), runtimeVersion: '2', health: 'ok' })
    rows.set('linked_devices/device-a', { ...rows.get('linked_devices/device-a'), status: 'paused' })
    await expect(recordDeviceHeartbeat({ deviceId: 'device-a', runtimeVersion: '3', capabilities: [], health: 'ok' }, { db: db as never, now })).rejects.toThrow('active device')
  })

  it('requires owner membership for active grants but lets current admins contain an existing grant after membership loss', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'orgMembers/org-a_admin': { orgId: 'org-a', uid: 'admin', role: 'admin', status: 'active' },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
    })
    await putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'active', capabilities: ['workspace.execute'] }, { db: db as never, now })
    expect(rows.get('linked_device_grants/org-a_device-a')).toMatchObject({ orgId: 'org-a', deviceId: 'device-a', status: 'active' })
    rows.delete('orgMembers/org-a_user-a')
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'paused', capabilities: [] }, { db: db as never, now })).resolves.toBeUndefined()
    expect(rows.get('linked_device_grants/org-a_device-a')).toMatchObject({ status: 'paused' })
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'active', capabilities: ['workspace.execute'] }, { db: db as never, now }))
      .rejects.toThrow('owner membership')
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'revoked', capabilities: [] }, { db: db as never, now })).resolves.toBeUndefined()
  })

  it.each(['pending', 'invited', 'suspended', 'revoked', 'deleted', 'inactive'])('denies %s memberships', async (status) => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'orgMembers/org-a_admin': { orgId: 'org-a', uid: 'admin', role: 'admin', status },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
    })
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'active', capabilities: [] }, { db: db as never, now }))
      .rejects.toThrow('active membership')
  })

  it('makes revoked grants terminal, preserves revokedAt, and audits both statuses', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'orgMembers/org-a_admin': { orgId: 'org-a', uid: 'admin', role: 'admin', status: 'active' },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active', createdAt: 'created' },
    })
    await putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'revoked', capabilities: [] }, { db: db as never, now })
    const revokedAt = rows.get('linked_device_grants/org-a_device-a')?.revokedAt
    expect([...rows.values()]).toContainEqual(expect.objectContaining({ action: 'grant.changed', fromStatus: 'active', toStatus: 'revoked' }))
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'active', capabilities: [] }, { db: db as never, now }))
      .rejects.toThrow('invalid grant status transition')
    expect(rows.get('linked_device_grants/org-a_device-a')?.revokedAt).toBe(revokedAt)
  })

  it('supports multiple tenant-scoped Workspace mappings without storing local paths', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active' },
      'linked_device_grants/org-b_device-a': { deviceId: 'device-a', orgId: 'org-b', status: 'active' },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
      'orgMembers/org-b_user-a': { orgId: 'org-b', uid: 'user-a', status: 'active' },
      'org_workspaces/ws-org-a': { workspaceId: 'ws-org-a', orgId: 'org-a', status: 'active' },
      'org_workspaces/ws-org-b': { workspaceId: 'ws-org-b', orgId: 'org-b', status: 'active' },
    })
    for (const orgId of ['org-a', 'org-b']) {
      await putWorkspaceMapping({ mappingId: `map-${orgId}`, deviceId: 'device-a', orgId, workspaceId: `ws-${orgId}`, actorUserId: 'user-a', label: `${orgId} Workspace`, status: 'active' }, { db: db as never, now })
    }
    expect(rows.get('linked_device_workspace_mappings/map-org-a')).toMatchObject({ orgId: 'org-a', workspaceId: 'ws-org-a' })
    expect(rows.get('linked_device_workspace_mappings/map-org-b')).toMatchObject({ orgId: 'org-b', workspaceId: 'ws-org-b' })
    expect(JSON.stringify([...rows.values()])).not.toContain('/Users/')
  })

  it.each(['active', 'paused', 'removed'] as const)('restricts %s mapping mutation to the device owner even when explicitly shared', async (status) => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active', allowedUserIds: ['shared-a'] },
      'orgMembers/org-a_shared-a': { orgId: 'org-a', uid: 'shared-a', status: 'active' },
      'org_workspaces/ws-a': { workspaceId: 'ws-a', orgId: 'org-a', status: 'active' },
      ...(status === 'active' ? {} : { 'linked_device_workspace_mappings/map-a': { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'ws-a', label: 'Workspace', status: 'active' } }),
    })
    await expect(putWorkspaceMapping({ mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'ws-a', actorUserId: 'shared-a', label: 'Workspace', status }, { db: db as never, now }))
      .rejects.toThrow('device owner')
  })

  it('removes the device, credentials, mappings, and grants with per-entity cascade audits', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active' },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: 'hash', credentialVersion: 1, revokedAt: null },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active' },
      'linked_device_workspace_mappings/map-a': { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', status: 'active' },
    })
    await removeOwnedDevice({ deviceId: 'device-a', actorUserId: 'owner-a' }, { db: db as never, now })
    expect(rows.get('linked_devices/device-a')).toMatchObject({ status: 'removed' })
    expect(rows.get('linked_device_credentials/device-a')).toMatchObject({ revokedAt: now() })
    expect(rows.get('linked_device_grants/org-a_device-a')).toMatchObject({ status: 'revoked' })
    expect(rows.get('linked_device_workspace_mappings/map-a')).toMatchObject({ status: 'removed' })
    expect([...rows.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'credential.revoked', deviceId: 'device-a' }),
      expect.objectContaining({ action: 'grant.changed', deviceId: 'device-a', orgId: 'org-a', toStatus: 'revoked' }),
      expect.objectContaining({ action: 'mapping.changed', deviceId: 'device-a', mappingId: 'map-a', toStatus: 'removed' }),
    ]))
  })

  it('rolls back every removal mutation when a cascade audit write fails', async () => {
    const initial = {
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active' },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: 'hash', credentialVersion: 1, revokedAt: null },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active' },
      'linked_device_workspace_mappings/map-a': { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', status: 'active' },
    }
    const { db, rows } = fakeDb(initial, 'linked_computer_audit_events/')
    await expect(removeOwnedDevice({ deviceId: 'device-a', actorUserId: 'owner-a' }, { db: db as never, now })).rejects.toThrow('forced write failure')
    expect(Object.fromEntries(rows)).toEqual(initial)
  })

  it('rejects cross-tenant or inactive canonical Workspace bindings', async () => {
    const base = {
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active', allowedUserIds: [] },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
    }
    for (const workspace of [
      { workspaceId: 'ws-a', orgId: 'org-b', status: 'active' },
      { workspaceId: 'ws-a', orgId: 'org-a', status: 'inactive' },
    ]) {
      const { db } = fakeDb({ ...base, 'org_workspaces/ws-a': workspace })
      await expect(putWorkspaceMapping({ mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'ws-a', actorUserId: 'user-a', label: 'Workspace', status: 'active' }, { db: db as never, now }))
        .rejects.toThrow('canonical Workspace')
    }
  })

  it('makes removed mappings terminal and audits mapping status changes', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active', allowedUserIds: [] },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
      'org_workspaces/ws-a': { workspaceId: 'ws-a', orgId: 'org-a', status: 'active' },
      'linked_device_workspace_mappings/map-a': { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'ws-a', status: 'active', createdAt: 'created' },
    })
    const request = { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'ws-a', actorUserId: 'user-a', label: 'Workspace' }
    await putWorkspaceMapping({ ...request, status: 'removed' }, { db: db as never, now })
    const removedAt = rows.get('linked_device_workspace_mappings/map-a')?.removedAt
    expect([...rows.values()]).toContainEqual(expect.objectContaining({ action: 'mapping.changed', fromStatus: 'active', toStatus: 'removed' }))
    await expect(putWorkspaceMapping({ ...request, status: 'active' }, { db: db as never, now })).rejects.toThrow('invalid mapping status transition')
    expect(rows.get('linked_device_workspace_mappings/map-a')?.removedAt).toBe(removedAt)
  })

  it('denies cross-tenant access and immediately reflects membership loss', () => {
    const device = { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' as const }
    const grant = { deviceId: 'device-a', orgId: 'org-a', status: 'active' as const, allowedUserIds: [] }
    expect(() => assertDeviceOrgAccess({ actorUserId: 'user-a', orgId: 'org-b', device, grant, membership: { orgId: 'org-b', userId: 'user-a', active: true } }))
      .toThrow('tenant scope')
    expect(() => assertDeviceOrgAccess({ actorUserId: 'user-a', orgId: 'org-a', device, grant, membership: { orgId: 'org-a', userId: 'user-a', active: false } }))
      .toThrow('active membership')
  })
})
