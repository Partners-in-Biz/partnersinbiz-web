/**
 * @jest-environment node
 */
import {
  assertRelayTeammates,
  claimOldestRelayEnvelope,
  completeRelayEnvelope,
  enqueueRelayEnvelope,
  RELAY_LEASE_MS,
  RELAY_MAX_PAYLOAD_BYTES,
  RELAY_TTL_MS,
  RelayNotTeammatesError,
  replyRelayEnvelope,
} from '@/lib/linked-computers/relay-queue'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1)!,
    get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
  })
  const query = (name: string, filters: Array<[string, string, unknown]> = []): any => ({
    collection: name,
    filters,
    where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]]),
    get: async () => ({
      docs: [...rows.entries()]
        .filter(([path, row]) => path.startsWith(`${name}/`) && filters.every(([field, op, value]) => (
          op === '==' ? row[field] === value : true
        )))
        .map(([path, row]) => ({ id: path.split('/').at(-1)!, data: () => row })),
    }),
  })
  const db: any = {
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, op: string, value: unknown) => query(name, [[field, op, value]]),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pending = new Map(rows)
      const result = await fn({
        get: async (document: { path?: string }) => ({
          exists: pending.has(document.path!),
          data: () => pending.get(document.path!),
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
    },
  }
  return { db, rows }
}

const now = Date.parse('2026-09-04T03:00:00.000Z')

function teammates(overrides: Record<string, Row> = {}) {
  return {
    'linked_devices/device-a': {
      deviceId: 'device-a',
      availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
    },
    'linked_devices/device-b': {
      deviceId: 'device-b',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'partners--pip', healthy: true }],
    },
    'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
    'linked_device_grants/org-1_device-b': { orgId: 'org-1', deviceId: 'device-b', status: 'active' },
    'agent_rooms/org-1_growth-desk': {
      orgId: 'org-1',
      slug: 'growth-desk',
      name: 'Growth desk',
      status: 'active',
      members: [
        { agentId: 'maya', deviceId: 'device-a' },
        { agentId: 'pip', deviceId: 'device-b' },
      ],
    },
    ...overrides,
  }
}

function enqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    fromDeviceId: 'device-a',
    outboxItemId: 'outbox-1',
    orgId: 'org-1',
    roomId: 'org-1_growth-desk',
    from: { profile: 'partners--maya', agentId: 'maya' },
    to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
    kind: 'room_turn' as const,
    payload: { text: 'hello teammate' },
    ...overrides,
  }
}

