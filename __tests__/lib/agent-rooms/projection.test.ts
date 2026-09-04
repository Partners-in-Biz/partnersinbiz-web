/**
 * @jest-environment node
 */
import {
  adoptProjectionDrift,
  applyProjectionObservation,
  desiredProfileMeta,
  desiredRoomsForDevice,
  PROFILE_PROJECTIONS_COLLECTION,
  PROJECTION_DRIFT_GRACE_MS,
  projectionHash,
  projectAgentRoomAfterWrite,
  revertProjectionDrift,
  shouldMarkProjectionDrifted,
  upsertDesiredProjection,
} from '@/lib/agent-rooms/projection'
import type { AgentRoom } from '@/lib/agent-rooms/types'

type Row = Record<string, unknown>

function fakeDb(seed: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(seed))
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1)!,
    get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
  })
  const query = (name: string, filters: Array<[string, string, unknown]> = []) => ({
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
  return {
    db: {
      collection: (name: string) => ({
        doc: (id: string) => ref(`${name}/${id}`),
        where: (field: string, op: string, value: unknown) => query(name, [[field, op, value]]),
      }),
      runTransaction: async <T>(fn: (tx: {
        get: (document: { path?: string }) => Promise<{ exists: boolean; data: () => Row | undefined }>
        create: (document: { path: string }, value: Row) => void
        set: (document: { path: string }, value: Row, options?: { merge?: boolean }) => void
        update: (document: { path: string }, value: Row) => void
      }) => Promise<T>): Promise<T> => {
        const pending = new Map(rows)
        const result = await fn({
          get: async (document) => ({
            exists: pending.has(document.path!),
            data: () => pending.get(document.path!),
          }),
          create: (document, value) => {
            if (pending.has(document.path)) throw new Error('already exists')
            pending.set(document.path, value)
          },
          set: (document, value, options) => {
            pending.set(document.path, options?.merge ? { ...pending.get(document.path), ...value } : value)
          },
          update: (document, value) => {
            pending.set(document.path, { ...pending.get(document.path), ...value })
          },
        })
        rows.clear()
        for (const [key, value] of pending) rows.set(key, value)
        return result
      },
    },
    rows,
  }
}

const now = () => '2026-09-04T03:00:00.000Z'

const room: AgentRoom = {
  roomId: 'org-1_growth-desk',
  orgId: 'org-1',
  slug: 'growth-desk',
  name: 'Growth desk',
  pictureUrl: null,
  members: [
    { agentId: 'pip', deviceId: null },
    { agentId: 'maya', deviceId: 'device-a' },
  ],
  humanTeamIds: [],
  conversationId: 'conv-1',
  allowOrgWideDms: false,
  accessScope: 'organization',
  ownerUserId: null,
  projectionVersion: 1,
  status: 'active',
  createdByUserId: 'admin-1',
  createdAt: now(),
  updatedAt: now(),
}

function seedProjection(overrides: Row = {}) {
  return {
    'agent_team/maya': { agentId: 'maya', name: 'Maya', role: 'Marketing', enabled: true },
    'agent_team/pip': { agentId: 'pip', name: 'Pip', role: 'COO', enabled: true },
    'agent_rooms/org-1_growth-desk': { ...room },
    'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
    [`${PROFILE_PROJECTIONS_COLLECTION}/device-a_partners--maya`]: {
      deviceId: 'device-a',
      orgId: 'org-1',
      profile: 'partners--maya',
      desired: {
        profileMeta: { title: 'Maya', description: 'Marketing', avatar: null, section: '', groups: ['growth-desk'] },
        rooms: [{ roomId: 'org-1_growth-desk', name: 'Growth desk', pictureUrl: null, memberHandles: ['@maya-device-a', '@pip'] }],
        peers: [],
        projectionVersion: 1,
      },
      desiredHash: 'desired-hash',
      observedHash: 'observed-hash',
      observedMeta: {
        title: 'Maya Prime',
        rooms: [{ roomId: 'org-1_growth-desk', name: 'Growth desk v2' }],
      },
      driftedAt: '2026-09-04T02:50:00.000Z',
      lastAppliedAt: '2026-09-04T02:00:00.000Z',
      projectionVersion: 1,
      ...overrides,
    },
  }
}

describe('projectionHash', () => {
  it('is stable across key order', () => {
    const left = projectionHash({ rooms: [{ name: 'Growth', roomId: 'r1' }], title: 'Maya' })
    const right = projectionHash({ title: 'Maya', rooms: [{ roomId: 'r1', name: 'Growth' }] })
    expect(left).toBe(right)
    expect(left).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('desired profile and rooms', () => {
  it('builds title/description from getAgent and groups from room slugs', async () => {
    const meta = await desiredProfileMeta('org-1', 'maya', {
      getAgent: async () => ({ name: 'Maya', role: 'Marketing' }) as never,
      listAgentRooms: async () => [room, { ...room, roomId: 'org-1_archived', slug: 'old', status: 'archived' }],
    })
    expect(meta).toEqual({
      title: 'Maya',
      description: 'Marketing',
      avatar: null,
      section: '',
      groups: ['growth-desk'],
    })
  })

  it('lists rooms where a member has this deviceId or a platform member', async () => {
    const { db } = fakeDb({
      'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
      'linked_devices/device-a': { ownerUserId: 'user-1' },
    })
    const rooms = await desiredRoomsForDevice('device-a', {
      db: db as never,
      listAgentRooms: async () => [
        room,
        { ...room, roomId: 'org-1_other', slug: 'other', members: [{ agentId: 'theo', deviceId: 'device-b' }, { agentId: 'sage', deviceId: 'device-c' }] },
      ],
    })
    expect(rooms.map((item) => item.roomId)).toEqual(['org-1_growth-desk'])
  })

  it('excludes personal rooms whose owner does not match the device owner', async () => {
    const { db } = fakeDb({
      'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
      'linked_devices/device-a': { ownerUserId: 'user-1' },
    })
    const personal: AgentRoom = {
      ...room,
      roomId: 'org-1_u_user-2_desk',
      accessScope: 'personal',
      ownerUserId: 'user-2',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: 'device-a' },
      ],
    }
    const rooms = await desiredRoomsForDevice('device-a', {
      db: db as never,
      listAgentRooms: async () => [room, personal],
    })
    expect(rooms.map((item) => item.roomId)).toEqual(['org-1_growth-desk'])
  })
})

describe('projectAgentRoomAfterWrite', () => {
  it('upserts desired projection for pinned member devices', async () => {
    const { db } = fakeDb({
      'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
      'linked_devices/device-a': {
        ownerUserId: 'admin-1',
        availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
      },
      'organizations/org-1': { slug: 'partners' },
    })
    const enqueueBotProjectionJob = jest.fn(async () => 'job-1')
    await projectAgentRoomAfterWrite({
      room,
      actorUserId: 'admin-1',
    }, {
      db: db as never,
      now,
      getAgent: async () => ({ name: 'Maya', role: 'Marketing' }) as never,
      listAgentRooms: async () => [room],
      enqueueBotProjectionJob,
    })
    expect(enqueueBotProjectionJob).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      agentId: 'maya',
    }))
  })
})

