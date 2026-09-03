import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { authenticateDeviceRequest, deviceRequestPayload } from '@/lib/linked-computers/device-auth'
import { acknowledgeDeviceRotation, claimPendingDeviceRotation, removeOwnedDevice, rotateDeviceCredential, revokeDeviceCredential, toSafeLinkedDeviceDto, transitionDeviceStatus } from '@/lib/linked-computers/store'
import { NextRequest } from 'next/server'
import { handleLinkedComputerList } from '@/app/api/v1/linked-computers/route'
import { handleDeviceHeartbeat } from '@/app/api/v1/linked-computers/[deviceId]/heartbeat/route'
import { handleDeviceGrant } from '@/app/api/v1/linked-computers/[deviceId]/grants/route'
import { handleDeviceMapping } from '@/app/api/v1/linked-computers/[deviceId]/mappings/route'
import { handleLinkedComputerUpdate } from '@/app/api/v1/linked-computers/[deviceId]/route'
import { handleLinkedComputerRemove } from '@/app/api/v1/linked-computers/[deviceId]/route'
import { handleCredentialRotation } from '@/app/api/v1/linked-computers/[deviceId]/credentials/rotate/route'
import { handleRotationAck } from '@/app/api/v1/linked-computers/[deviceId]/credentials/rotation/ack/route'
import * as linkedComputerCollectionRoute from '@/app/api/v1/linked-computers/route'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row>) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! })
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, _op: string, value: unknown) => ({ collection: name, field, value }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => fn({
      get: async (document: { path?: string; collection?: string; field?: string; value?: unknown }) => document.collection
        ? ({ docs: [...rows.entries()].filter(([path, row]) => path.startsWith(`${document.collection}/`) && row[document.field!] === document.value).map(([path, row]) => ({ ref: ref(path), data: () => row })) })
        : ({ exists: rows.has(document.path!), data: () => rows.get(document.path!) }),
      create: (document: { path: string }, value: Row) => rows.set(document.path, value),
      set: (document: { path: string }, value: Row, options?: { merge?: boolean }) => rows.set(document.path, options?.merge ? { ...rows.get(document.path), ...value } : value),
      update: (document: { path: string }, value: Row) => rows.set(document.path, { ...rows.get(document.path), ...value }),
    }),
  }
  return { db, rows }
}

function request(credential: string, version: number, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], requestId: string, timestamp = '1000000', body = '{"health":"ok"}') {
  const base = { deviceId: 'device-a', credential, credentialVersion: version, timestamp, requestId, method: 'POST', path: '/api/v1/linked-computers/device-a/heartbeat', body }
  return { ...base, signature: sign(null, Buffer.from(deviceRequestPayload(base)), privateKey).toString('base64url') }
}

