import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectSuitePanel } from '@/components/projects/ProjectSuitePanel'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function suiteResponse(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

function suiteFetchResponse(data: ReturnType<typeof suiteResponse>) {
  return { ok: true, json: async () => ({ data }) } as Response
}

describe('ProjectSuitePanel', () => {
  let currentSuiteResponse: ReturnType<typeof suiteResponse>

  beforeEach(() => {
    currentSuiteResponse = suiteResponse()
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/projects/project-1/suite' && method === 'GET') {
        return { ok: true, json: async () => ({ data: currentSuiteResponse }) } as Response
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
    fireEvent.change(screen.getByLabelText('Template steps'), { target: { value: 'Kickoff' } })
    fireEvent.change(screen.getByLabelText('Agent task specification'), { target: { value: 'Run the approved weekly launch step.' } })
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
        template: {
          schemaVersion: 1,
          steps: [{
            stepId: 'step-1',
            taskKind: 'agent',
            title: 'Kickoff',
            assigneeAgentId: 'theo',
            agentInput: { spec: 'Run the approved weekly launch step.' },
            dependsOnStepIds: [],
            requiredCapability: 'engineering',
            riskLevel: 'medium',
            reviewerAgentId: 'qa-release',
            expectedArtifacts: ['Completion summary', 'Evidence links'],
            verifierChecklist: ['Acceptance criteria met', 'Evidence attached'],
            labels: ['playbook'],
          }],
        },
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

  it('creates structured agent-ready playbooks with sequential dependencies and common execution metadata', async () => {
    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getAllByText('Weekly launch rhythm').length).toBeGreaterThan(0))
    expect(screen.getByText('FREQ=WEEKLY;INTERVAL=1')).toBeInTheDocument()
    expect(screen.getByText('2 steps')).toBeInTheDocument()
    expect(screen.getByText('Auto-create')).toBeInTheDocument()
    expect(screen.getByText('Agent execution details')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Playbook title'), { target: { value: 'Monthly launch template' } })
    fireEvent.change(screen.getByLabelText('Playbook cadence'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('Playbook template'), { target: { value: 'delivery' } })
    fireEvent.change(screen.getByLabelText('Recurrence rule'), { target: { value: 'FREQ=MONTHLY;INTERVAL=1' } })
    fireEvent.change(screen.getByLabelText('Next run date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Template steps'), { target: { value: 'Kickoff, QA, Client signoff' } })
    fireEvent.change(screen.getByLabelText('Common assignee agent'), { target: { value: 'maya' } })
    fireEvent.change(screen.getByLabelText('Agent task specification'), { target: { value: 'Execute each launch step using the approved project brief.' } })
    fireEvent.change(screen.getByLabelText('Required capability'), { target: { value: 'content' } })
    fireEvent.change(screen.getByLabelText('Risk level'), { target: { value: 'high' } })
    fireEvent.change(screen.getByLabelText('Reviewer agent'), { target: { value: 'qa-release' } })
    fireEvent.change(screen.getByLabelText('Expected artifacts'), { target: { value: 'completion summary, evidence links' } })
    fireEvent.change(screen.getByLabelText('Verifier checklist'), { target: { value: 'Acceptance criteria met, Evidence attached' } })
    fireEvent.change(screen.getByLabelText('Playbook labels'), { target: { value: 'launch, recurring' } })
    fireEvent.change(screen.getByLabelText('Approval gate'), { target: { value: 'production-deploy' } })
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
        template: {
          schemaVersion: 1,
          steps: [
            {
              stepId: 'approval-gate-1',
              taskKind: 'approval-gate',
              title: 'Approval: production deploy',
              dependsOnStepIds: [],
              approvalGate: 'production-deploy',
              riskLevel: 'high',
              expectedArtifacts: ['completion summary', 'evidence links'],
              verifierChecklist: ['Acceptance criteria met', 'Evidence attached'],
              labels: ['launch', 'recurring'],
            },
            {
              stepId: 'step-1',
              taskKind: 'agent',
              title: 'Kickoff',
              assigneeAgentId: 'maya',
              agentInput: { spec: 'Execute each launch step using the approved project brief.' },
              dependsOnStepIds: [],
              requiredCapability: 'content',
              riskLevel: 'high',
              reviewerAgentId: 'qa-release',
              expectedArtifacts: ['completion summary', 'evidence links'],
              verifierChecklist: ['Acceptance criteria met', 'Evidence attached'],
              labels: ['launch', 'recurring'],
              approvalGateStepId: 'approval-gate-1',
            },
            {
              stepId: 'step-2',
              taskKind: 'agent',
              title: 'QA',
              assigneeAgentId: 'maya',
              agentInput: { spec: 'Execute each launch step using the approved project brief.' },
              dependsOnStepIds: ['step-1'],
              requiredCapability: 'content',
              riskLevel: 'high',
              reviewerAgentId: 'qa-release',
              expectedArtifacts: ['completion summary', 'evidence links'],
              verifierChecklist: ['Acceptance criteria met', 'Evidence attached'],
              labels: ['launch', 'recurring'],
              approvalGateStepId: 'approval-gate-1',
            },
            {
              stepId: 'step-3',
              taskKind: 'agent',
              title: 'Client signoff',
              assigneeAgentId: 'maya',
              agentInput: { spec: 'Execute each launch step using the approved project brief.' },
              dependsOnStepIds: ['step-2'],
              requiredCapability: 'content',
              riskLevel: 'high',
              reviewerAgentId: 'qa-release',
              expectedArtifacts: ['completion summary', 'evidence links'],
              verifierChecklist: ['Acceptance criteria met', 'Evidence attached'],
              labels: ['launch', 'recurring'],
              approvalGateStepId: 'approval-gate-1',
            },
          ],
        },
        visibility: 'project',
      }),
    })))
  })

  it('shows every Decision Brief field plus revision and digest before confirmation', async () => {
    currentSuiteResponse = suiteResponse({
      planningDiscovery: {
        revision: 7,
        status: 'brief_ready',
        mode: 'interview',
        confidence: 97,
        digest: 'digest-abc-123',
        brief: {
          outcome: 'Launch a reliable client portal',
          user: 'Client operations managers',
          whyNow: 'The current handoff is manual',
          successCriteria: ['Tasks update without refresh'],
          constraints: ['Use the existing design system'],
          outOfScope: ['Billing migration'],
          assumptions: ['Existing APIs remain stable'],
          risks: ['Cross-org data leakage'],
          approvalGates: ['production-deploy'],
        },
      },
    })

    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByText('Launch a reliable client portal')).toBeInTheDocument())
    expect(screen.getByText('Client operations managers')).toBeInTheDocument()
    expect(screen.getByText('The current handoff is manual')).toBeInTheDocument()
    expect(screen.getByText('Tasks update without refresh')).toBeInTheDocument()
    expect(screen.getByText('Use the existing design system')).toBeInTheDocument()
    expect(screen.getByText('Billing migration')).toBeInTheDocument()
    expect(screen.getByText('Existing APIs remain stable')).toBeInTheDocument()
    expect(screen.getByText('Cross-org data leakage')).toBeInTheDocument()
    expect(screen.getByText('production-deploy')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('digest-abc-123')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Decision Brief' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/planning-discovery', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ type: 'confirm', expectedRevision: 7, expectedDigest: 'digest-abc-123' }),
    })))
  })

  it('renders interview turns and submits answers for the pending planning question', async () => {
    currentSuiteResponse = suiteResponse({
      planningDiscovery: {
        revision: 3,
        status: 'interviewing',
        mode: 'interview',
        pendingQuestionId: 'q-3',
        turns: [
          {
            id: 'q-2',
            question: 'Who is the primary user of this project?',
            currentGuess: 'Client operations managers',
            answer: 'Client operations managers',
          },
          {
            id: 'q-3',
            question: 'What does success look like in 30 days?',
            currentGuess: 'Tasks update without refresh',
          },
        ],
      },
    })

    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByTestId('planning-interview-turns')).toBeInTheDocument())
    expect(screen.getByText(/Who is the primary user of this project\?/)).toBeInTheDocument()
    expect(screen.getAllByText(/What does success look like in 30 days\?/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('planning-answer-form')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Planning interview answer'), {
      target: { value: 'Kanban and Plan stay live without manual refresh.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/planning-discovery', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'answer_question',
        expectedRevision: 3,
        expectedQuestionId: 'q-3',
        answer: 'Kanban and Plan stay live without manual refresh.',
      }),
    })))
  })

  it('requires an explicit operational-gates acknowledgement before planning with assumptions', async () => {
    const brief = {
      outcome: 'Launch a reliable client portal',
      user: 'Client operations managers',
      whyNow: 'The current handoff is manual',
      successCriteria: ['Tasks update without refresh'],
      constraints: ['Use the existing design system'],
      outOfScope: ['Billing migration'],
      assumptions: ['Existing APIs remain stable'],
      risks: ['Cross-org data leakage'],
      approvalGates: ['production-deploy'],
    }
    currentSuiteResponse = suiteResponse({
      planningDiscovery: { revision: 4, status: 'interviewing', mode: 'interview', digest: 'digest-yolo', brief },
    })

    render(<ProjectSuitePanel projectId="project-1" />)

    await waitFor(() => expect(screen.getByText('Launch a reliable client portal')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Plan with assumptions (YOLO)'))
    fireEvent.change(screen.getByLabelText('Planning assumptions attestation'), { target: { value: 'PLAN WITH ASSUMPTIONS' } })
    fireEvent.change(screen.getByLabelText('Planning assumptions reason'), { target: { value: 'The project must start today.' } })

    const submit = screen.getByRole('button', { name: 'Attest and plan with assumptions' })
    expect(submit).toBeDisabled()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/projects/project-1/planning-discovery', expect.anything())

    fireEvent.click(screen.getByLabelText('I acknowledge all operational approval gates remain required'))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/planning-discovery', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'plan_with_assumptions',
        expectedRevision: 4,
        attestation: 'PLAN WITH ASSUMPTIONS',
        reason: 'The project must start today.',
        acknowledgesPreservedOperationalGates: true,
        brief,
      }),
    })))
  })

  it('shows Pip’s one pending question and submits the direct human answer', async () => {
    currentSuiteResponse = suiteResponse({
      planningDiscovery: {
        revision: 3,
        status: 'interviewing',
        mode: 'interview',
        pendingQuestionId: 'q-3',
        turns: [{
          id: 'q-3',
          question: 'Which outcome matters most for this release?',
          currentGuess: 'A safe development-only implementation',
          askedBy: 'agent:pip',
          askedAt: '2026-07-27T00:00:00.000Z',
        }],
      },
    })

    render(<ProjectSuitePanel projectId="project-1" />)
    await waitFor(() => expect(screen.getByText('Which outcome matters most for this release?')).toBeInTheDocument())
    expect(screen.getByText('A safe development-only implementation')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Planning answer'), { target: { value: 'Ship the approved workflow safely on development.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Answer Pip' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/planning-discovery', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        type: 'answer_question',
        expectedRevision: 3,
        expectedQuestionId: 'q-3',
        answer: 'Ship the approved workflow safely on development.',
      }),
    })))
  })

  it('preserves the unsaved Pip interview answer when the revision conflicts', async () => {
    currentSuiteResponse = suiteResponse({
      planningDiscovery: {
        revision: 3,
        status: 'interviewing',
        mode: 'interview',
        pendingQuestionId: 'q-3',
        turns: [{
          id: 'q-3',
          question: 'Which outcome matters most for this release?',
          currentGuess: 'A safe development-only implementation',
          askedBy: 'agent:pip',
          askedAt: '2026-07-27T00:00:00.000Z',
        }],
      },
    })
    const baseFetch = global.fetch as jest.Mock
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/projects/project-1/planning-discovery') {
        return { ok: false, status: 409, json: async () => ({ error: 'Planning discovery revision is stale' }) } as Response
      }
      return baseFetch(input, init)
    }) as jest.Mock

    render(<ProjectSuitePanel projectId="project-1" />)
    await waitFor(() => expect(screen.getByText('Which outcome matters most for this release?')).toBeInTheDocument())
    const input = screen.getByLabelText('Planning answer')
    fireEvent.change(input, { target: { value: 'Keep this answer after the conflict.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Answer Pip' }))

    await waitFor(() => expect(screen.getByText('Planning discovery revision is stale')).toBeInTheDocument())
    expect(input).toHaveValue('Keep this answer after the conflict.')
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

  it('refreshes visible Plan data every 60 seconds without clearing unsaved form drafts', async () => {
    jest.useFakeTimers()
    try {
      render(<ProjectSuitePanel projectId="project-1" />)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      fireEvent.change(screen.getByLabelText('Playbook title'), { target: { value: 'Unsaved planning draft' } })
      expect(screen.getByLabelText('Playbook title')).toHaveValue('Unsaved planning draft')

      await act(async () => {
        jest.advanceTimersByTime(60_000)
        await Promise.resolve()
        await Promise.resolve()
      })

      const suiteGets = (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => String(url).endsWith('/suite') && (!init || !init.method || init.method === 'GET'))
      expect(suiteGets).toHaveLength(2)
      expect(screen.getByLabelText('Playbook title')).toHaveValue('Unsaved planning draft')
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not poll while the Plan tab is hidden and refreshes when it becomes visible', async () => {
    jest.useFakeTimers()
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    let visibility: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    try {
      render(<ProjectSuitePanel projectId="project-1" />)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })

      visibility = 'hidden'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        jest.advanceTimersByTime(45_000)
        await Promise.resolve()
      })
      const hiddenGets = (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => String(url).endsWith('/suite') && (!init || !init.method || init.method === 'GET'))
      expect(hiddenGets).toHaveLength(1)

      visibility = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
        await Promise.resolve()
      })
      const visibleGets = (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => String(url).endsWith('/suite') && (!init || !init.method || init.method === 'GET'))
      expect(visibleGets).toHaveLength(2)
    } finally {
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
      else delete (document as unknown as { visibilityState?: DocumentVisibilityState }).visibilityState
      jest.useRealTimers()
    }
  })

  it('queues one post-mutation refresh behind the initial Plan request without overlapping it', async () => {
    jest.useFakeTimers()
    const initial = deferred<Response>()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/suite') && method === 'GET') return initial.promise
      if (url.endsWith('/suite') && method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'saved' } }) } as Response)
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response)
    }) as jest.Mock

    try {
      render(<ProjectSuitePanel projectId="project-1" />)
      expect(global.fetch).toHaveBeenCalledTimes(1)

      fireEvent.change(screen.getByLabelText('Automation title'), { target: { value: 'Draft automation' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save automation' }))
      await act(async () => {
        jest.advanceTimersByTime(15_000)
        await Promise.resolve()
        await Promise.resolve()
      })

      const suiteGets = (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => String(url).endsWith('/suite') && (!init || !init.method || init.method === 'GET'))
      expect(suiteGets).toHaveLength(1)

      await act(async () => {
        initial.resolve(suiteFetchResponse(suiteResponse()))
        await initial.promise
        await Promise.resolve()
        await Promise.resolve()
      })
      const refreshedSuiteGets = (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => String(url).endsWith('/suite') && (!init || !init.method || init.method === 'GET'))
      expect(refreshedSuiteGets).toHaveLength(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('ignores a stale Plan error after a newer project request succeeds', async () => {
    const projectOne = deferred<Response>()
    const projectTwo = deferred<Response>()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects/project-1/suite') return projectOne.promise
      if (url === '/api/v1/projects/project-2/suite') return projectTwo.promise
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response)
    }) as jest.Mock

    const view = render(<ProjectSuitePanel projectId="project-1" />)
    view.rerender(<ProjectSuitePanel projectId="project-2" />)

    await act(async () => {
      projectTwo.resolve(suiteFetchResponse(suiteResponse({ health: { level: 'healthy', score: 99 } })))
      await projectTwo.promise
      await Promise.resolve()
    })
    expect(screen.getByText('99')).toBeInTheDocument()

    await act(async () => {
      projectOne.reject(new Error('stale project failure'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('stale project failure')).not.toBeInTheDocument()
    expect(screen.getByText('99')).toBeInTheDocument()
  })

  it('ignores a stale Plan success after a newer project request succeeds', async () => {
    const projectOne = deferred<Response>()
    const projectTwo = deferred<Response>()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects/project-1/suite') return projectOne.promise
      if (url === '/api/v1/projects/project-2/suite') return projectTwo.promise
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response)
    }) as jest.Mock

    const view = render(<ProjectSuitePanel projectId="project-1" />)
    view.rerender(<ProjectSuitePanel projectId="project-2" />)

    await act(async () => {
      projectTwo.resolve(suiteFetchResponse(suiteResponse({ health: { level: 'healthy', score: 99 } })))
      await projectTwo.promise
      await Promise.resolve()
    })
    expect(screen.getByText('99')).toBeInTheDocument()

    await act(async () => {
      projectOne.resolve(suiteFetchResponse(suiteResponse({ health: { level: 'critical', score: 12 } })))
      await projectOne.promise
      await Promise.resolve()
    })
    expect(screen.queryByText('12')).not.toBeInTheDocument()
    expect(screen.getByText('99')).toBeInTheDocument()
  })
})
