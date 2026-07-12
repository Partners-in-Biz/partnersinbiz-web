import {
  consumePairingChallenge,
  createDevice,
  createPairingChallenge,
  putDeviceGrant,
  putWorkspaceMapping,
  transitionDeviceStatus,
} from '@/lib/linked-computers/store'
import { assertDeviceOrgAccess } from '@/lib/linked-computers/policy'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! })
  const db = {
    collection: jest.fn((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending = new Map(rows)
      const result = await fn({
      get: async (document: { path: string }) => ({
        exists: pending.has(document.path),
        data: () => pending.get(document.path),
      }),
      create: (document: { path: string }, value: Row) => {
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
      deviceId: 'device-a', ownerUserId: 'user-a', runtimeTargetId: 'target-a',
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
    const { db, rows } = fakeDb()
    const challenge = await createPairingChallenge({
      challengeId: 'challenge-a', ownerUserId: 'user-a', secret: 'human-code', expiresAt: '2026-07-12T10:05:00.000Z',
    }, { db: db as never, now })
    expect(challenge).toEqual({ challengeId: 'challenge-a', expiresAt: '2026-07-12T10:05:00.000Z' })
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).not.toHaveProperty('secret')

    await consumePairingChallenge({ challengeId: 'challenge-a', ownerUserId: 'user-a', secret: 'human-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:01:00.000Z'),
    })
    await expect(consumePairingChallenge({ challengeId: 'challenge-a', ownerUserId: 'user-a', secret: 'human-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:02:00.000Z'),
    })).rejects.toThrow('already consumed')
  })

  it('persists failed pairing attempts before denying the exchange', async () => {
    const { db, rows } = fakeDb()
    await createPairingChallenge({
      challengeId: 'challenge-a', ownerUserId: 'user-a', secret: 'right-code', expiresAt: '2026-07-12T10:05:00.000Z',
    }, { db: db as never, now })
    await expect(consumePairingChallenge({ challengeId: 'challenge-a', ownerUserId: 'user-a', secret: 'wrong-code' }, {
      db: db as never, now, nowMs: () => Date.parse('2026-07-12T10:01:00.000Z'),
    })).rejects.toThrow('invalid pairing secret')
    expect(rows.get('linked_device_pairing_challenges/challenge-a')).toMatchObject({ attempts: 1 })
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

  it('requires current org membership to create or change an organisation grant', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'orgMembers/org-a_admin': { orgId: 'org-a', uid: 'admin', role: 'admin', status: 'active' },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
    })
    await putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'active', capabilities: ['workspace.execute'] }, { db: db as never, now })
    expect(rows.get('linked_device_grants/org-a_device-a')).toMatchObject({ orgId: 'org-a', deviceId: 'device-a', status: 'active' })
    rows.delete('orgMembers/org-a_user-a')
    await expect(putDeviceGrant({ deviceId: 'device-a', orgId: 'org-a', actorUserId: 'admin', status: 'paused', capabilities: [] }, { db: db as never, now }))
      .rejects.toThrow('owner membership')
  })

  it('supports multiple tenant-scoped Workspace mappings without storing local paths', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active' },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active' },
      'linked_device_grants/org-b_device-a': { deviceId: 'device-a', orgId: 'org-b', status: 'active' },
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
      'orgMembers/org-b_user-a': { orgId: 'org-b', uid: 'user-a', status: 'active' },
    })
    for (const orgId of ['org-a', 'org-b']) {
      await putWorkspaceMapping({ mappingId: `map-${orgId}`, deviceId: 'device-a', orgId, workspaceId: `ws-${orgId}`, actorUserId: 'user-a', label: `${orgId} Workspace`, status: 'active' }, { db: db as never, now })
    }
    expect(rows.get('linked_device_workspace_mappings/map-org-a')).toMatchObject({ orgId: 'org-a', workspaceId: 'ws-org-a' })
    expect(rows.get('linked_device_workspace_mappings/map-org-b')).toMatchObject({ orgId: 'org-b', workspaceId: 'ws-org-b' })
    expect(JSON.stringify([...rows.values()])).not.toContain('/Users/')
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
