import {
  archiveOrgTeam,
  createOrgTeam,
  getOrgTeam,
  listOrgTeams,
  listOrgTeamsForUser,
  removeUserFromAllOrgTeams,
  setOrgTeamMembers,
} from '@/lib/org-teams/store'

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
          op === '==' ? row[field] === value
            : op === 'array-contains' ? Array.isArray(row[field]) && (row[field] as unknown[]).includes(value)
              : true
        )))
        .map(([path, row]) => ({ id: path.split('/').at(-1), ref: ref(path), data: () => row })),
    }),
  })
  const db: any = {
    collection: jest.fn((name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, op: string, value: unknown) => query(name, [[field, op, value]]),
    })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending = new Map(rows)
      const result = await fn({
        get: async (document: { path?: string; collection?: string; filters?: Array<[string, string, unknown]> }) => {
          if (document.collection) {
            const filters = document.filters ?? []
            const docs = [...pending.entries()]
              .filter(([path, value]) => path.startsWith(`${document.collection}/`) && filters.every(([field, op, expected]) => (
                op === '==' ? value[field] === expected : true
              )))
              .map(([path, value]) => ({ ref: ref(path), data: () => value }))
            return { docs }
          }
          return { exists: pending.has(document.path!), data: () => pending.get(document.path!) }
        },
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

const now = () => '2026-09-03T18:00:00.000Z'

function activeMember(orgId: string, uid: string, extras: Row = {}): Row {
  return { orgId, uid, userId: uid, status: 'active', role: 'member', teamIds: [], ...extras }
}

describe('org teams store', () => {
  it('creates a team and mirrors teamIds on member rows', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a'),
      'orgMembers/org-a_user-b': activeMember('org-a', 'user-b'),
    })
    const team = await createOrgTeam({
      orgId: 'org-a',
      slug: 'growth',
      name: 'Growth',
      actorUserId: 'admin-a',
      memberUserIds: ['user-a', 'user-b'],
      leadUserIds: ['user-a'],
    }, { db, now })

    expect(team).toMatchObject({
      teamId: 'org-a_growth',
      orgId: 'org-a',
      slug: 'growth',
      status: 'active',
      memberUserIds: ['user-a', 'user-b'],
      leadUserIds: ['user-a'],
    })
    expect(rows.get('orgMembers/org-a_user-a')?.teamIds).toEqual(['org-a_growth'])
    expect(rows.get('orgMembers/org-a_user-b')?.teamIds).toEqual(['org-a_growth'])
  })

  it('rejects a non-active member', async () => {
    const { db } = fakeDb({
      'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'removed' },
    })
    await expect(createOrgTeam({
      orgId: 'org-a', slug: 'growth', name: 'Growth', actorUserId: 'admin-a', memberUserIds: ['user-a'],
    }, { db, now })).rejects.toThrow('org teams: user is not an active member: user-a')
  })

  it('rejects a lead who is not a member', async () => {
    const { db } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a'),
    })
    await expect(createOrgTeam({
      orgId: 'org-a', slug: 'growth', name: 'Growth', actorUserId: 'admin-a',
      memberUserIds: ['user-a'], leadUserIds: ['user-b'],
    }, { db, now })).rejects.toThrow('org teams: lead must also be a member')
  })

  it('rejects duplicate slug', async () => {
    const { db } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a'),
      'org_teams/org-a_growth': { orgId: 'org-a', slug: 'growth', status: 'active' },
    })
    await expect(createOrgTeam({
      orgId: 'org-a', slug: 'growth', name: 'Growth', actorUserId: 'admin-a',
    }, { db, now })).rejects.toThrow('org teams: slug already exists')
  })

  it('setOrgTeamMembers adds and removes mirrors in one transaction', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a', { teamIds: ['org-a_growth'] }),
      'orgMembers/org-a_user-b': activeMember('org-a', 'user-b'),
      'org_teams/org-a_growth': {
        orgId: 'org-a', slug: 'growth', name: 'Growth', description: '',
        memberUserIds: ['user-a'], leadUserIds: ['user-a'], status: 'active',
        createdByUserId: 'admin-a',
      },
    })
    await setOrgTeamMembers({
      orgId: 'org-a',
      teamId: 'org-a_growth',
      actorUserId: 'admin-a',
      memberUserIds: ['user-b'],
      leadUserIds: ['user-b'],
    }, { db, now })

    expect(rows.get('org_teams/org-a_growth')).toMatchObject({
      memberUserIds: ['user-b'],
      leadUserIds: ['user-b'],
    })
    expect(rows.get('orgMembers/org-a_user-a')?.teamIds).toEqual([])
    expect(rows.get('orgMembers/org-a_user-b')?.teamIds).toEqual(['org-a_growth'])
  })

  it('archiveOrgTeam strips the team from all member rows and returns former members', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a', { teamIds: ['org-a_growth'] }),
      'orgMembers/org-a_user-b': activeMember('org-a', 'user-b', { teamIds: ['org-a_growth'] }),
      'org_teams/org-a_growth': {
        orgId: 'org-a', slug: 'growth', name: 'Growth', description: '',
        memberUserIds: ['user-a', 'user-b'], leadUserIds: ['user-a'], status: 'active',
        createdByUserId: 'admin-a',
      },
    })
    const archived = await archiveOrgTeam({ orgId: 'org-a', teamId: 'org-a_growth', actorUserId: 'admin-a' }, { db, now })
    expect(archived.status).toBe('archived')
    expect(archived.memberUserIds).toEqual(['user-a', 'user-b'])
    expect(rows.get('orgMembers/org-a_user-a')?.teamIds).toEqual([])
    expect(rows.get('orgMembers/org-a_user-b')?.teamIds).toEqual([])
    expect(await getOrgTeam('org-a', 'org-a_growth', { db })).toMatchObject({ status: 'archived' })
  })

  it('removeUserFromAllOrgTeams removes the user from every active team', async () => {
    const { db, rows } = fakeDb({
      'orgMembers/org-a_user-a': activeMember('org-a', 'user-a', { teamIds: ['org-a_growth', 'org-a_ops'] }),
      'org_teams/org-a_growth': {
        orgId: 'org-a', slug: 'growth', name: 'Growth', memberUserIds: ['user-a', 'user-b'],
        leadUserIds: ['user-a'], status: 'active',
      },
      'org_teams/org-a_ops': {
        orgId: 'org-a', slug: 'ops', name: 'Ops', memberUserIds: ['user-a'],
        leadUserIds: [], status: 'active',
      },
    })
    const touched = await removeUserFromAllOrgTeams({ orgId: 'org-a', userId: 'user-a' }, { db, now })
    expect(touched.sort()).toEqual(['org-a_growth', 'org-a_ops'])
    expect(rows.get('org_teams/org-a_growth')).toMatchObject({ memberUserIds: ['user-b'], leadUserIds: [] })
    expect(rows.get('orgMembers/org-a_user-a')?.teamIds).toEqual([])
    const visible = await listOrgTeamsForUser('org-a', 'user-a', { db })
    expect(visible).toEqual([])
    const remaining = await listOrgTeams('org-a', { db })
    expect(remaining.map((team) => team.slug).sort()).toEqual(['growth', 'ops'])
  })
})
