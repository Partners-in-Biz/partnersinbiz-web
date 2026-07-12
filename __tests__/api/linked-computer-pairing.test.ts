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
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'pairing-transport-test-key'
    process.env.LINKED_RUNTIME_ALLOWED_HOSTS = 'runtime.example.test'
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    const input = { challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos' as const,
      architecture: 'arm64' as const, runtimeVersion: '1.0.0', runtimeEndpoint: 'https://runtime.example.test' }
    const result = await exchangePairing(input, { db, now, nowMs: () => nowMs + 1, resolveHost: async () => ['8.8.8.8'] })
    expect(result).toMatchObject({ deviceId: 'device-a', credentialVersion: 1 })
    expect(Object.keys(result).sort()).toEqual(['credential', 'credentialVersion', 'deviceId', 'transportToken'])
    expect(result.credential).toBeTruthy()
    expect(rows.get('linked_devices/device-a')).toMatchObject({ ownerUserId: 'user-a', status: 'active', credentialVersion: 1 })
    expect(rows.get('linked_device_credentials/device-a')).not.toHaveProperty('credential')
    expect(rows.get('linked_device_runtime_transports/device-a')).toMatchObject({ deviceId: 'device-a', endpoint: 'https://runtime.example.test', enabled: true, state: 'active' })
    expect(JSON.stringify(rows.get('linked_device_runtime_transports/device-a'))).not.toContain(result.transportToken)
    expect(JSON.stringify([...rows.values()])).not.toContain(result.credential)
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 2, resolveHost: async () => ['8.8.8.8'] })).rejects.toThrow('already consumed')
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
