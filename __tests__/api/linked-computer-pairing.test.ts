import { generateKeyPairSync, sign } from 'node:crypto'
import {
  createPairing,
  exchangePairing,
  type LinkedComputerPairingDb,
} from '@/lib/linked-computers/crypto'
import { authenticateDeviceRequest } from '@/lib/linked-computers/device-auth'

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
          exists: pending.has(document.path), data: () => pending.get(document.path),
        }),
        create: (document: { path: string }, value: Row) => {
          if (pending.has(document.path)) throw new Error('already exists')
          pending.set(document.path, value)
        },
        update: (document: { path: string }, value: Row) => {
          if (!pending.has(document.path)) throw new Error('missing')
          pending.set(document.path, { ...pending.get(document.path), ...value })
        },
      })
      rows.clear(); pending.forEach((value, key) => rows.set(key, value))
      return result
    }),
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
      await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('invalid pairing')
      expect(rows.get(`linked_device_pairing_challenges/${pairing.challengeId}`)?.attempts).toBe(attempt)
    }
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('attempts exhausted')
  })

  it('requires proof of the submitted machine private key and does not consume on invalid proof', async () => {
    const { db, rows } = fakeDb()
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine(); const attacker = machine()
    await expect(exchangePairing({
      challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(attacker.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey),
      label: 'Mac', platform: 'macos', architecture: 'arm64', runtimeVersion: '1.0.0',
    }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('invalid pairing proof')
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
    expect(Object.keys(result).sort()).toEqual(['credential', 'credentialVersion', 'deviceId'])
    expect(result.credential).toBeTruthy()
    expect(rows.get('linked_devices/device-a')).toMatchObject({ ownerUserId: 'user-a', status: 'active', credentialVersion: 1 })
    expect(rows.get('linked_device_credentials/device-a')).not.toHaveProperty('credential')
    expect(JSON.stringify([...rows.values()])).not.toContain(result.credential)
    await expect(exchangePairing(input, { db, now, nowMs: () => nowMs + 2 })).rejects.toThrow('already consumed')
  })

  it.each(['revoked', 'removed', 'paused'])('rejects %s existing-device re-pairing', async (status) => {
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status, credentialVersion: 4 },
    })
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    await expect(exchangePairing({ challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0' }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('active device required')
  })

  it('denies re-pairing a device owned by another user', async () => {
    const { db } = fakeDb({ 'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-b', status: 'active', credentialVersion: 1 } })
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const m = machine()
    await expect(exchangePairing({ challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: m.publicKey,
      proof: proof(m.privateKey, pairing.challengeId, pairing.secret, 'device-a', m.publicKey), label: 'Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0' }, { db, now, nowMs: () => nowMs + 1 })).rejects.toThrow('device owner mismatch')
  })
})

describe('linked computer device authentication', () => {
  it('enforces credential, version, request timestamp/signature, and active device state', async () => {
    const m = machine(); const timestamp = String(nowMs)
    const credential = 'device-credential'
    const { db, rows } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active', credentialVersion: 2, publicKey: m.publicKey },
    })
    const pairing = await createPairing({ actorUserId: 'user-a' }, { db, now, nowMs: () => nowMs })
    const fresh = machine()
    const exchanged = await exchangePairing({ challengeId: pairing.challengeId, secret: pairing.secret, deviceId: 'device-a', publicKey: fresh.publicKey,
      proof: proof(fresh.privateKey, pairing.challengeId, pairing.secret, 'device-a', fresh.publicKey), label: 'Mac', platform: 'macos',
      architecture: 'arm64', runtimeVersion: '1.0.0' }, { db, now, nowMs: () => nowMs })
    const body = '{"health":"ok"}'
    const canonical = `POST\n/api/v1/linked-computers/device-a/heartbeat\n${timestamp}\n${body}`
    const signature = sign(null, Buffer.from(canonical), fresh.privateKey).toString('base64url')
    await expect(authenticateDeviceRequest({ deviceId: 'device-a', credential: exchanged.credential,
      credentialVersion: exchanged.credentialVersion, timestamp, signature, method: 'POST',
      path: '/api/v1/linked-computers/device-a/heartbeat', body }, { db, nowMs: () => nowMs })).resolves.toMatchObject({ ownerUserId: 'user-a' })
    rows.set('linked_devices/device-a', { ...rows.get('linked_devices/device-a'), status: 'revoked' })
    await expect(authenticateDeviceRequest({ deviceId: 'device-a', credential: exchanged.credential,
      credentialVersion: exchanged.credentialVersion, timestamp, signature, method: 'POST',
      path: '/api/v1/linked-computers/device-a/heartbeat', body }, { db, nowMs: () => nowMs })).rejects.toThrow('active device required')
  })

  it('rejects stale timestamps, wrong versions, credentials, and signatures', async () => {
    const m = machine(); const credential = 'right'; const timestamp = String(nowMs)
    const { db } = fakeDb({
      'linked_devices/device-a': { deviceId: 'device-a', ownerUserId: 'user-a', status: 'active', credentialVersion: 3, publicKey: m.publicKey },
      'linked_device_credentials/device-a': { deviceId: 'device-a', credentialHash: 'not-right', credentialVersion: 3, revokedAt: null },
    })
    const base = { deviceId: 'device-a', credential, credentialVersion: 2, timestamp, signature: 'bad', method: 'GET', path: '/x', body: '' }
    await expect(authenticateDeviceRequest(base, { db, nowMs: () => nowMs })).rejects.toThrow()
    await expect(authenticateDeviceRequest({ ...base, timestamp: String(nowMs - 6 * 60 * 1000) }, { db, nowMs: () => nowMs })).rejects.toThrow('stale')
  })
})
