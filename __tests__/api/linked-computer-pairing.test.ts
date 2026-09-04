import { generateKeyPairSync, sign } from 'node:crypto'
import {
  createPairing,
  exchangePairing,
  hashLinkedComputerSecret,
  type LinkedComputerPairingDb,
} from '@/lib/linked-computers/crypto'
import { authenticateDeviceRequest, deviceRequestPayload } from '@/lib/linked-computers/device-auth'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! })
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
        get: async (document: { path: string }) => {
          if (hasWritten) throw new Error('firestore: reads must precede writes')
          return { exists: pending.has(document.path), data: () => pending.get(document.path) }
        },
        create: (document: { path: string }, value: Row) => {
          hasWritten = true
          if (pending.has(document.path)) throw new Error('already exists')
          pending.set(document.path, value)
        },
        update: (document: { path: string }, value: Row) => {
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
    collection: jest.fn((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })),
    runTransaction,
  }
  return { db: db as unknown as LinkedComputerPairingDb, rows }
}

const nowMs = Date.parse('2026-07-12T10:00:00.000Z')
const now = () => 'SERVER_TIME'

function machine() {
  const keys = generateKeyPairSync('ed25519')
  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function proof(privateKey: ReturnType<typeof machine>['privateKey'], challengeId: string, secret: string, deviceId: string, publicKey: string) {
  const payload = `${challengeId}\n${secret}\n${deviceId}\n${publicKey.trim()}`
  return sign(null, Buffer.from(payload), privateKey).toString('base64url')
}

describe('linked computer one-time pairing', () => {
  it('creates an owner-bound ten-minute challenge and persists only its secret hash', async () => {
    const { db, rows } = fakeDb()
    const result = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    expect(result.expiresAt).toBe('2026-07-12T10:10:00.000Z')
    expect(result.challengeId).toBeTruthy()
    expect(result.secret).toBeTruthy()
    expect(rows.get(`linked_device_pairing_challenges/${result.challengeId}`)).toMatchObject({
      ownerUserId: 'user-a', attempts: 0, maxAttempts: 5,
    })
    expect((rows.get(`linked_device_pairing_challenges/${result.challengeId}`)?.cleanupAt as { toMillis(): number }).toMillis()).toBe(nowMs + 10 * 60 * 1000)
    expect(rows.get(`linked_device_pairing_challenges/${result.challengeId}`)).not.toHaveProperty('secret')
    expect(JSON.stringify([...rows.values()])).not.toContain(result.secret)
  })

  it('denies expired challenges and persists at most five failed attempts', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: 'wrong', deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, 'wrong', 'device-a', m.publicKey), label: 'Mac', platform: 'macos' as const,
      architecture: 'arm64' as const, runtimeVersion: '1.0.0' }
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 10 * 60 * 1000 })).rejects.toThrow('expired')
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
      expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)?.attempts).toBe(attempt)
    }
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('attempts exhausted')
  })

  it('counts invalid proof and malformed payload failures without revealing which check failed', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine(); const attacker = machine()
    await expect(exchangePairing({
      challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(attacker.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey),
      label: 'Mac', platform: 'macos', architecture: 'arm64', runtimeVersion: '1.0.0',
    }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)?.attempts).toBe(1)
    await expect(exchangePairing({
      challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: '', proof: '',
      label: '', platform: 'linux' as never, architecture: 'x86' as never, runtimeVersion: '',
    }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)?.attempts).toBe(2)
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)).not.toHaveProperty('consumedAt')
    expect(rows.has('linked_devices/device-a')).toBe(false)
  })

  it('atomically consumes once, binds a new active device to the challenge owner, and returns one credential', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos' as const,
      architecture: 'arm64' as const, runtimeVersion: '1.0.0' }
    const result = await exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })
    expect(result).toMatchObject({ deviceId: 'device-a', credentialVersion: 1 })
    expect(Object.keys(result).sort()).toEqual(['credential', 'credentialVersion', 'deviceId', 'ownerUserId'])
    expect(result.ownerUserId).toBe('user-a')
    expect(result.credential).toBeTruthy()
    expect(rows.get('linked_devices/device-a')).toMatchObject({ ownerUserId: 'user-a', status: 'active', credentialVersion: 1 })
    expect(rows.get('linked_device_credentials/device-a')).not.toHaveProperty('credential')
    expect(rows.has('linked_device_runtime_transports/device-a')).toBe(false)
    expect(JSON.stringify([...rows.values()])).not.toContain(result.credential)
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 2 })).rejects.toThrow('already consumed')
  })

  it('enqueues install jobs for pip when the pairing challenge carries org and agents', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', role: 'owner' },
    })
    const pairing = await createPairing({
      actorUserId: 'user-a',
      orgId: 'org-a',
      agentIds: ['pip'],
    }, { db, now, nowMs: () => nowMs })
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)).toMatchObject({
      orgId: 'org-a',
      agentIds: ['pip'],
    })
    const m = machine()
    const provisionDesiredAgents = jest.fn().mockResolvedValue({ enqueuedJobIds: ['job-pip'] })
    const result = await exchangePairing({
      challengeId: pairing.challengeId,
      secret: pairing.secret,
      deviceId: 'device-a',
      publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey),
      label: 'Mac',
      platform: 'macos',
      architecture: 'arm64',
      runtimeVersion: '1.0.0',
    }, { db, now, nowMs: () => nowMs + 1, provisionDesiredAgents })
    expect(result.deviceId).toBe('device-a')
    expect(provisionDesiredAgents).toHaveBeenCalledWith({
      deviceId: 'device-a',
      actorUserId: 'user-a',
      orgId: 'org-a',
      desired: [{ agentId: 'pip', keepInSync: true }],
      enqueueJobs: true,
    })
    expect(rows.get('linked_devices/device-a')).not.toHaveProperty('provisioningSkippedReason')
  })

  it('skips provisioning when the pairing user is not an active org member', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({
      actorUserId: 'user-a',
      orgId: 'org-a',
      agentIds: ['pip'],
    }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const provisionDesiredAgents = jest.fn()
    await exchangePairing({
      challengeId: pairing.challengeId,
      secret: pairing.secret,
      deviceId: 'device-a',
      publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey),
      label: 'Mac',
      platform: 'macos',
      architecture: 'arm64',
      runtimeVersion: '1.0.0',
    }, { db, now, nowMs: () => nowMs + 1, provisionDesiredAgents })
    expect(provisionDesiredAgents).not.toHaveBeenCalled()
    expect(rows.get('linked_devices/device-a')).toMatchObject({
      provisioningSkippedReason: 'not_an_active_org_member',
    })
  })

  it('accepts the original runtime proof that included the PEM trailing newline', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const deviceId = 'original-runtime-mac'
    const originalRuntimeProof = sign(
      null,
      Buffer.from(`${pairing.challengeId}\n${pairing.secret}\n${deviceId}\n${m.publicKey}`),
      m.privateKey,
    ).toString('base64url')

    await expect(exchangePairing({
      challengeId: pairing.challengeId,
      secret: pairing.secret,
      deviceId,
      publicKey: m.publicKey,
      proof: originalRuntimeProof,
      label: 'Original Runtime Mac',
      platform: 'macos',
      architecture: 'arm64',
      runtimeVersion: '1.1.0',
    }, { db, now, nowMs: () => nowMs + 1 })).resolves.toMatchObject({ deviceId })
    expect(rows.get(`linked_devices/${deviceId}`)?.publicKey).toBe(m.publicKey.trim())
  })

  it('pairs a Linux runtime with explicit backward-compatible user ownership metadata', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'vps-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'vps-a', m.publicKey), label: 'Partners VPS', platform: 'linux' as const,
      architecture: 'x64' as const, runtimeVersion: '1.0.0' }

    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).resolves.toMatchObject({ deviceId: 'vps-a' })
    expect(rows.get('linked_devices/vps-a')).toMatchObject({
      ownerType: 'user', ownerUserId: 'user-a', createdByUserId: 'user-a', platform: 'linux', status: 'active',
    })
  })

  it('pairs an organisation-owned VPS with sync capability and an organisation-wide grant', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_admin-a': { orgId: 'org-a', uid: 'admin-a', role: 'admin', status: 'active' },
    })
    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
    }, { db, now, nowMs: () => nowMs })
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)).toMatchObject({
      ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps', ownerUserId: 'admin-a',
    })

    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'org-vps-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'org-vps-a', m.publicKey), label: 'Organisation VPS', platform: 'linux' as const,
      architecture: 'x64' as const, runtimeVersion: '1.1.0' }
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).resolves.toMatchObject({ deviceId: 'org-vps-a' })
    expect(rows.get('linked_devices/org-vps-a')).toMatchObject({
      ownerType: 'organization', ownerOrgId: 'org-a', createdByUserId: 'admin-a', deviceKind: 'vps',
      capabilities: ['workspace.execute', 'workspace.sync'],
    })
    expect(rows.get('linked_device_grants/org-a_org-vps-a')).toMatchObject({
      deviceId: 'org-vps-a', orgId: 'org-a', status: 'active', accessMode: 'organization',
      capabilities: ['workspace.execute', 'workspace.sync'],
    })
  })

  it('denies organisation ownership without an active administrator membership and requires Linux for a VPS', async () => {
    const { db } = fakeDb({
      'orgMembers/org-a_member-a': { orgId: 'org-a', uid: 'member-a', role: 'member', status: 'active' },
      'orgMembers/org-a_admin-a': { orgId: 'org-a', uid: 'admin-a', role: 'owner', status: 'active' },
    })
    await expect(createPairing({
      actorUserId: 'member-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
    }, { db, now, nowMs: () => nowMs })).rejects.toThrow('organisation administrator required')

    const pairing = await createPairing({
      actorUserId: 'admin-a', ownerType: 'organization', ownerOrgId: 'org-a', deviceKind: 'vps',
    }, { db, now, nowMs: () => nowMs })
    const m = machine()
    await expect(exchangePairing({
      challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'not-a-vps', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'not-a-vps', m.publicKey), label: 'Not a VPS', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.1.0',
    }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
  })

  it('rejects legacy endpoint and transport-token fields without creating device state', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const base = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos' as const,
      architecture: 'arm64' as const, runtimeVersion: '1.0.0' }
    await expect(exchangePairing({ ...base, runtimeEndpoint: 'https://device.example' } as never, { db, now, nowMs: () => nowMs + 1 }))
      .rejects.toThrow('legacy transport fields')
    await expect(exchangePairing({ ...base, transportToken: 'token' } as never, { db, now, nowMs: () => nowMs + 1 }))
      .rejects.toThrow('legacy transport fields')
    expect(rows.has('linked_devices/device-a')).toBe(false)
    expect(rows.has('linked_device_runtime_transports/device-a')).toBe(false)
  })

  it('allows exactly one winner when identical valid exchanges race', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos' as const,
      architecture: 'arm64' as const, runtimeVersion: '1.0.0' }
    const results = await Promise.allSettled([
      exchangePairing(input, { db, now, nowMs: () => nowMs + 1 }),
      exchangePairing(input, { db, now, nowMs: () => nowMs + 1 }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)).toHaveProperty('consumedAt')
  })

  it.each(['revoked', 'removed', 'paused'])('rejects %s existing-device re-pairing', async (status) => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status, credentialVersion: 4 },
    })
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    await expect(exchangePairing({ challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0' }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
  })

  it('denies re-pairing a device owned by another user', async () => {
    const { db } = fakeDb({ 'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-b', status: 'active', credentialVersion: 1 } })
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    await expect(exchangePairing({ challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0' }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('pairing exchange denied')
  })
})

describe('linked computer device authentication', () => {
  function authFixture(overrides: { status?: string; revokedAt?: unknown } = {}) {
    const m = machine(); const credential = 'right-credential'
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: overrides.status ?? 'active', credentialVersion: 3, publicKey: m.publicKey },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: hashLinkedComputerSecret(credential), credentialVersion: 3, revokedAt: overrides.revokedAt ?? null },
    })
    const base = { deviceId: 'device-a', credential, credentialVersion: 3, timestamp: String(nowMs), requestId: 'request-1234567890',
      method: 'POST', path: '/api/v1/linked-computers/device-a/heartbeat', body: '{"health":"ok"}', signature: '' }
    base.signature = sign(null, Buffer.from(deviceRequestPayload(base)), m.privateKey).toString('base64url')
    return { db, rows, base, m }
  }

  it('authenticates an organisation-owned device using its immutable creator identity for legacy route compatibility', async () => {
    const m = machine(); const credential = 'right-credential'
    const { db } = fakeDb({
      'linked_devices/vps-a': { deviceId: 'vps-a', ownerType: 'organization', ownerOrgId: 'org-a', createdByUserId: 'creator-a', status: 'active', credentialVersion: 3, publicKey: m.publicKey },
      'linked_device_credentials/vps-a': { deviceId: 'vps-a', credentialHash: hashLinkedComputerSecret(credential), credentialVersion: 3, revokedAt: null },
    })
    const input = { deviceId: 'vps-a', credential, credentialVersion: 3, timestamp: String(nowMs), requestId: 'request-org-vps-1234',
      method: 'POST', path: '/api/v1/linked-computers/vps-a/heartbeat', body: '{"health":"ok"}', signature: '' }
    input.signature = sign(null, Buffer.from(deviceRequestPayload(input)), m.privateKey).toString('base64url')

    await expect(authenticateDeviceRequest(input, { db, nowMs: () => nowMs })).resolves.toMatchObject({ deviceId: 'vps-a', ownerUserId: 'creator-a' })
  })

  it('authenticates once and atomically denies an identical signed request replay', async () => {
    const { db, rows, base } = authFixture()
    await expect(authenticateDeviceRequest(base, { db, nowMs: () => nowMs })).resolves.toMatchObject({ ownerUserId: 'user-a' })
    const nonceKey = [...rows.keys()].find((key) => key.startsWith('linked_device_request_nonces/'))
    expect(nonceKey).toBeTruthy()
    const expiresAt = rows.get(nonceKey!)?.expiresAt as { toMillis?: () => number }
    expect(typeof expiresAt.toMillis).toBe('function')
    expect(expiresAt.toMillis?.()).toBeGreaterThanOrEqual(nowMs + 5 * 60 * 1000)
    await expect(authenticateDeviceRequest(base, { db, nowMs: () => nowMs })).rejects.toThrow('request replay')
  })

  it('allows exactly one winner when identical device requests race', async () => {
    const { db, base } = authFixture()
    const results = await Promise.allSettled([
      authenticateDeviceRequest(base, { db, nowMs: () => nowMs }),
      authenticateDeviceRequest(base, { db, nowMs: () => nowMs }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('retains a maximum-future-skew request nonce for a full window after its signed timestamp', async () => {
    const { db, rows, base, m } = authFixture()
    const futureTimestamp = String(nowMs + 5 * 60 * 1000)
    const future = { ...base, timestamp: futureTimestamp, requestId: 'future-request-1234', signature: '' }
    future.signature = sign(null, Buffer.from(deviceRequestPayload(future)), m.privateKey).toString('base64url')
    await authenticateDeviceRequest(future, { db, nowMs: () => nowMs })
    const nonceKey = [...rows.keys()].find((key) => key.startsWith('linked_device_request_nonces/'))
    const expiresAt = rows.get(nonceKey!)?.expiresAt as { toMillis: () => number }
    expect(expiresAt.toMillis()).toBeGreaterThanOrEqual(Number(futureTimestamp) + 5 * 60 * 1000)
  })

  it('rejects a wrong credential', async () => {
    const { db, base } = authFixture()
    await expect(authenticateDeviceRequest({ ...base, credential: 'wrong' }, { db, nowMs: () => nowMs })).rejects.toThrow('authentication failed')
  })

  it('rejects a wrong credential version', async () => {
    const { db, base } = authFixture()
    await expect(authenticateDeviceRequest({ ...base, credentialVersion: 2 }, { db, nowMs: () => nowMs })).rejects.toThrow('version mismatch')
  })

  it('rejects a stale timestamp', async () => {
    const { db, base } = authFixture()
    await expect(authenticateDeviceRequest({ ...base, timestamp: String(nowMs - 6 * 60 * 1000) }, { db, nowMs: () => nowMs })).rejects.toThrow('stale')
  })

  it('rejects a bad signature', async () => {
    const { db, base } = authFixture()
    await expect(authenticateDeviceRequest({ ...base, signature: 'bad' }, { db, nowMs: () => nowMs })).rejects.toThrow('invalid device signature')
  })

  it.each(['paused', 'revoked', 'removed'])('rejects a %s device', async (status) => {
    const { db, base } = authFixture({ status })
    await expect(authenticateDeviceRequest(base, { db, nowMs: () => nowMs })).rejects.toThrow('active device required')
  })

  it('rejects a revoked credential', async () => {
    const { db, base } = authFixture({ revokedAt: 'revoked' })
    await expect(authenticateDeviceRequest(base, { db, nowMs: () => nowMs })).rejects.toThrow('credential revoked')
  })
})