describe('linked computer credential lifecycle', () => {
  beforeAll(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'rotation-delivery-test-key' })
  it('allows the prior credential only during the server-controlled rotation overlap', async () => {
    const keys = generateKeyPairSync('ed25519')
    const oldCredential = randomBytes(32).toString('base64url')
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active', credentialVersion: 1, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: require('@/lib/linked-computers/crypto').hashLinkedComputerSecret(oldCredential), credentialVersion: 1, revokedAt: null },
    })
    const rotated = await rotateDeviceCredential({ deviceId: 'device-a', actorUserId: 'user-a' }, { db: db as never, now: () => 'now', nowMs: () => 1_000_000 })
    expect(rotated).toEqual(expect.objectContaining({ deviceId: 'device-a', credentialVersion: 2, status: 'pending', overlapExpiresAt: '1970-01-01T00:21:40.000Z' }))
    expect(rotated).not.toHaveProperty('credential')
    expect(rotated).not.toHaveProperty('transportToken')
    const claimed = await claimPendingDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 1 }, { db: db as never, now: () => 'claimed', nowMs: () => 1_000_001 })
    expect(claimed).toEqual({ rotationDeliveryId: expect.any(String), credential: expect.any(String), credentialVersion: 2 })
    await expect(claimPendingDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 1 }, { db: db as never, now: () => 'redelivered', nowMs: () => 1_000_002 })).resolves.toEqual(claimed)
    await expect(acknowledgeDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 1, rotationDeliveryId: claimed!.rotationDeliveryId }, { db: db as never, now: () => 'bad-ack', nowMs: () => 1_000_003 })).rejects.toThrow('new credential')
    await expect(acknowledgeDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 2, rotationDeliveryId: claimed!.rotationDeliveryId }, { db: db as never, now: () => 'acked', nowMs: () => 1_000_003 })).resolves.toEqual({ acknowledged: true, credentialVersion: 2 })
    await expect(acknowledgeDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 2, rotationDeliveryId: claimed!.rotationDeliveryId }, { db: db as never, now: () => 'acked-again', nowMs: () => 1_000_004 })).resolves.toEqual({ acknowledged: true, credentialVersion: 2 })
    await expect(claimPendingDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 1 }, { db: db as never, now: () => 'after-ack', nowMs: () => 1_000_003 })).resolves.toBeNull()
    await expect(authenticateDeviceRequest(request(oldCredential, 1, keys.privateKey, 'request-old-generic'), { db: db as never, nowMs: () => 1_000_001 })).rejects.toThrow('restricted')
    await expect(authenticateDeviceRequest(request(oldCredential, 1, keys.privateKey, 'request-old-valid', '1000000', '{"health":"ok","claimRotation":true}'), { db: db as never, nowMs: () => 1_000_001 })).resolves.toMatchObject({ credentialVersion: 1 })
    await expect(authenticateDeviceRequest(request(oldCredential, 1, keys.privateKey, 'request-old-expired', '1360001'), { db: db as never, nowMs: () => 1_360_001 })).rejects.toThrow('version mismatch')
    expect(rows.get('linked_devices/device-a')).toMatchObject({ credentialVersion: 2 })
  })

  it('revocation immediately denies both current and overlap credentials', async () => {
    const keys = generateKeyPairSync('ed25519')
    const credential = randomBytes(32).toString('base64url')
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'revoked', credentialVersion: 2, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: require('@/lib/linked-computers/crypto').hashLinkedComputerSecret(credential), credentialVersion: 2, revokedAt: null },
    })
    await revokeDeviceCredential({ deviceId: 'device-a', actorUserId: 'user-a' }, { db: db as never, now: () => 'now' })
    expect(rows.get('linked_device_credentials/device-a')).toMatchObject({ revokedAt: 'now' })
    await expect(authenticateDeviceRequest(request(credential, 2, keys.privateKey, 'request-revoked-now'), { db: db as never, nowMs: () => 1_000_000 })).rejects.toThrow(/active device|revoked/)
  })

  it('disallows rotation while paused and clears pending delivery on ordinary revoke transition', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'paused', credentialVersion: 1 },
      'linked_device_credentials/device-a': { credentialHash: 'hash', credentialVersion: 1, previousCredentialHash: 'old' },
      'linked_device_rotation_deliveries/device-a': { deviceId: 'device-a', encryptedCredential: { ciphertext: 'secret' } },
    })
    await expect(rotateDeviceCredential({ deviceId: 'device-a', actorUserId: 'user-a' }, { db: db as never })).rejects.toThrow('active device')
    await transitionDeviceStatus({ deviceId: 'device-a', actorUserId: 'user-a', status: 'revoked' }, { db: db as never, now: () => 'revoked-now' })
    expect(rows.get('linked_device_rotation_deliveries/device-a')).toMatchObject({ encryptedCredential: null, terminalState: 'revoked' })
    expect(rows.get('linked_device_credentials/device-a')).toMatchObject({ previousCredentialHash: null, previousCredentialVersion: null })
  })

  it('rejects expired or cleared unacknowledged rotation acknowledgments', async () => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active', credentialVersion: 2 },
      'linked_device_rotation_deliveries/device-a': { deviceId: 'device-a', rotationDeliveryId: 'delivery-a', credentialVersion: 2, expiresAt: '1970-01-01T00:00:01.000Z', encryptedCredential: null, acknowledgedAt: null, expiredAt: 'expired' },
    })
    await expect(acknowledgeDeviceRotation({ deviceId: 'device-a', authenticatedCredentialVersion: 2, rotationDeliveryId: 'delivery-a' }, { db: db as never, nowMs: () => 2_000 })).rejects.toThrow('expired')
  })
})

