import {
  buildProjectHealth,
  canProjectRole,
  filterInternalItemsForProjectAccess,
  normalizeProjectRole,
  projectMemberDocId,
  projectOrganizationDocId,
} from '@/lib/projects/collaboration'

describe('project collaboration helpers', () => {
  it('uses deterministic ids for project-scoped access records', () => {
    expect(projectMemberDocId('project-1', 'user-1')).toBe('project-1_user-1')
    expect(projectOrganizationDocId('project-1', 'org-1')).toBe('project-1_org-1')
  })

  it('normalizes project roles and enforces role capabilities', () => {
    expect(normalizeProjectRole('owner')).toBe('owner')
    expect(normalizeProjectRole('manager')).toBe('manager')
    expect(normalizeProjectRole('unknown')).toBe('viewer')
    expect(canProjectRole('manager', 'manage_access')).toBe(true)
    expect(canProjectRole('contributor', 'manage_access')).toBe(false)
    expect(canProjectRole('reviewer', 'review')).toBe(true)
    expect(canProjectRole('viewer', 'write')).toBe(false)
  })

  it('filters internal-only items for external project collaborators', () => {
    const items = [
      { id: 'public', title: 'Shared task' },
      { id: 'internal', title: 'Internal task', internalOnly: true },
    ]

    expect(filterInternalItemsForProjectAccess(items, true).map((item) => item.id)).toEqual(['public', 'internal'])
    expect(filterInternalItemsForProjectAccess(items, false).map((item) => item.id)).toEqual(['public'])
  })

  it('computes project health from task and suite signals', () => {
    const health = buildProjectHealth({
      tasks: [
        { id: 'blocked', columnId: 'blocked', dueDate: '2026-01-01' },
        { id: 'overdue', columnId: 'todo', dueDate: '2026-01-02' },
        { id: 'agent-blocked', columnId: 'todo', agentStatus: 'blocked' },
      ],
      milestones: [{ id: 'late-launch', status: 'active', dueDate: '2026-01-03' }],
      approvals: [{ id: 'waiting', status: 'pending' }],
      now: new Date('2026-02-01T00:00:00.000Z'),
    })

    expect(health.level).toBe('at_risk')
    expect(health.score).toBeLessThan(80)
    expect(health.blockedTasks).toBe(2)
    expect(health.overdueTasks).toBe(2)
    expect(health.waitingApprovals).toBe(1)
    expect(health.milestoneDrift).toBe(1)
  })
})