describe('adopt / revert', () => {
  it('writes agent_team.name and bumps room projectionVersion', async () => {
    const { db, rows } = fakeDb(seedProjection())
    const result = await adoptProjectionDrift({
      orgId: 'org-1',
      projectionId: 'device-a_partners--maya',
      actorUserId: 'admin-1',
    }, { db: db as never, now })
    expect(rows.get('agent_team/maya')).toMatchObject({ name: 'Maya Prime' })
    expect(rows.get('agent_rooms/org-1_growth-desk')).toMatchObject({
      name: 'Growth desk v2',
      projectionVersion: 2,
    })
    expect(result.roomIds).toEqual(['org-1_growth-desk'])
  })

  it('revert enqueues once', async () => {
    const { db } = fakeDb(seedProjection())
    const jobs = new Map<string, string>()
    const enqueueBotProjectionJob = jest.fn(async (input: { idempotencyKey?: string; desiredHash: string; deviceId: string }) => {
      const key = `sync-policy:bot-projection:${input.deviceId}:${input.desiredHash}`
      if (!jobs.has(key)) jobs.set(key, `job-${jobs.size + 1}`)
      return jobs.get(key)!
    })
    const first = await revertProjectionDrift({
      orgId: 'org-1',
      projectionId: 'device-a_partners--maya',
      actorUserId: 'admin-1',
    }, { db: db as never, now, enqueueBotProjectionJob })
    const second = await revertProjectionDrift({
      orgId: 'org-1',
      projectionId: 'device-a_partners--maya',
      actorUserId: 'admin-1',
    }, { db: db as never, now, enqueueBotProjectionJob })
    expect(first.jobId).toBe(second.jobId)
    expect(jobs.size).toBe(1)
    expect(enqueueBotProjectionJob).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      desiredHash: 'desired-hash',
      agentId: 'maya',
    }))
  })
})