describe('linked computer lifecycle HTTP boundaries', () => {
  it('acks rotation only with the signed new-version device identity and exact delivery id', async () => {
    const acknowledge = jest.fn(async () => ({ acknowledged: true as const, credentialVersion: 2 }))
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/credentials/rotation/ack', { method: 'POST', body: '{"rotationDeliveryId":"delivery-123"}' })
    const response = await handleRotationAck(req, 'device-a', async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 2 }), acknowledge)
    expect(response.status).toBe(200)
    expect(acknowledge).toHaveBeenCalledWith({ deviceId: 'device-a', authenticatedCredentialVersion: 2, rotationDeliveryId: 'delivery-123' })
  })
  it('intentionally exposes no collection POST because pairing exchange is the sole secure creation route', () => {
    expect(linkedComputerCollectionRoute).not.toHaveProperty('POST')
  })

  it('returns exact browser-safe devices without paths, keys, URLs, or credentials', async () => {
    const safe = toSafeLinkedDeviceDto({
      deviceId: 'device-a', ownerUserId: 'user-a', runtimeTargetId: 'private-target', publicKeyFingerprint: 'private-fingerprint',
      label: 'Peet Mac', platform: 'macos', architecture: 'arm64', runtimeVersion: '1.0.0', capabilities: ['workspace.execute'],
      status: 'active', credentialVersion: 2, createdAt: 'created', updatedAt: 'updated', lastSeenAt: 'seen',
      health: 'ok',
      localPath: '/Users/peet/private', credential: 'secret', internalUrl: 'http://private',
    } as never)
    const response = await handleLinkedComputerList({ uid: 'user-a' }, async () => [safe])
    const json = await response.json()
    expect(Object.keys(json.data[0]).sort()).toEqual(['architecture', 'availableAgentIds', 'capabilities', 'createdAt', 'credentialVersion', 'desiredAgents', 'deviceId', 'deviceKind', 'grants', 'health', 'healthReason', 'hermesVersion', 'label', 'lastSeenAt', 'mappings', 'ownerType', 'platform', 'runtimeVersion', 'status', 'updatedAt'].sort())
    expect(JSON.stringify(json)).not.toMatch(/\/Users|private-target|fingerprint|secret|internalUrl/i)
  })

  it('binds grant and mapping mutations to the route device and authenticated actor', async () => {
    const grantPut = jest.fn(async () => undefined)
    const grantReq = new NextRequest('https://test/api/v1/linked-computers/device-a/grants', { method: 'PUT', body: JSON.stringify({ deviceId: 'device-b', orgId: 'org-a', status: 'active', allowedUserIds: ['user-b'] }) })
    expect((await handleDeviceGrant(grantReq, { uid: 'admin-a' }, 'device-a', grantPut)).status).toBe(200)
    expect(grantPut).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', actorUserId: 'admin-a', orgId: 'org-a', accessMode: 'selected_users', allowedUserIds: ['user-b'] }))

    const mappingPut = jest.fn(async () => undefined)
    const mappingReq = new NextRequest('https://test/api/v1/linked-computers/device-a/mappings', { method: 'PUT', body: JSON.stringify({ deviceId: 'device-b', mappingId: 'map-a', orgId: 'org-a', workspaceId: 'ws-a', label: 'Workspace', status: 'active', localPath: '/Users/escape' }) })
    expect((await handleDeviceMapping(mappingReq, { uid: 'user-a' }, 'device-a', mappingPut)).status).toBe(200)
    expect(mappingPut).toHaveBeenCalledWith(expect.not.objectContaining({ localPath: expect.anything() }))
  })

  it('accepts explicit organisation-wide grants and rejects unknown access modes', async () => {
    const put = jest.fn(async () => undefined)
    const shared = new NextRequest('https://test/api/v1/linked-computers/device-a/grants', { method: 'PUT', body: JSON.stringify({ orgId: 'org-a', status: 'active', accessMode: 'organization', allowedUserIds: ['ignored-user'] }) })
    expect((await handleDeviceGrant(shared, { uid: 'admin-a' }, 'device-a', put)).status).toBe(200)
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'organization', allowedUserIds: [] }))

    const invalid = new NextRequest('https://test/api/v1/linked-computers/device-a/grants', { method: 'PUT', body: JSON.stringify({ orgId: 'org-a', status: 'active', accessMode: 'public' }) })
    expect((await handleDeviceGrant(invalid, { uid: 'admin-a' }, 'device-a', put)).status).toBe(400)
  })

  it('PUT grants accepts teams mode with allowedTeamIds', async () => {
    const put = jest.fn(async () => undefined)
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/grants', {
      method: 'PUT',
      body: JSON.stringify({
        orgId: 'org-a',
        status: 'active',
        accessMode: 'teams',
        allowedTeamIds: ['org-a_sales'],
        allowedUserIds: ['user-b'],
      }),
    })
    expect((await handleDeviceGrant(req, { uid: 'admin-a' }, 'device-a', put)).status).toBe(200)
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      accessMode: 'teams',
      allowedTeamIds: ['org-a_sales'],
      allowedUserIds: ['user-b'],
    }))
  })

  it.each(['paused', 'active', 'revoked'] as const)('binds the %s device lifecycle transition to its owner', async (status) => {
    const update = jest.fn(async () => undefined)
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a', { method: 'PATCH', body: JSON.stringify({ deviceId: 'device-b', status }) })
    expect((await handleLinkedComputerUpdate(req, { uid: 'owner-a' }, 'device-a', update)).status).toBe(200)
    expect(update).toHaveBeenCalledWith({ deviceId: 'device-a', actorUserId: 'owner-a', status })
  })

  it('returns only browser-safe pending rotation status under no-store', async () => {
    const response = await handleCredentialRotation({ uid: 'owner-a' }, 'device-a', async () => ({ deviceId: 'device-a', status: 'pending' as const, credentialVersion: 2, overlapExpiresAt: 'expiry' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(Object.keys(body.data).sort()).toEqual(['credentialVersion', 'deviceId', 'overlapExpiresAt', 'status'].sort())
    expect(JSON.stringify(body)).not.toMatch(/one-time|transport-once/i)
  })

  it('binds DELETE removal to the route device and authenticated owner', async () => {
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active' },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: 'hash', credentialVersion: 1 },
      'linked_device_grants/org-a_device-a': { deviceId: 'device-a', orgId: 'org-a', status: 'active' },
      'linked_device_workspace_mappings/map-a': { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', status: 'active' },
    })
    const remove = jest.fn((input) => removeOwnedDevice(input, { db: db as never, now: () => 'server-time' }))
    const response = await handleLinkedComputerRemove({ uid: 'owner-a' }, 'device-a', remove, async () => ({ done: false, processed: 1, phase: 'mappings' }))
    expect(response.status).toBe(202)
    expect(remove).toHaveBeenCalledWith({ deviceId: 'device-a', actorUserId: 'owner-a' })
    expect(rows.get('linked_devices/device-a')).toMatchObject({ status: 'removed' })
    expect(rows.get('linked_device_credentials/device-a')).toMatchObject({ revokedAt: 'server-time' })
    expect(rows.get('linked_device_cleanup_runs/device-a')).toMatchObject({ status: 'pending', phase: 'mappings' })
  })

  it('authenticates heartbeat against the exact raw body and denies cross-device identity', async () => {
    const auth = jest.fn(async (_req, deviceId, rawBody) => ({ deviceId, ownerUserId: 'user-a', credentialVersion: 1, rawBody }))
    const record = jest.fn(async () => undefined)
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', { method: 'POST', body: '{"runtimeVersion":"1.2.3","health":"ok","capabilities":["workspace.execute"],"localPath":"/Users/private"}' })
    expect((await handleDeviceHeartbeat(req, 'device-a', auth as never, record)).status).toBe(200)
    expect(auth).toHaveBeenCalledWith(expect.anything(), 'device-a', expect.stringContaining('"localPath"'))
    expect(record).toHaveBeenCalledWith({ deviceId: 'device-a', runtimeVersion: '1.2.3', health: 'ok', capabilities: ['workspace.execute'], syncProtocolVersion: null, availableAgentIds: [], hermesVersion: null, healthReason: null })
    expect(record.mock.calls[0][0]).not.toHaveProperty('localPath')

    const denied = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', { method: 'POST', body: '{"runtimeVersion":"1","health":"ok"}' })
    const response = await handleDeviceHeartbeat(denied, 'device-a', async () => ({ deviceId: 'device-b', ownerUserId: 'user-b', credentialVersion: 1 }), record)
    expect(response.status).toBe(403)
  })

  it('attests workspace.sync independently only with the installed executor protocol version', async () => {
    const record = jest.fn(async () => undefined)
    const auth = async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 1 })
    const verified = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runtimeVersion: '2.0.0', health: 'ok', capabilities: ['workspace.sync'], syncProtocolVersion: 1 }),
    })
    expect((await handleDeviceHeartbeat(verified, 'device-a', auth, record)).status).toBe(200)
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ capabilities: ['workspace.sync'], syncProtocolVersion: 1 }))

    const legacyClaim = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runtimeVersion: '1.9.0', health: 'ok', capabilities: ['workspace.sync'] }),
    })
    expect((await handleDeviceHeartbeat(legacyClaim, 'device-a', auth, record)).status).toBe(200)
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ capabilities: [], syncProtocolVersion: null }))
  })

  it('returns ignoredProfiles from heartbeat inventory filtering', async () => {
    const record = jest.fn(async () => ({ ignoredProfiles: ['other--pip'] }))
    const auth = async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 1 })
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        runtimeVersion: '1.2.0',
        health: 'ok',
        availableAgentIds: ['partners--pip', 'other--pip'],
        availableProfiles: [
          { profile: 'partners--pip', orgId: 'org-a', agentId: 'pip', healthy: true, skillsDigest: 'aa' },
          { profile: 'other--pip', orgId: 'org-b', agentId: 'pip', healthy: true, skillsDigest: 'bb' },
        ],
      }),
    })
    const response = await handleDeviceHeartbeat(req, 'device-a', auth, record)
    expect(response.status).toBe(200)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      availableAgentIds: ['partners--pip', 'other--pip'],
      availableProfiles: [
        { profile: 'partners--pip', orgId: 'org-a', agentId: 'pip', healthy: true, skillsDigest: 'aa' },
        { profile: 'other--pip', orgId: 'org-b', agentId: 'pip', healthy: true, skillsDigest: 'bb' },
      ],
    }))
    expect((await response.json()).data.ignoredProfiles).toEqual(['other--pip'])
  })

  it('redelivers a pending rotation without a transport token to a signed previous-version heartbeat', async () => {
    const claim = jest.fn(async () => ({ rotationDeliveryId: 'delivery-1', credential: 'new-credential', credentialVersion: 2 }))
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', { method: 'POST', body: '{"runtimeVersion":"2.0.0","health":"ok","claimRotation":true}' })
    const response = await handleDeviceHeartbeat(req, 'device-a', async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 1 }), jest.fn(async () => undefined), claim)
    expect(claim).toHaveBeenCalledWith({ deviceId: 'device-a', authenticatedCredentialVersion: 1 })
    expect((await response.json()).data.rotation).toEqual({ rotationDeliveryId: 'delivery-1', credential: 'new-credential', credentialVersion: 2 })
  })

  it('rejects legacy runtime endpoint registration after signed device authentication', async () => {
    const auth = jest.fn(async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }))
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', { method: 'POST', body: '{"runtimeVersion":"2.0.0","health":"ok","runtimeEndpoint":"https://device.example"}' })
    const response = await handleDeviceHeartbeat(req, 'device-a', auth as never, jest.fn(async () => undefined))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('device.example')
  })

  it('rejects legacy transport bootstrap and never returns a token', async () => {
    const auth = jest.fn(async () => ({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }))
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/heartbeat', { method: 'POST', body: '{"runtimeVersion":"2.0.0","health":"ok","runtimeEndpoint":"https://device.example","bootstrapTransport":true}' })
    const response = await handleDeviceHeartbeat(req, 'device-a', auth as never, jest.fn(async () => undefined))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.status).toBe(400)
    expect(await response.text()).not.toMatch(/transportToken|returned-once|device.example/)
  })
})
