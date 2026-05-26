import { moveProjectToClientOrg } from '@/lib/projects/transfer'

function makeDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { path: id },
    exists: true,
    data: () => data,
  }
}

function makeSnap(docs: Array<ReturnType<typeof makeDoc>>) {
  return { docs, empty: docs.length === 0 }
}

describe('moveProjectToClientOrg', () => {
  it('moves the project, denormalized task orgs, active project work, and skips billed financial records', async () => {
    const updates: Array<{ ref: unknown; data: Record<string, unknown> }> = []
    const sets: Array<{ ref: unknown; data: Record<string, unknown> }> = []
    const commits: number[] = []

    const batch = {
      update: jest.fn((ref, data) => updates.push({ ref, data })),
      set: jest.fn((ref, data) => sets.push({ ref, data })),
      commit: jest.fn(async () => commits.push(updates.length + sets.length)),
    }

    const projectDoc = makeDoc('projects/project-1', {
      orgId: 'old-org',
      clientId: 'old-org',
      clientOrgId: 'old-org',
      name: 'Website migration',
    })
    const targetOrgDoc = makeDoc('organizations/new-org', {
      name: 'New Client',
      slug: 'new-client',
      active: true,
    })

    const nestedTasks = [makeDoc('nested-task-1', { orgId: 'old-org' })]
    const standaloneTasks = [makeDoc('standalone-task-1', { orgId: 'old-org', projectId: 'project-1' })]
    const timeEntries = [
      makeDoc('time-open', { orgId: 'old-org', projectId: 'project-1' }),
      makeDoc('time-billed', { orgId: 'old-org', projectId: 'project-1', invoiceId: 'invoice-1' }),
    ]
    const expenses = [
      makeDoc('expense-open', { orgId: 'old-org', projectId: 'project-1', status: 'submitted' }),
      makeDoc('expense-billed', { orgId: 'old-org', projectId: 'project-1', invoiceId: 'invoice-1' }),
    ]
    const calendarEvents = [makeDoc('event-1', { orgId: 'old-org', relatedTo: { type: 'project', id: 'project-1' } })]

    const collection = jest.fn((name: string) => {
      if (name === 'projects') {
        return {
          doc: jest.fn((id: string) => ({
            path: `projects/${id}`,
            get: jest.fn(async () => projectDoc),
            collection: jest.fn(() => ({ get: jest.fn(async () => makeSnap(nestedTasks)) })),
          })),
        }
      }
      if (name === 'organizations') {
        return { doc: jest.fn(() => ({ path: 'organizations/new-org', get: jest.fn(async () => targetOrgDoc) })) }
      }
      if (name === 'tasks') return { where: jest.fn(() => ({ get: jest.fn(async () => makeSnap(standaloneTasks)) })) }
      if (name === 'time_entries') return { where: jest.fn(() => ({ get: jest.fn(async () => makeSnap(timeEntries)) })) }
      if (name === 'expenses') return { where: jest.fn(() => ({ get: jest.fn(async () => makeSnap(expenses)) })) }
      if (name === 'calendar_events') {
        return {
          where: jest.fn(() => ({
            where: jest.fn(() => ({ get: jest.fn(async () => makeSnap(calendarEvents)) })),
          })),
        }
      }
      throw new Error(`unexpected collection ${name}`)
    })

    const db = { collection, batch: jest.fn(() => batch) }

    const result = await moveProjectToClientOrg({
      db,
      projectId: 'project-1',
      targetOrgId: 'new-org',
      actorId: 'admin-1',
      actorRole: 'admin',
    })

    expect(result).toEqual(expect.objectContaining({
      projectId: 'project-1',
      fromOrgId: 'old-org',
      toOrgId: 'new-org',
      targetOrgSlug: 'new-client',
      counts: expect.objectContaining({
        projectTasks: 1,
        standaloneTasks: 1,
        timeEntriesMoved: 1,
        timeEntriesSkippedBilled: 1,
        expensesMoved: 1,
        expensesSkippedBilled: 1,
        calendarEvents: 1,
      }),
    }))

    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'new-org', clientId: 'new-org', clientOrgId: 'new-org' }) }),
      expect.objectContaining({ ref: nestedTasks[0].ref, data: expect.objectContaining({ orgId: 'new-org' }) }),
      expect.objectContaining({ ref: standaloneTasks[0].ref, data: expect.objectContaining({ orgId: 'new-org' }) }),
      expect.objectContaining({ ref: timeEntries[0].ref, data: expect.objectContaining({ orgId: 'new-org', clientOrgId: 'new-org' }) }),
      expect.objectContaining({ ref: expenses[0].ref, data: expect.objectContaining({ orgId: 'new-org', clientOrgId: 'new-org' }) }),
      expect.objectContaining({ ref: calendarEvents[0].ref, data: expect.objectContaining({ orgId: 'new-org' }) }),
    ]))
    expect(updates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: timeEntries[1].ref }),
      expect.objectContaining({ ref: expenses[1].ref }),
    ]))
    expect(commits.length).toBeGreaterThan(0)
  })
})