describe('upsertDesiredProjection', () => {
  it('enqueues sync-policy when desiredHash changes', async () => {
    const { db, rows } = fakeDb({
      'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
    })
    const enqueueBotProjectionJob = jest.fn(async () => 'job-1')
    const first = await upsertDesiredProjection({
      orgId: 'org-1',
      deviceId: 'device-a',
      profile: 'partners--maya',
      agentId: 'maya',
      actorUserId: 'admin-1',
    }, {
      db: db as never,
      now,
      getAgent: async () => ({ name: 'Maya', role: 'Marketing' }) as never,
      listAgentRooms: async () => [room],
      enqueueBotProjectionJob,
    })
    expect(first.desiredHashChanged).toBe(true)
    expect(first.enqueuedJobId).toBe('job-1')
    expect(enqueueBotProjectionJob).toHaveBeenCalledTimes(1)
    expect(enqueueBotProjectionJob.mock.calls[0][0].desiredHash).toBe(first.projection.desiredHash)

    const second = await upsertDesiredProjection({
      orgId: 'org-1',
      deviceId: 'device-a',
      profile: 'partners--maya',
      agentId: 'maya',
      actorUserId: 'admin-1',
    }, {
      db: db as never,
      now,
      getAgent: async () => ({ name: 'Maya', role: 'Marketing' }) as never,
      listAgentRooms: async () => [room],
      enqueueBotProjectionJob,
    })
    expect(second.desiredHashChanged).toBe(false)
    expect(second.enqueuedJobId).toBeNull()
    expect(enqueueBotProjectionJob).toHaveBeenCalledTimes(1)
    expect(rows.get(`${PROFILE_PROJECTIONS_COLLECTION}/device-a_partners--maya`)).toMatchObject({
      desiredHash: first.projection.desiredHash,
      profile: 'partners--maya',
    })
  })
})

describe('heartbeat drift', () => {
  it('marks drift only after lastAppliedAt is older than 2 minutes', () => {
    const nowMs = 1_000_000
    expect(shouldMarkProjectionDrifted({
      desiredHash: 'a',
      observedHash: 'b',
      lastAppliedAt: new Date(nowMs - PROJECTION_DRIFT_GRACE_MS + 1_000).toISOString(),
      nowMs,
    })).toBe(false)
    expect(shouldMarkProjectionDrifted({
      desiredHash: 'a',
      observedHash: 'b',
      lastAppliedAt: new Date(nowMs - PROJECTION_DRIFT_GRACE_MS).toISOString(),
      nowMs,
    })).toBe(true)
  })

  it('writes driftedAt after the grace window', async () => {
    const applied = '2026-09-04T02:00:00.000Z'
    const { db, rows } = fakeDb(seedProjection({
      lastAppliedAt: applied,
      driftedAt: null,
      desiredHash: 'aaa',
    }))
    await applyProjectionObservation({
      deviceId: 'device-a',
      orgId: 'org-1',
      profile: 'partners--maya',
      observedHash: 'bbb',
      observedMeta: { title: 'Changed on device' },
    }, { db: db as never, now, nowMs: () => Date.parse('2026-09-04T02:03:00.000Z') })
    expect(rows.get(`${PROFILE_PROJECTIONS_COLLECTION}/device-a_partners--maya`)).toMatchObject({
      driftedAt: now(),
      observedHash: 'bbb',
      observedMeta: { title: 'Changed on device' },
    })
  })
})
