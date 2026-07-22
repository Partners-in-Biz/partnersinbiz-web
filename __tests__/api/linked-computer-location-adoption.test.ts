import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  createPairing,
  exchangePairing,
  adoptLegacyLocationOntoLinkedDevice,
  projectLocationAdoptionFitsTransaction,
  projectLocationAdoptionWriteCount,
  type LinkedComputerPairingDb,
} from '@/lib/linked-computers/crypto'
import { scopedProjectReplicaId } from '@/lib/project-locations/model'

type Row = Record<string, unknown>
type Ref = { path: string; id: string }
type Query = { collectionPath: string; clauses: Array<{ field: string; value: unknown }> }

function fakeDb(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string): Ref => ({ path, id: path.split('/').at(-1)! })
  let transactionTail = Promise.resolve()
  const runTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const previous = transactionTail
    let release!: () => void
    transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const pending = new Map(rows)
      let hasWritten = false
      const result = await fn({
        get: async (target: Ref | Query) => {
          if (hasWritten) throw new Error('firestore: reads must precede writes')
          if ('collectionPath' in target) {
            const prefix = `${target.collectionPath}/`
            const docs = [...pending.entries()].flatMap(([path, value]) => {
              if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) return []
              const matches = target.clauses.every(({ field, value: expected }) => value[field] === expected)
              return matches ? [{ id: path.slice(prefix.length), ref: ref(path), data: () => value }] : []
            })
            return { docs }
          }
          return { exists: pending.has(target.path), id: target.id, ref: target, data: () => pending.get(target.path) }
        },
        create: (document: Ref, value: Row) => {
          hasWritten = true
          if (pending.has(document.path)) throw new Error('already exists')
          pending.set(document.path, value)
        },
        update: (document: Ref, value: Row) => {
          hasWritten = true
          if (!pending.has(document.path)) throw new Error('missing')
          pending.set(document.path, { ...pending.get(document.path), ...value })
        },
      })
      rows.clear(); pending.forEach((value, key) => rows.set(key, value))
      return result
    } finally {
      release()
    }
  })
  const db = {
    collection: jest.fn((name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, _operator: string, value: unknown): Query => ({
        collectionPath: name,
        clauses: [{ field, value }],
      }),
    })),
    runTransaction,
  }
  return { db: db as unknown as LinkedComputerPairingDb, rows }
}

const nowMs = Date.parse('2026-07-14T10:00:00.000Z')
const now = () => 'SERVER_TIME'

