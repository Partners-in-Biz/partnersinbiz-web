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
    playbooks: [{
      id: 'playbook-1',
      title: 'Weekly launch rhythm',
      cadence: 'weekly',
      status: 'active',
      templateKind: 'delivery',
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      nextRunAt: '2026-06-01',
      autoCreateTasks: true,
      templateSteps: ['Kickoff', 'QA'],
    }],
    automations: [{ id: 'automation-1', title: 'Milestone drift alert', trigger: 'milestone_drift', status: 'active' }],
    permissions: [{
      id: 'permission-1',
      title: 'Manager-only launch gate',
      itemType: 'milestone',
      itemId: 'milestone-1',
      visibility: 'restricted',
      allowedRoleIds: ['manager'],
      allowedUserIds: ['owner-1'],
      allowedOrgIds: ['owner-org'],
      status: 'active',
    }],
    audit: [{ id: 'audit-1', title: 'Launch gate updated', eventType: 'suite_updated', itemType: 'milestone', itemId: 'milestone-1', actorName: 'Peet Stander', createdAt: '2026-06-01' }],
    notificationSettings: [{
      id: 'notification-1',
      title: 'Approval waiting reminders',
      eventType: 'approval_waiting',
      itemType: 'approval',
      channel: 'both',
      recipientRoleIds: ['manager', 'reviewer'],
      enabled: true,
      status: 'active',
    }],
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
      assignees: [
        { uid: 'owner-1', name: 'Peet Stander', assignedTasks: 2, estimateMinutes: 300, capacityMinutes: 480, utilizationPercent: 63, remainingMinutes: 180, overByMinutes: 0 },
        { uid: 'designer-1', name: 'Design Lead', assignedTasks: 0, estimateMinutes: 0, capacityMinutes: 600, utilizationPercent: 0, remainingMinutes: 600, overByMinutes: 0 },
      ],
      totalEstimateMinutes: 300,
      totalCapacityMinutes: 1080,
      totalRemainingMinutes: 780,
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

  it('opens timeline editing directly from a Gantt row', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByLabelText('Project Gantt timeline')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Gantt Design sprint' }))
    fireEvent.change(screen.getByLabelText('Edit timeline due date'), { target: { value: '2026-06-22' } })
    fireEvent.change(screen.getByLabelText('Edit timeline dependencies'), { target: { value: 'task-1, task-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timeline changes' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        type: 'milestone',
        id: 'milestone-1',
        title: 'Design sprint',
        startDate: '2026-06-01',
        dueDate: '2026-06-22',
        baselineDueDate: '2026-06-08',
        dependsOn: ['task-1', 'task-2'],
        visibility: 'project',
      }),
    })))
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
        templateKind: 'delivery',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
        nextRunAt: null,
        autoCreateTasks: false,
        templateSteps: [],
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
        eventType: 'approval_waiting',
        itemType: 'approval',
        channel: 'email',
        recipientRoleIds: ['manager'],
        enabled: false,
        visibility: 'project',
      }),
    })))
  })

  it('creates recurring playbook templates with recurrence and reusable steps', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Weekly launch rhythm').length).toBeGreaterThan(0))
    expect(screen.getByText('FREQ=WEEKLY;INTERVAL=1')).toBeInTheDocument()
    expect(screen.getByText('2 steps')).toBeInTheDocument()
    expect(screen.getByText('Auto-create')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Playbook title'), { target: { value: 'Monthly launch template' } })
    fireEvent.change(screen.getByLabelText('Playbook cadence'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('Playbook template'), { target: { value: 'delivery' } })
    fireEvent.change(screen.getByLabelText('Recurrence rule'), { target: { value: 'FREQ=MONTHLY;INTERVAL=1' } })
    fireEvent.change(screen.getByLabelText('Next run date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Template steps'), { target: { value: 'Kickoff, QA, Client signoff' } })
    fireEvent.click(screen.getByLabelText('Auto-create tasks'))
    fireEvent.click(screen.getByRole('button', { name: 'Save playbook' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'playbook',
        title: 'Monthly launch template',
        cadence: 'monthly',
        templateKind: 'delivery',
        recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
        nextRunAt: '2026-06-01',
        autoCreateTasks: true,
        templateSteps: ['Kickoff', 'QA', 'Client signoff'],
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

  it('runs a recurring playbook from the Plan list', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Weekly launch rhythm').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Run Weekly launch rhythm' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'playbook',
        id: 'playbook-1',
        action: 'run',
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

  it('renders capacity-only people and remaining availability in workload planning', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Design Lead').length).toBeGreaterThan(0))
    expect(screen.getByText('0 tasks / 0m planned')).toBeInTheDocument()
    expect(screen.getByText('10h remaining')).toBeInTheDocument()
    expect(screen.getByText('13h remaining')).toBeInTheDocument()
  })

  it('creates targeted access policies and notification controls from the Plan controls', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByText('Manager-only launch gate')).toBeInTheDocument())
    expect(screen.getAllByText('milestone milestone-1').length).toBeGreaterThan(0)
    expect(screen.getByText('owner-1')).toBeInTheDocument()
    expect(screen.getByText('owner-org')).toBeInTheDocument()
    expect(screen.getByText('Approval waiting reminders')).toBeInTheDocument()
    expect(screen.getAllByText('approval waiting').length).toBeGreaterThan(0)
    expect(screen.getByText('Enabled')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Permission title'), { target: { value: 'Manager-only launch gate' } })
    fireEvent.change(screen.getByLabelText('Permission target type'), { target: { value: 'milestone' } })
    fireEvent.change(screen.getByLabelText('Permission target id'), { target: { value: 'milestone-1' } })
    fireEvent.change(screen.getByLabelText('Permission visibility'), { target: { value: 'restricted' } })
    fireEvent.change(screen.getByLabelText('Allowed users'), { target: { value: 'owner-1' } })
    fireEvent.change(screen.getByLabelText('Allowed orgs'), { target: { value: 'owner-org' } })
    fireEvent.change(screen.getByLabelText('Allowed roles'), { target: { value: 'manager' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access control' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'permission',
        title: 'Manager-only launch gate',
        itemType: 'milestone',
        itemId: 'milestone-1',
        visibility: 'restricted',
        allowedUserIds: ['owner-1'],
        allowedOrgIds: ['owner-org'],
        allowedRoleIds: ['manager'],
      }),
    })))

    fireEvent.change(screen.getByLabelText('Notification title'), { target: { value: 'Approval waiting reminders' } })
    fireEvent.change(screen.getByLabelText('Notification event'), { target: { value: 'approval_waiting' } })
    fireEvent.change(screen.getByLabelText('Notification item type'), { target: { value: 'approval' } })
    fireEvent.change(screen.getByLabelText('Notification channel'), { target: { value: 'both' } })
    fireEvent.change(screen.getByLabelText('Notification recipients'), { target: { value: 'manager, reviewer' } })
    fireEvent.click(screen.getByLabelText('Notification enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save notification' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/suite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'notification',
        title: 'Approval waiting reminders',
        eventType: 'approval_waiting',
        itemType: 'approval',
        channel: 'both',
        recipientRoleIds: ['manager', 'reviewer'],
        enabled: true,
        visibility: 'project',
      }),
    })))
  })
})