describe('relay queue', () => {
  beforeEach(() => {
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'linked-relay-test-master-key'
  })

  it('refuses cross-org enqueue', async () => {
    const { db } = fakeDb(teammates({
      'linked_device_grants/org-1_device-b': { orgId: 'org-2', deviceId: 'device-b', status: 'active' },
      'linked_device_grants/org-2_device-b': { orgId: 'org-2', deviceId: 'device-b', status: 'active' },
    }))
    await expect(enqueueRelayEnvelope(enqueueInput(), { db, nowMs: now }))
      .rejects.toBeInstanceOf(RelayNotTeammatesError)
    await expect(assertRelayTeammates({
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      from: { deviceId: 'device-a', profile: 'partners--maya', agentId: 'maya' },
      to: { deviceId: 'device-b', profile: 'partners--pip', agentId: 'pip' },
    }, { db })).rejects.toMatchObject({ reason: 'not_teammates' })
  })

  it('refuses non-teammates and a sender profile the device does not report', async () => {
    const missingRoom = fakeDb({
      'linked_devices/device-a': teammates()['linked_devices/device-a'],
      'linked_devices/device-b': teammates()['linked_devices/device-b'],
      'linked_device_grants/org-1_device-a': teammates()['linked_device_grants/org-1_device-a'],
      'linked_device_grants/org-1_device-b': teammates()['linked_device_grants/org-1_device-b'],
    })
    await expect(enqueueRelayEnvelope(enqueueInput({ roomId: null, kind: 'dm' }), { db: missingRoom.db, nowMs: now }))
      .rejects.toBeInstanceOf(RelayNotTeammatesError)

    const { db } = fakeDb(teammates())
    await expect(enqueueRelayEnvelope(enqueueInput({ from: { profile: 'stranger--maya', agentId: 'maya' } }), { db, nowMs: now }))
      .rejects.toBeInstanceOf(RelayNotTeammatesError)
  })

  it('enqueues a room turn, claims it, and reclaims after the 90s lease expires', async () => {
    const { db } = fakeDb(teammates())
    const queued = await enqueueRelayEnvelope(enqueueInput(), { db, nowMs: now })
    expect(queued).toMatchObject({
      status: 'queued',
      kind: 'room_turn',
      roomId: 'org-1_growth-desk',
      idempotencyKey: 'device-a:outbox-1',
      expiresAtMs: now + RELAY_TTL_MS,
    })
    expect(JSON.stringify(queued.encryptedPayload)).not.toContain('hello teammate')

    const first = await claimOldestRelayEnvelope({ deviceId: 'device-b' }, { db, nowMs: now, leaseMs: RELAY_LEASE_MS })
    expect(first).toMatchObject({
      role: 'inbound',
      payload: { text: 'hello teammate' },
      attempt: 1,
    })
    await expect(claimOldestRelayEnvelope({ deviceId: 'device-b' }, { db, nowMs: now + 1_000 }))
      .resolves.toBeNull()

    const retried = await claimOldestRelayEnvelope({ deviceId: 'device-b' }, { db, nowMs: now + RELAY_LEASE_MS + 1 })
    expect(retried).toMatchObject({
      envelopeId: first!.envelopeId,
      role: 'inbound',
      attempt: 2,
      payload: { text: 'hello teammate' },
    })
    expect(retried!.leaseToken).not.toBe(first!.leaseToken)
  })

  it('is idempotent on the sender outbox item', async () => {
    const { db, rows } = fakeDb(teammates())
    const first = await enqueueRelayEnvelope(enqueueInput(), { db, nowMs: now })
    const second = await enqueueRelayEnvelope(enqueueInput({ payload: { text: 'ignored retry' } }), { db, nowMs: now + 5_000 })
    expect(second.envelopeId).toBe(first.envelopeId)
    expect(second.status).toBe('queued')
    const stored = [...rows.values()].filter((row) => row.envelopeId === first.envelopeId)
    expect(stored).toHaveLength(1)
  })

  it('expires envelopes past the 15 minute TTL during claim cleanup', async () => {
    const { db, rows } = fakeDb(teammates())
    const queued = await enqueueRelayEnvelope(enqueueInput(), { db, nowMs: now, ttlMs: RELAY_TTL_MS })
    const claimed = await claimOldestRelayEnvelope({ deviceId: 'device-b' }, { db, nowMs: now + RELAY_TTL_MS + 1 })
    expect(claimed).toBeNull()
    expect(rows.get(`linked_device_relay_envelopes/${queued.envelopeId}`)).toMatchObject({ status: 'expired' })
    expect(rows.get('linked_device_relay_queues/device-b')?.pendingEnvelopeIds).toEqual([])
  })

  it('lets teammates DM when they share any active room, then reply back to the sender', async () => {
    const { db } = fakeDb(teammates())
    const queued = await enqueueRelayEnvelope(enqueueInput({
      roomId: null,
      kind: 'dm',
      payload: { text: 'Authorization: Bearer super-secret-token' },
    }), { db, nowMs: now })
    expect(queued.kind).toBe('dm')
    expect(queued.roomId).toBeNull()

    const inbound = await claimOldestRelayEnvelope({ deviceId: 'device-b' }, { db, nowMs: now })
    expect(inbound?.payload.text).toContain('[redacted]')
    expect(inbound?.payload.text).not.toContain('super-secret-token')

    await replyRelayEnvelope({
      deviceId: 'device-b',
      envelopeId: inbound!.envelopeId,
      leaseToken: inbound!.leaseToken,
      payload: { text: 'ack Password: hunter2' },
    }, { db, nowMs: now + 1_000 })

    const reply = await claimOldestRelayEnvelope({ deviceId: 'device-a' }, { db, nowMs: now + 2_000 })
    expect(reply).toMatchObject({
      role: 'reply',
      envelopeId: inbound!.envelopeId,
    })
    expect(reply!.payload.text).toContain('[redacted]')
    expect(reply!.payload.text).not.toContain('hunter2')

    const done = await completeRelayEnvelope({
      deviceId: 'device-b',
      envelopeId: inbound!.envelopeId,
      leaseToken: inbound!.leaseToken,
      outcome: 'delivered',
    }, { db, nowMs: now + 3_000 })
    expect(done.status).toBe('delivered')
  })

  it('rejects a payload larger than 64 KB', async () => {
    const { db } = fakeDb(teammates())
    await expect(enqueueRelayEnvelope(enqueueInput({
      payload: { text: 'x'.repeat(RELAY_MAX_PAYLOAD_BYTES + 1) },
    }), { db, nowMs: now })).rejects.toThrow('relay payload too large')
  })
})
