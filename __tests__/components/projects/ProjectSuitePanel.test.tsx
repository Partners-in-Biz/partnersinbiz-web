import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectSuitePanel } from '@/components/projects/ProjectSuitePanel'

function suiteResponse() {
  return {
    health: { level: 'watch', score: 82, blockedTasks: 0, overdueTasks: 1, waitingApprovals: 1, milestoneDrift: 1 },
    milestones: [{ id: 'milestone-1', title: 'Design sprint', startDate: '2026-06-01', dueDate: '2026-06-10', baselineDueDate: '2026-06-08', status: 'active' }],
    approvals: [],
    risks: [],
    decisions: [],
    baselines: [{ id: 'baseline-1', title: 'Website launch baseline', status: 'active' }],
    playbooks: [{ id: 'playbook-1', title: 'Weekly launch rhythm', cadence: 'weekly', status: 'active' }],
    automations: [{ id: 'automation-1', title: 'Milestone drift alert', trigger: 'milestone_drift', status: 'active' }],
    permissions: [],
    audit: [],
    notificationSettings: [],
    capacities: [{ id: 'capacity-1', title: 'Peet capacity', uid: 'owner-1', displayName: 'Peet Stander', capacityMinutes: 480, status: 'active' }],
    revenue: [{ id: 'revenue-1', title: 'Launch retainer', amount: 12500, currency: 'ZAR', status: 'active' }],
    timeline: {
      driftCount: 1,
      dependencyCount: 1,
      items: [
        { id: 'milestone-1', kind: 'milestone', title: 'Design sprint', startDate: '2026-06-01', dueDate: '2026-06-10', baselineDueDate: '2026-06-08', baselineDriftDays: 2, dependencies: ['task-1'] },
      ],
    },
    workload: {
      assignees: [{ uid: 'owner-1', name: 'Peet Stander', assignedTasks: 2, estimateMinutes: 300, capacityMinutes: 480, utilizationPercent: 63 }],
      totalEstimateMinutes: 300,
      totalCapacityMinutes: 480,
      overCapacityCount: 0,
    },
    reports: { tasks: { total: 0, blocked: 0 }, approvals: { waiting: 0 }, revenue: { trackedAmount: 0, currency: 'ZAR' } },
  }
}

describe('ProjectSuitePanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/projects/project-1/suite' && method === 'GET') {
        return { ok: true, json: async () => ({ data: suiteResponse() }) } as Response
      }
      if (url === '/api/v1/projects/project-1/suite' && ['POST', 'PATCH', 'DELETE'].includes(method)) {
        return { ok: true, json: async () => ({ data: { id: 'saved' } }) } as Response
      }
      if (url === '/api/v1/projects/project-1/tasks/task-1' && method === 'PATCH') {
        return { ok: true, json: async () => ({ data: { id: 'task-1' } }) } as Response
      }
      return { ok: true, json: async () => ({ data: {} }) } as Response
    }) as jest.Mock
  })

  it('creates timeline milestones with dependencies and baseline dates from the Plan editor', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Design sprint').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('New timeline title'), { target: { value: 'Content QA' } })
    fireEvent.change(screen.getByLabelText('Timeline start date'), { target: { value: '2026-06-11' } })
    fireEvent.change(screen.getByLabelText('Timeline due date'), { target: { value: '2026-06-18' } })
    fireEvent.change(screen.getByLabelText('Timeline baseline due date'), { target: { value: '2026-06-15' } })
    fireEvent.change(screen.getByLabelText('Timeline dependencies'), { target: { value: 'task-1, milestone-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timeline item' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'milestone',
        title: 'Content QA',
        startDate: '2026-06-11',
        dueDate: '2026-06-18',
        baselineDueDate: '2026-06-15',
        dependsOn: ['task-1', 'milestone-1'],
        visibility: 'project',
      }),
    })))
  })

  it('renders a Gantt-style timeline with baseline drift and dependency cues', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByLabelText('Project Gantt timeline')).toBeInTheDocument())
    expect(screen.getByText('Timeline Gantt')).toBeInTheDocument()
    expect(screen.getByText('2d drift')).toBeInTheDocument()
    expect(screen.getByText('Depends on task-1')).toBeInTheDocument()
    expect(screen.getByLabelText('Design sprint Gantt bar')).toBeInTheDocument()
  })

  it('edits existing timeline records and project controls from the Plan editor', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Design sprint').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Design sprint' }))
    fireEvent.change(screen.getByLabelText('Edit timeline due date'), { target: { value: '2026-06-20' } })
    fireEvent.change(screen.getByLabelText('Edit timeline baseline due date'), { target: { value: '2026-06-15' } })
    fireEvent.change(screen.getByLabelText('Edit timeline dependencies'), { target: { value: 'task-1, approval-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timeline changes' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        type: 'milestone',
        id: 'milestone-1',
        title: 'Design sprint',
        startDate: '2026-06-01',
        dueDate: '2026-06-20',
        baselineDueDate: '2026-06-15',
        dependsOn: ['task-1', 'approval-1'],
        visibility: 'project',
      }),
    })))

    fireEvent.change(screen.getByLabelText('Playbook title'), { target: { value: 'Weekly launch rhythm' } })
    fireEvent.change(screen.getByLabelText('Playbook cadence'), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save playbook' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'playbook',
        title: 'Weekly launch rhythm',
        cadence: 'weekly',
        visibility: 'project',
      }),
    })))

    fireEvent.change(screen.getByLabelText('Notification title'), { target: { value: 'Approval reminder' } })
    fireEvent.change(screen.getByLabelText('Notification channel'), { target: { value: 'email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save notification' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'notification',
        title: 'Approval reminder',
        channel: 'email',
        visibility: 'project',
      }),
    })))
  })

  it('archives suite control records from the Plan lists', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Weekly launch rhythm').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Archive Weekly launch rhythm' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({
        type: 'playbook',
        id: 'playbook-1',
      }),
    })))
  })

  it('creates automation, capacity, and revenue planning records from the Plan controls', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Peet Stander').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('Automation title'), { target: { value: 'Weekly status automation' } })
    fireEvent.change(screen.getByLabelText('Automation trigger'), { target: { value: 'weekly_status' } })
    fireEvent.change(screen.getByLabelText('Automation channels'), { target: { value: 'email, in_app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'automation',
        title: 'Weekly status automation',
        trigger: 'weekly_status',
        notificationChannels: ['email', 'in_app'],
        visibility: 'restricted',
      }),
    })))

    fireEvent.change(screen.getByLabelText('Capacity member'), { target: { value: 'owner-1' } })
    fireEvent.change(screen.getByLabelText('Weekly capacity minutes'), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save capacity' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'capacity',
        title: 'Peet Stander weekly capacity',
        uid: 'owner-1',
        displayName: 'Peet Stander',
        capacityMinutes: 1200,
        visibility: 'internal',
      }),
    })))

    fireEvent.change(screen.getByLabelText('Revenue title'), { target: { value: 'Launch retainer' } })
    fireEvent.change(screen.getByLabelText('Revenue amount'), { target: { value: '25000' } })
    fireEvent.change(screen.getByLabelText('Revenue currency'), { target: { value: 'ZAR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save revenue' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'revenue',
        title: 'Launch retainer',
        amount: 25000,
        currency: 'ZAR',
        visibility: 'internal',
      }),
    })))
  })
})
