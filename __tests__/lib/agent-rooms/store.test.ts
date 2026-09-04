import {
  archiveAgentRoom,
  createAgentRoom,
  getAgentRoom,
  listAgentRooms,
  updateAgentRoom,
} from '@/lib/agent-rooms/store'
import { personalAgentRoomId } from '@/lib/agent-rooms/types'

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

const now = () => '2026-09-03T22:00:00.000Z'

const members = [
  { agentId: 'pip', deviceId: null },
  { agentId: 'maya', deviceId: 'device-a' },
]

function seed() {
  return {
    'agent_team/pip': { agentId: 'pip', name: 'Pip', enabled: true },
    'agent_team/maya': { agentId: 'maya', name: 'Maya', enabled: true },
    'agent_team/my-bot': {
      agentId: 'my-bot',
      name: 'My Bot',
      enabled: true,
      accessScope: 'personal',
      ownerUserId: 'user-1',
      scopeOrgId: 'org-1',
    },
    'agent_team/their-bot': {
      agentId: 'their-bot',
      name: 'Their Bot',
      enabled: true,
      accessScope: 'personal',
      ownerUserId: 'user-2',
      scopeOrgId: 'org-1',
    },
    'linked_devices/device-a': {
      ownerUserId: 'user-1',
      availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
    },
    'linked_devices/device-b': {
      ownerUserId: 'user-2',
      availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
    },
    'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
    'linked_device_grants/org-1_device-b': { orgId: 'org-1', deviceId: 'device-b', status: 'active' },
    'org_teams/org-1_growth': { orgId: 'org-1', status: 'active', name: 'Growth' },
    'orgMembers/org-1_user-1': { orgId: 'org-1', uid: 'user-1', role: 'member', status: 'active' },
  }
}

