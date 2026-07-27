const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { loadAgentProjectPlan, type AgentSuiteRecord } from '@/lib/projects/agentSuiteProjection'
import type { ApiUser } from '@/lib/api/types'

const records: Record<string, AgentSuiteRecord[]> = {}

function row(id: string, orgId: string, values: Record<string, unknown> = {}): AgentSuiteRecord {
  return {
    id,
    visibility: 'restricted',
    allowedOrgIds: [orgId],
    ...values,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(records)) delete records[key]

  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== 'projects') throw new Error(`Unexpected collection ${collectionName}`)
    return {
      doc: jest.fn(() => ({
        collection: jest.fn((name: string) => ({
          get: jest.fn(async () => ({
            docs: (records[name] ?? []).map((record) => ({
              id: record.id,
              data: () => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id')),
            })),
          })),
        })),
      })),
    }
  })
})

function projectionInput() {
  const user: ApiUser = {
    uid: 'agent:theo',
    role: 'ai',
    orgId: 'org-home',
    orgIds: ['org-active', 'org-sibling'],
    allowedOrgIds: ['org-sibling'],
  }
  return {
    projectId: 'project-1',
    projectData: {},
    activeOrgId: 'org-active',
    user,
    projectAccess: { role: 'owner', source: 'ai', canViewInternal: true } as const,
  }
}

describe('active-org Agent Plan projection', () => {
  it('returns restricted Plan rows only for the active request organisation', async () => {
    records.milestones = [
      row('milestone-active', 'org-active', { title: 'Active milestone' }),
      row('milestone-sibling', 'org-sibling', { title: 'Sibling milestone' }),
    ]
    records.approvals = [
      row('approval-active', 'org-active', { status: 'pending' }),
      row('approval-sibling', 'org-sibling', { status: 'pending' }),
    ]
    records.risks = [
      row('risk-active', 'org-active', { severity: 'low' }),
      row('risk-sibling', 'org-sibling', { severity: 'critical' }),
    ]
    records.revenue = [
      row('revenue-active', 'org-active', { amount: 100, currency: 'ZAR' }),
      row('revenue-sibling', 'org-sibling', { amount: 900, currency: 'ZAR' }),
    ]

    const plan = await loadAgentProjectPlan({
      ...projectionInput(),
      tasks: [
        row('task-active', 'org-active', { title: 'Active task', columnId: 'todo' }),
        row('task-sibling', 'org-sibling', { title: 'Sibling task', columnId: 'blocked' }),
      ],
    })

    expect(plan.tasks.map((item) => item.id)).toEqual(['task-active'])
    expect(plan.milestones.map((item) => item.id)).toEqual(['milestone-active'])
    expect(plan.approvals.map((item) => item.id)).toEqual(['approval-active'])
    expect(plan.risks.map((item) => item.id)).toEqual(['risk-active'])
    expect(plan.revenue.map((item) => item.id)).toEqual(['revenue-active'])
  })

  it('builds every aggregate from active-org-safe rows so hidden sibling data cannot leak through counts or totals', async () => {
    records.milestones = [
      row('milestone-active', 'org-active', { title: 'Active milestone' }),
      row('milestone-sibling', 'org-sibling', { title: 'Sibling milestone' }),
    ]
    records.approvals = [
      row('approval-active', 'org-active', { status: 'approved' }),
      row('approval-sibling', 'org-sibling', { status: 'pending' }),
    ]
    records.risks = [
      row('risk-active', 'org-active', { severity: 'low', status: 'closed' }),
      row('risk-sibling', 'org-sibling', { severity: 'critical', status: 'open' }),
    ]
    records.capacities = [
      row('capacity-active', 'org-active', { uid: 'active-user', capacityMinutes: 480 }),
      row('capacity-sibling', 'org-sibling', { uid: 'sibling-user', capacityMinutes: 960 }),
    ]
    records.revenue = [
      row('revenue-active', 'org-active', { amount: 100, currency: 'ZAR' }),
      row('revenue-sibling', 'org-sibling', { amount: 900, currency: 'ZAR' }),
    ]

    const plan = await loadAgentProjectPlan({
      ...projectionInput(),
      tasks: [
        row('task-active', 'org-active', {
          title: 'Active task', columnId: 'todo', assigneeIds: ['active-user'], estimateMinutes: 60,
        }),
        row('task-sibling', 'org-sibling', {
          title: 'Sibling task', columnId: 'blocked', assigneeIds: ['sibling-user'], estimateMinutes: 600,
        }),
      ],
    })

    expect(plan.health).toEqual(expect.objectContaining({
      openTasks: 1,
      blockedTasks: 0,
      waitingApprovals: 0,
    }))
    expect(plan.timeline.items.map((item) => item.id)).toEqual(['task-active', 'milestone-active'])
    expect(plan.workload.assignees.map((item) => item.uid)).toEqual(['active-user'])
    expect(plan.reports).toEqual(expect.objectContaining({
      tasks: expect.objectContaining({ total: 1, blocked: 0 }),
      milestones: expect.objectContaining({ total: 1 }),
      approvals: expect.objectContaining({ total: 1, waiting: 0 }),
      risks: expect.objectContaining({ total: 1, high: 0, open: 0 }),
      revenue: expect.objectContaining({ trackedAmount: 100, records: 1 }),
    }))
  })
})