function machine() {
  const keys = generateKeyPairSync('ed25519')
  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function proof(
  privateKey: ReturnType<typeof machine>['privateKey'],
  challengeId: string,
  secret: string,
  deviceId: string,
  publicKey: string,
) {
  return sign(
    null,
    Buffer.from(`${challengeId}\n${secret}\n${deviceId}\n${publicKey.trim()}`),
    privateKey,
  ).toString('base64url')
}

function orgAdoptionSeed(overrides: Record<string, Row> = {}): Record<string, Row> {
  return {
    'orgMembers/org-a_admin-a': {
      orgId: 'org-a', uid: 'admin-a', role: 'admin', status: 'active',
    },
    'org_workspaces/workspace-a': {
      workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme', status: 'active',
    },
    'project_execution_locations/partners-vps': {
      locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', runtimeTargetId: 'vps',
      owner: { type: 'organization', orgId: 'org-a' }, visibility: 'organization', allowedOrgIds: ['org-a'],
      status: 'active', availability: 'online', verificationStatus: 'verified',
      mappings: [{ mappingId: 'partners-vps-workspace', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }],
      createdAt: 'OLD_TIME', updatedAt: 'OLD_TIME',
    },
    'project_location_replicas/legacy-replica-a': {
      replicaId: 'legacy-replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'partners-vps', locationLabel: 'Partners VPS', locationKind: 'vps', locationPlatform: 'linux',
      locationOwner: { type: 'organization', orgId: 'org-a' }, locationVisibility: 'organization',
      mappingId: 'partners-vps-workspace', relativePath: 'projects/project-a', availability: 'online',
      desiredRevision: 'rev-a', currentRevision: 'rev-a', syncStatus: 'synced', isCanonical: true,
      lastSync: { revision: 'rev-a' }, lastError: null, lastConflict: null, active: true,
      linkedByUserId: 'admin-a', createdAt: 'OLD_TIME', updatedAt: 'OLD_TIME',
    },
    'projects/project-a': {
      name: 'Project A', orgId: 'org-a', executionLocationIds: ['partners-vps', 'other-location'],
      canonicalLocationId: 'partners-vps', setupState: 'ready',
    },
    ...overrides,
  }
}

function adoptionInput(
  pairing: { challengeId: string; secret: string },
  keys: ReturnType<typeof machine>,
  deviceId = 'native-vps-a',
) {
  return {
    challengeId: pairing.challengeId,
    secret: pairing.secret,
    deviceId,
    publicKey: keys.publicKey,
    proof: proof(keys.privateKey, pairing.challengeId, pairing.secret, deviceId, keys.publicKey),
    label: 'Native Partners VPS',
    platform: 'linux' as const,
    architecture: 'x64' as const,
    runtimeVersion: '1.2.0',
  }
}

describe('legacy execution-location adoption during authenticated pairing', () => {
  it('binds an authorized legacy location to the challenge without changing location state', async () => {
    const { db, rows } = fakeDb(orgAdoptionSeed())
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db, now, nowMs: () => nowMs })

    expect(pairing).toMatchObject({
      adoption: { sourceLocationId: 'partners-vps', state: 'awaiting_runtime_proof' },
    })
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)).toMatchObject({
      adoptLocationId: 'partners-vps', ownerOrgId: 'org-a', ownerType: 'organization', deviceKind: 'vps',
    })
    expect(rows.get('project_execution_locations/partners-vps')).toMatchObject({ status: 'active' })
    expect(rows.has('linked_devices/native-vps-a')).toBe(false)
  })

  it('atomically creates native bindings, rebinds replicas, and retires the legacy location after proof', async () => {
    const { db, rows } = fakeDb(orgAdoptionSeed())
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db, now, nowMs: () => nowMs })
    const keys = machine()
    const result = await exchangePairing(adoptionInput(pairing, keys), { db, now, nowMs: () => nowMs + 1 })
    const nativeLocationId = 'linked-device:native-vps-a'
    const nativeReplicaId = scopedProjectReplicaId({
      projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: nativeLocationId, mappingId: 'partners-vps-workspace',
    })

    expect(result).toMatchObject({ deviceId: 'native-vps-a', credentialVersion: 1 })
    expect(rows.get('linked_devices/native-vps-a')).toMatchObject({
      ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      runtimeTargetId: 'linked-device:native-vps-a', status: 'active',
    })
    expect(rows.get('linked_device_grants/org-a_native-vps-a')).toMatchObject({
      deviceId: 'native-vps-a', orgId: 'org-a', accessMode: 'organization', status: 'active',
    })
    expect(rows.get('linked_device_workspace_mappings/partners-vps-workspace')).toMatchObject({
      deviceId: 'native-vps-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'pending',
    })
    expect(rows.get(`project_execution_locations/${nativeLocationId}`)).toMatchObject({
      locationId: nativeLocationId, adoptedFromLocationId: 'partners-vps', status: 'active',
      availability: 'offline', verificationStatus: 'pending',
    })
    expect(rows.get('project_execution_locations/partners-vps')).toMatchObject({
      status: 'retired', availability: 'offline', replacedByLocationId: nativeLocationId,
      adoptedDeviceId: 'native-vps-a',
    })
    expect(rows.get('project_location_replicas/legacy-replica-a')).toMatchObject({
      active: false, replacedByReplicaId: nativeReplicaId,
    })
    expect(rows.get(`project_location_replicas/${nativeReplicaId}`)).toMatchObject({
      replicaId: nativeReplicaId, projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: nativeLocationId, mappingId: 'partners-vps-workspace', relativePath: 'projects/project-a',
      desiredRevision: 'rev-a', currentRevision: 'rev-a', isCanonical: true, active: true,
      availability: 'offline', syncStatus: 'offline', adoptedFromReplicaId: 'legacy-replica-a',
    })
    expect(rows.get('projects/project-a')).toMatchObject({
      executionLocationIds: ['other-location', nativeLocationId],
      canonicalLocationId: nativeLocationId,
      setupState: 'sync_pending',
    })
  })

  it('allows an active legacy owner project only when no canonical organisation row exists', async () => {
    const fixture = fakeDb(orgAdoptionSeed())
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: fixture.db, now, nowMs: () => nowMs })
    const keys = machine()

    await expect(exchangePairing(adoptionInput(pairing, keys), {
      db: fixture.db, now, nowMs: () => nowMs + 1,
    })).resolves.toMatchObject({ deviceId: 'native-vps-a' })
  })

  it('allows an identical successful adoption exchange retry without duplicating state or credentials', async () => {
    const { db, rows } = fakeDb(orgAdoptionSeed())
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db, now, nowMs: () => nowMs })
    const keys = machine()
    const input = adoptionInput(pairing, keys)

    const [first, retry] = await Promise.all([
      exchangePairing(input, { db, now, nowMs: () => nowMs + 1 }),
      exchangePairing(input, { db, now, nowMs: () => nowMs + 2 }),
    ])

    expect(retry).toEqual(first)
    expect([...rows.keys()].filter((key) => key.startsWith('linked_devices/'))).toEqual(['linked_devices/native-vps-a'])
    expect([...rows.values()].filter((row) => row.action === 'device.paired')).toHaveLength(1)
  })

  it('preserves multiple organisation mappings when the current user adopts a private Mac', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
      'orgMembers/org-b_user-a': { orgId: 'org-b', uid: 'user-a', role: 'member', status: 'active' },
      'org_workspaces/workspace-a': { workspaceId: 'workspace-a', orgId: 'org-a', status: 'active' },
      'org_workspaces/workspace-b': { workspaceId: 'workspace-b', orgId: 'org-b', status: 'active' },
      'project_execution_locations/peets-mac': {
        locationId: 'peets-mac', label: "Peet's Mac", kind: 'computer', platform: 'macos', runtimeTargetId: 'local',
        owner: { type: 'user', userId: 'user-a' }, visibility: 'private', allowedOrgIds: ['org-a', 'org-b'],
        status: 'active', availability: 'offline', verificationStatus: 'verified',
        mappings: [
          { mappingId: 'mapping-org-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
          { mappingId: 'mapping-org-b', orgId: 'org-b', workspaceId: 'workspace-b', status: 'active' },
        ],
      },
      'project_location_replicas/private-replica-a': {
        replicaId: 'private-replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
        locationId: 'peets-mac', locationLabel: "Peet's Mac", locationKind: 'computer', locationPlatform: 'macos',
        locationOwner: { type: 'user', userId: 'user-a' }, locationVisibility: 'private', mappingId: 'mapping-org-a',
        relativePath: 'projects/project-a', availability: 'offline', desiredRevision: null, currentRevision: null,
        syncStatus: 'offline', active: true, linkedByUserId: 'user-a', isCanonical: false,
      },
      'project_location_replicas/private-replica-b': {
        replicaId: 'private-replica-b', projectId: 'project-b', orgId: 'org-b', workspaceId: 'workspace-b',
        locationId: 'peets-mac', locationLabel: "Peet's Mac", locationKind: 'computer', locationPlatform: 'macos',
        locationOwner: { type: 'user', userId: 'user-a' }, locationVisibility: 'private', mappingId: 'mapping-org-b',
        relativePath: 'projects/project-b', availability: 'offline', desiredRevision: null, currentRevision: null,
        syncStatus: 'offline', active: true, linkedByUserId: 'user-a', isCanonical: false,
      },
      'projects/project-a': { name: 'Project A', executionLocationIds: ['peets-mac'], canonicalLocationId: null },
      'projects/project-b': { name: 'Project B', executionLocationIds: ['peets-mac'], canonicalLocationId: null },
      'projectOrganizations/project-a_org-a': { projectId: 'project-a', orgId: 'org-a', status: 'active' },
      'projectOrganizations/project-b_org-b': { projectId: 'project-b', orgId: 'org-b', status: 'active' },
    })
    const pairing = await createPairing({
      actorUserId: 'user-a', ownerType: 'user', deviceKind: 'computer', adoptLocationId: 'peets-mac',
    }, { db, now, nowMs: () => nowMs })
    const keys = machine()
    const deviceId = 'native-mac-a'
    const input = {
      challengeId: pairing.challengeId,
      secret: pairing.secret,
      deviceId,
      publicKey: keys.publicKey,
      proof: proof(keys.privateKey, pairing.challengeId, pairing.secret, deviceId, keys.publicKey),
      label: "Peet's Mac",
      platform: 'macos' as const,
      architecture: 'arm64' as const,
      runtimeVersion: '1.2.0',
    }

    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).resolves.toMatchObject({ deviceId })
    expect(rows.get(`linked_devices/${deviceId}`)).toMatchObject({
      ownerType: 'user', ownerUserId: 'user-a', deviceKind: 'computer', adoptedFromLocationId: 'peets-mac',
    })
    expect(rows.get(`linked_device_grants/org-a_${deviceId}`)).toMatchObject({ accessMode: 'owner', status: 'active' })
    expect(rows.get(`linked_device_grants/org-b_${deviceId}`)).toMatchObject({ accessMode: 'owner', status: 'active' })
    expect(rows.get('linked_device_workspace_mappings/mapping-org-a')).toMatchObject({
      deviceId, orgId: 'org-a', workspaceId: 'workspace-a', status: 'pending',
    })
    expect(rows.get('linked_device_workspace_mappings/mapping-org-b')).toMatchObject({
      deviceId, orgId: 'org-b', workspaceId: 'workspace-b', status: 'pending',
    })
  })

  it('requires canonical ownership, administrator membership, and exact kind compatibility', async () => {
    const memberDb = fakeDb(orgAdoptionSeed({
      'orgMembers/org-a_admin-a': { orgId: 'org-a', uid: 'admin-a', role: 'member', status: 'active' },
    })).db
    await expect(createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: memberDb, now, nowMs: () => nowMs })).rejects.toThrow('organisation administrator required')

    const wrongKindDb = fakeDb(orgAdoptionSeed()).db
    await expect(createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'computer',
      adoptLocationId: 'partners-vps',
    }, { db: wrongKindDb, now, nowMs: () => nowMs })).rejects.toThrow('device kind mismatch')

    const privateDb = fakeDb({
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'member', status: 'active' },
      'org_workspaces/workspace-a': { workspaceId: 'workspace-a', orgId: 'org-a', status: 'active' },
      'project_execution_locations/peets-mac': {
        locationId: 'peets-mac', label: "Peet's Mac", kind: 'computer', platform: 'macos', runtimeTargetId: 'local',
        owner: { type: 'user', userId: 'somebody-else' }, visibility: 'private', allowedOrgIds: ['org-a'],
        status: 'active', availability: 'offline', verificationStatus: 'verified',
        mappings: [{ mappingId: 'partners-mac-workspace', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }],
      },
    }).db
    await expect(createPairing({
      actorUserId: 'user-a', ownerType: 'user', deviceKind: 'computer', adoptLocationId: 'peets-mac',
    }, { db: privateDb, now, nowMs: () => nowMs })).rejects.toThrow('location owner required')
  })

  it('rejects a changed or already-adopted location before any native state is created', async () => {
    const fixture = fakeDb(orgAdoptionSeed())
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: fixture.db, now, nowMs: () => nowMs })
    fixture.rows.set('project_execution_locations/partners-vps', {
      ...fixture.rows.get('project_execution_locations/partners-vps'),
      mappings: [{ mappingId: 'changed-mapping', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }],
    })
    const keys = machine()
    await expect(exchangePairing(adoptionInput(pairing, keys), {
      db: fixture.db, now, nowMs: () => nowMs + 1,
    })).rejects.toThrow('pairing exchange denied')
    expect(fixture.rows.has('linked_devices/native-vps-a')).toBe(false)

    const adoptedDb = fakeDb(orgAdoptionSeed({
      'project_execution_locations/partners-vps': {
        ...orgAdoptionSeed()['project_execution_locations/partners-vps'],
        status: 'retired', replacedByLocationId: 'linked-device:already-native',
      },
    })).db
    await expect(createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: adoptedDb, now, nowMs: () => nowMs })).rejects.toThrow('location is not adoptable')
  })

  it('blocks adoption while an affected project has nonterminal sync work', async () => {
    const headId = `head_${createHash('sha256').update('org-a\0project-a').digest('hex').slice(0, 40)}`
    const fixture = fakeDb(orgAdoptionSeed({
      [`project_sync_heads/${headId}`]: {
        orgId: 'org-a', projectId: 'project-a', requestId: 'sync-a', status: 'pending_inventory',
      },
      'project_sync_requests/sync-a': {
        requestId: 'sync-a', orgId: 'org-a', projectId: 'project-a', status: 'pending_inventory',
      },
    }))
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: fixture.db, now, nowMs: () => nowMs })
    const keys = machine()

    await expect(exchangePairing(adoptionInput(pairing, keys), {
      db: fixture.db, now, nowMs: () => nowMs + 1,
    })).rejects.toThrow('active sync work')
    expect(fixture.rows.get('project_execution_locations/partners-vps')).toMatchObject({ status: 'active' })
    expect(fixture.rows.has('linked_devices/native-vps-a')).toBe(false)
  })

  it.each([
    ['revoked project organisation link', {
      'projectOrganizations/project-a_org-a': { projectId: 'project-a', orgId: 'org-a', status: 'revoked' },
    }],
    ['mismatched project organisation link', {
      'projectOrganizations/project-a_org-a': { projectId: 'project-b', orgId: 'org-a', status: 'active' },
    }],
    ['wrong legacy project organisation', {
      'projects/project-a': { ...orgAdoptionSeed()['projects/project-a'], orgId: 'org-b' },
    }],
    ['inactive project', { 'projects/project-a': { ...orgAdoptionSeed()['projects/project-a'], active: false } }],
    ['archived project', { 'projects/project-a': { ...orgAdoptionSeed()['projects/project-a'], archived: true } }],
    ['deleted project', { 'projects/project-a': { ...orgAdoptionSeed()['projects/project-a'], deleted: true } }],
  ])('rejects adoption for a stale replica with %s', async (_label, overrides) => {
    const fixture = fakeDb(orgAdoptionSeed(overrides as Record<string, Row>))
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
      adoptLocationId: 'partners-vps',
    }, { db: fixture.db, now, nowMs: () => nowMs })
    const keys = machine()

    await expect(exchangePairing(adoptionInput(pairing, keys), {
      db: fixture.db, now, nowMs: () => nowMs + 1,
    })).rejects.toThrow('pairing exchange denied')
    expect(fixture.rows.get('project_execution_locations/partners-vps')).toMatchObject({ status: 'active' })
    expect(fixture.rows.has('linked_devices/native-vps-a')).toBe(false)
    expect(fixture.rows.get('projects/project-a')).not.toMatchObject({ setupState: 'sync_pending' })
  })

  it('keeps adoption write budgets conservatively below the Firestore transaction ceiling', () => {
    expect(projectLocationAdoptionWriteCount({
      replicaCount: 190, mappingCount: 1, grantCount: 1, projectCount: 61,
    })).toBe(450)
    expect(projectLocationAdoptionFitsTransaction({
      replicaCount: 190, mappingCount: 1, grantCount: 1, projectCount: 61,
    })).toBe(true)
    expect(projectLocationAdoptionFitsTransaction({
      replicaCount: 190, mappingCount: 1, grantCount: 1, projectCount: 62,
    })).toBe(false)
  })
})