describe('agent rooms store', () => {
  it('creates a room and increments projectionVersion from 1', async () => {
    const { db } = fakeDb(seed())
    const room = await createAgentRoom({
      orgId: 'org-1',
      slug: 'growth-desk',
      name: 'Growth desk',
      members,
      humanTeamIds: ['org-1_growth'],
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })
    expect(room).toMatchObject({
      roomId: 'org-1_growth-desk',
      projectionVersion: 1,
      allowOrgWideDms: false,
      conversationId: 'conv-1',
      accessScope: 'organization',
      ownerUserId: null,
    })
  })

  it('rejects fewer than two members and unknown agents', async () => {
    const { db } = fakeDb(seed())
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'solo',
      name: 'Solo',
      members: [{ agentId: 'pip', deviceId: null }],
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })).rejects.toThrow('members must be 2..6')

    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'ghost',
      name: 'Ghost',
      members: [{ agentId: 'pip', deviceId: null }, { agentId: 'theo', deviceId: null }],
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })).rejects.toThrow('unknown agent: theo')
  })

  it('rejects a device without an active grant or reported agent', async () => {
    const { db } = fakeDb({
      ...seed(),
      'linked_device_grants/org-1_device-a': { orgId: 'org-1', status: 'paused' },
    })
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'paused',
      name: 'Paused',
      members,
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })).rejects.toThrow('device has no active grant')
  })

  it('rejects archived human teams', async () => {
    const { db } = fakeDb({
      ...seed(),
      'org_teams/org-1_growth': { orgId: 'org-1', status: 'archived' },
    })
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'old-team',
      name: 'Old team',
      members,
      humanTeamIds: ['org-1_growth'],
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })).rejects.toThrow('human team is not active')
  })

  it('increments projectionVersion on update and archive', async () => {
    const { db } = fakeDb(seed())
    await createAgentRoom({
      orgId: 'org-1',
      slug: 'growth-desk',
      name: 'Growth desk',
      members,
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })
    const updated = await updateAgentRoom({
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      name: 'Growth desk 2',
    }, { db, now })
    expect(updated.projectionVersion).toBe(2)
    const archived = await archiveAgentRoom({ orgId: 'org-1', roomId: 'org-1_growth-desk' }, { db, now })
    expect(archived.status).toBe('archived')
    expect(archived.projectionVersion).toBe(3)
    await expect(getAgentRoom('org-1', 'org-1_growth-desk', { db })).resolves.toMatchObject({ status: 'archived' })
    await expect(listAgentRooms('org-1', { db })).resolves.toHaveLength(1)
  })

  it('refuses personal agents in organisation rooms', async () => {
    const { db } = fakeDb(seed())
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'mixed',
      name: 'Mixed',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'my-bot', deviceId: null },
      ],
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
      accessScope: 'organization',
    }, { db, now })).rejects.toThrow('personal agents cannot join organisation rooms')
  })

  it('creates a personal room with owner-only id and empty humanTeamIds', async () => {
    const { db } = fakeDb(seed())
    const room = await createAgentRoom({
      orgId: 'org-1',
      slug: 'desk',
      name: 'My desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'my-bot', deviceId: null },
      ],
      humanTeamIds: ['org-1_growth'],
      conversationId: 'conv-p',
      actorUserId: 'user-1',
      accessScope: 'personal',
      ownerUserId: 'user-1',
    }, { db, now })
    expect(room.roomId).toBe(personalAgentRoomId('org-1', 'user-1', 'desk'))
    expect(room.accessScope).toBe('personal')
    expect(room.ownerUserId).toBe('user-1')
    expect(room.humanTeamIds).toEqual([])
  })

  it('refuses another member\'s personal agent in a personal room', async () => {
    const { db } = fakeDb(seed())
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'steal',
      name: 'Steal',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'their-bot', deviceId: null },
      ],
      conversationId: 'conv-p',
      actorUserId: 'user-1',
      accessScope: 'personal',
      ownerUserId: 'user-1',
    }, { db, now })).rejects.toThrow("cannot seat another member's personal agent")
  })

  it('refuses a non-owner device pin in a personal room', async () => {
    const { db } = fakeDb({
      ...seed(),
      'linked_devices/device-a': {
        ownerUserId: 'user-2',
        availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
      },
    })
    await expect(createAgentRoom({
      orgId: 'org-1',
      slug: 'foreign-device',
      name: 'Foreign',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: 'device-a' },
      ],
      conversationId: 'conv-p',
      actorUserId: 'user-1',
      accessScope: 'personal',
      ownerUserId: 'user-1',
    }, { db, now })).rejects.toThrow('personal room devices must be owner-owned')
  })

  it('lists org rooms plus the viewer\'s personal rooms only', async () => {
    const { db } = fakeDb(seed())
    await createAgentRoom({
      orgId: 'org-1',
      slug: 'growth-desk',
      name: 'Growth desk',
      members,
      conversationId: 'conv-1',
      actorUserId: 'admin-1',
    }, { db, now })
    await createAgentRoom({
      orgId: 'org-1',
      slug: 'desk',
      name: 'User desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'my-bot', deviceId: null },
      ],
      conversationId: 'conv-p',
      actorUserId: 'user-1',
      accessScope: 'personal',
      ownerUserId: 'user-1',
    }, { db, now })
    await createAgentRoom({
      orgId: 'org-1',
      slug: 'other',
      name: 'Other desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'their-bot', deviceId: null },
      ],
      conversationId: 'conv-o',
      actorUserId: 'user-2',
      accessScope: 'personal',
      ownerUserId: 'user-2',
    }, { db, now })

    const forUser1 = await listAgentRooms('org-1', { db, viewerUserId: 'user-1' })
    expect(forUser1.map((room) => room.roomId).sort()).toEqual([
      'org-1_growth-desk',
      personalAgentRoomId('org-1', 'user-1', 'desk'),
    ].sort())

    const forUser2 = await listAgentRooms('org-1', { db, viewerUserId: 'user-2' })
    expect(forUser2.map((room) => room.roomId).sort()).toEqual([
      'org-1_growth-desk',
      personalAgentRoomId('org-1', 'user-2', 'other'),
    ].sort())
  })
})
