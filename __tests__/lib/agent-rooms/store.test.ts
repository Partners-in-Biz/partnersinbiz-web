import {
  archiveAgentRoom,
  createAgentRoom,
  getAgentRoom,
  listAgentRooms,
  updateAgentRoom,
} from '@/lib/agent-rooms/store'

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
    'linked_devices/device-a': {
      availableAgents: [{ orgId: 'org-1', agentId: 'maya', profile: 'partners--maya', healthy: true }],
    },
    'linked_device_grants/org-1_device-a': { orgId: 'org-1', deviceId: 'device-a', status: 'active' },
    'org_teams/org-1_growth': { orgId: 'org-1', status: 'active', name: 'Growth' },
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
})
