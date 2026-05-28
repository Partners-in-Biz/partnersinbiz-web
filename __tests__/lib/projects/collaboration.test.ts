import {
  buildProjectHealth,
  buildProjectReports,
  buildProjectTimeline,
  buildProjectWorkload,
  canProjectRole,
  filterInternalItemsForProjectAccess,
  filterProjectItemsForAccess,
  normalizeProjectRole,
  projectMemberDocId,
  projectOrganizationDocId,
} from '@/lib/projects/collaboration'
import type { ApiUser } from '@/lib/api/types'

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

  it('filters fine-grained item permissions by project role, user, and organisation', () => {
    const items = [
      { id: 'public', title: 'Shared task' },
      { id: 'internal', title: 'Internal task', visibility: 'internal' },
      { id: 'role', title: 'Managers only', allowedRoleIds: ['manager'] },
      { id: 'org', title: 'Partner org', allowedOrgIds: ['partner-org'] },
      { id: 'user', title: 'Named user', allowedUserIds: ['external-1'] },
    ]

    const externalItems = filterProjectItemsForAccess(items, {
      projectAccess: { role: 'reviewer', source: 'project_organization', canViewInternal: false },
      user: { uid: 'external-1', role: 'client', orgId: 'partner-org' } satisfies Pick<ApiUser, 'uid' | 'role' | 'orgId'>,
    })

    expect(externalItems.map((item) => item.id)).toEqual(['public', 'org', 'user'])
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

  it('builds timeline, workload, and reporting signals for PM suite views', () => {
    const tasks = [
      {
        id: 'task-1',
        title: 'Build launch page',
        columnId: 'blocked',
        startDate: '2026-01-01',
        dueDate: '2026-01-10',
        baselineDueDate: '2026-01-05',
        estimateMinutes: 120,
        assigneeIds: ['owner-1'],
        dependsOn: ['task-0'],
      },
      {
        id: 'task-2',
        title: 'QA launch page',
        columnId: 'done',
        dueDate: '2026-01-11',
        estimateMinutes: 60,
        assigneeIds: ['owner-1', 'qa-1'],
      },
    ]
    const milestones = [
      {
        id: 'milestone-1',
        title: 'Launch readiness',
        startDate: '2026-01-01',
        dueDate: '2026-01-15',
        baselineDueDate: '2026-01-10',
        dependsOn: ['task-1'],
      },
    ]

    const timeline = buildProjectTimeline({ tasks, milestones, baselines: [{ id: 'baseline-1', title: 'Website launch baseline' }] })
    const workload = buildProjectWorkload({
      tasks,
      capacities: [{ uid: 'owner-1', displayName: 'Peet Stander', capacityMinutes: 480 }],
    })
    const reports = buildProjectReports({
      tasks,
      milestones,
      approvals: [{ id: 'approval-1', status: 'pending' }],
      risks: [{ id: 'risk-1', severity: 'high' }],
      revenue: [{ id: 'rev-1', amount: 12500, currency: 'ZAR' }],
    })

    expect(timeline.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-1', kind: 'task', dependencies: ['task-0'], baselineDriftDays: 5 }),
      expect.objectContaining({ id: 'milestone-1', kind: 'milestone', dependencies: ['task-1'], baselineDriftDays: 5 }),
    ]))
    expect(timeline.driftCount).toBe(2)
    expect(workload.assignees).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'owner-1', name: 'Peet Stander', assignedTasks: 2, estimateMinutes: 180, capacityMinutes: 480, utilizationPercent: 38 }),
      expect.objectContaining({ uid: 'qa-1', assignedTasks: 1, estimateMinutes: 60 }),
    ]))
    expect(reports.tasks).toEqual(expect.objectContaining({ total: 2, done: 1, blocked: 1 }))
    expect(reports.approvals.waiting).toBe(1)
    expect(reports.risks.high).toBe(1)
    expect(reports.revenue).toEqual(expect.objectContaining({ trackedAmount: 12500, currency: 'ZAR' }))
  })
})