describe('adopt legacy location onto an already-paired linked device', () => {
  it('rebinds replicas onto the existing device without creating credentials', async () => {
    const { db, rows } = fakeDb({
      ...orgAdoptionSeed(),
      'linked_devices/native-vps-a': {
        deviceId: 'native-vps-a', deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a',
        createdByUserId: 'admin-a', runtimeTargetId: 'linked-device:native-vps-a',
        label: 'Partners VPS', platform: 'linux', architecture: 'x64', runtimeVersion: '1.2.0',
        status: 'active', credentialVersion: 1, lastSeenAt: 'SEEN',
      },
    })

    const result = await adoptLegacyLocationOntoLinkedDevice({
      actorUserId: 'admin-a',
      deviceId: 'native-vps-a',
      adoptLocationId: 'partners-vps',
    }, { db, now, nowMs: () => nowMs })

    const nativeLocationId = 'linked-device:native-vps-a'
    const nativeReplicaId = scopedProjectReplicaId({
      projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: nativeLocationId, mappingId: 'partners-vps-workspace',
    })
    expect(result).toMatchObject({
      deviceId: 'native-vps-a',
      nativeLocationId,
      adoptedFromLocationId: 'partners-vps',
      replicaCount: 1,
    })
    expect(rows.get('linked_devices/native-vps-a')).toMatchObject({
      adoptedFromLocationId: 'partners-vps',
    })
    expect(rows.get(`project_execution_locations/${nativeLocationId}`)).toMatchObject({
      nativeDeviceId: 'native-vps-a', adoptedFromLocationId: 'partners-vps', status: 'active',
    })
    expect(rows.get('project_execution_locations/partners-vps')).toMatchObject({
      status: 'retired', replacedByLocationId: nativeLocationId, adoptedDeviceId: 'native-vps-a',
    })
    expect(rows.get('project_location_replicas/legacy-replica-a')).toMatchObject({
      active: false, replacedByReplicaId: nativeReplicaId,
    })
    expect(rows.get(`project_location_replicas/${nativeReplicaId}`)).toMatchObject({
      locationId: nativeLocationId, active: true, adoptedFromReplicaId: 'legacy-replica-a',
    })
    expect(rows.get('linked_device_grants/org-a_native-vps-a')).toMatchObject({
      deviceId: 'native-vps-a', orgId: 'org-a', status: 'active',
    })
    expect(rows.get('linked_device_workspace_mappings/partners-vps-workspace')).toMatchObject({
      deviceId: 'native-vps-a', status: 'pending',
    })
    expect([...rows.values()].some((row) => row.action === 'location.adopted')).toBe(true)
  })

  it('is idempotent when the native location already replaced the legacy row', async () => {
    const nativeLocationId = 'linked-device:native-vps-a'
    const { db } = fakeDb({
      'orgMembers/org-a_admin-a': { orgId: 'org-a', uid: 'admin-a', role: 'admin', status: 'active' },
      'linked_devices/native-vps-a': {
        deviceId: 'native-vps-a', deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a',
        createdByUserId: 'admin-a', runtimeTargetId: nativeLocationId, platform: 'linux',
        status: 'active', adoptedFromLocationId: 'partners-vps',
      },
      'project_execution_locations/partners-vps': {
        locationId: 'partners-vps', status: 'retired', replacedByLocationId: nativeLocationId,
      },
      [`project_execution_locations/${nativeLocationId}`]: {
        locationId: nativeLocationId, nativeDeviceId: 'native-vps-a', adoptedFromLocationId: 'partners-vps',
        status: 'active',
      },
    })

    await expect(adoptLegacyLocationOntoLinkedDevice({
      actorUserId: 'admin-a',
      deviceId: 'native-vps-a',
      adoptLocationId: 'partners-vps',
    }, { db, now, nowMs: () => nowMs })).resolves.toMatchObject({
      alreadyAdopted: true,
      nativeLocationId,
    })
  })
})
