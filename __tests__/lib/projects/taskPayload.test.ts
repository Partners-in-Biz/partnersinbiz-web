import {
  applyAgentColumnMoveState,
  applyAgentTodoRequeue,
  buildProjectTaskCreateData,
  buildProjectTaskUpdateData,
  taskOrderMillis,
} from '@/lib/projects/taskPayload'

describe('project task payload helpers', () => {
  it('keeps rich task creation fields for project kanban tasks', () => {
    const result = buildProjectTaskCreateData(
      {
        title: 'Ship new client portal',
        description: 'Acceptance criteria included.',
        columnId: 'in_progress',
        priority: 'high',
        order: 42,
        labels: ['client', 'blocked', 'client'],
        assigneeIds: ['user-1', 'user-2', 'user-1'],
        mentionIds: ['user-2'],
        dueDate: '2026-05-12',
        startDate: '2026-05-08',
        baselineDueDate: '2026-05-10',
        baselineStartDate: '2026-05-06',
        estimateMinutes: 180,
        checklist: [{ id: 'check-1', text: 'Confirm scope', done: false }],
        attachments: [{
          uploadId: 'upload-1',
          url: 'https://storage.googleapis.com/test-bucket/projects/p/tasks/screen.png',
          name: 'screen.png',
          size: 1200,
          mimeType: 'image/png',
        }],
      },
      'project-1',
      'org-1',
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual(expect.objectContaining({
      orgId: 'org-1',
      projectId: 'project-1',
      columnId: 'in_progress',
      title: 'Ship new client portal',
      priority: 'high',
      labels: ['client', 'blocked'],
      assigneeId: 'user-1',
      assigneeIds: ['user-1', 'user-2'],
      mentionIds: ['user-2'],
      dueDate: '2026-05-12',
      startDate: '2026-05-08',
      baselineDueDate: '2026-05-10',
      baselineStartDate: '2026-05-06',
      estimateMinutes: 180,
    }))
    expect(result.value.attachments).toEqual([
      expect.objectContaining({ uploadId: 'upload-1', mimeType: 'image/png' }),
    ])
    expect(result.value.checklist).toEqual([
      { id: 'check-1', text: 'Confirm scope', done: false },
    ])
  })


  it('defaults new project tasks into todo instead of backlog', () => {
    const result = buildProjectTaskCreateData({ title: 'Ready task' }, 'project-1', 'org-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.columnId).toBe('todo')
  })

  it('rejects attachment objects without a persisted url and name', () => {
    const result = buildProjectTaskCreateData(
      {
        title: 'Bad task',
        attachments: [{ name: 'missing-url.png' }],
      },
      'project-1',
      'org-1',
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/url and name/)
  })

  it('only emits valid update fields', () => {
    const result = buildProjectTaskUpdateData({
      title: 'Updated',
      labels: ['qa'],
      assigneeIds: ['user-3'],
      estimateMinutes: null,
      internalOnly: true,
      baselineDueDate: '2026-05-20',
      baselineStartDate: null,
      ignored: 'nope',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      title: 'Updated',
      labels: ['qa'],
      assigneeIds: ['user-3'],
      assigneeId: 'user-3',
      estimateMinutes: null,
      internalOnly: true,
      baselineDueDate: '2026-05-20',
      baselineStartDate: null,
    })
  })

  it('preserves internal-only visibility on task create and update', () => {
    const created = buildProjectTaskCreateData(
      { title: 'Internal blocker', internalOnly: true },
      'project-1',
      'org-1',
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.internalOnly).toBe(true)

    const updated = buildProjectTaskUpdateData({ internalOnly: false })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.internalOnly).toBe(false)
  })

  it('sorts legacy tasks without order after ordered tasks', () => {
    const tasks = [
      { id: 'legacy' },
      { id: 'later', order: 20 },
      { id: 'earlier', order: 10 },
    ].sort((a, b) => taskOrderMillis(a.order) - taskOrderMillis(b.order))

    expect(tasks.map(task => task.id)).toEqual(['earlier', 'later', 'legacy'])
  })

  describe('agent dispatch fields', () => {
    it('CREATE: schedules an agent task into backlog until its release time', () => {
      const result = buildProjectTaskCreateData(
        {
          title: 'Release Theo later',
          assigneeAgentId: 'theo',
          agentInput: { spec: 'Run only during office hours.' },
          agentReleaseAt: '2026-05-26T09:30:00.000Z',
        },
        'project-1',
        'org-1',
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual(expect.objectContaining({
        assigneeAgentId: 'theo',
        agentStatus: 'pending',
        columnId: 'backlog',
        agentReleaseStatus: 'scheduled',
        agentReleaseAt: '2026-05-26T09:30:00.000Z',
      }))
    })

    it('PATCH: accepts rescheduling, clearing, and release audit fields', () => {
      const scheduled = buildProjectTaskUpdateData({ agentReleaseAt: '2026-05-26T09:30:00.000Z' })
      expect(scheduled.ok).toBe(true)
      if (!scheduled.ok) return
      expect(scheduled.value).toEqual({
        agentReleaseAt: '2026-05-26T09:30:00.000Z',
        agentReleaseStatus: 'scheduled',
        columnId: 'backlog',
      })

      const cleared = buildProjectTaskUpdateData({ agentReleaseAt: null })
      expect(cleared.ok).toBe(true)
      if (!cleared.ok) return
      expect(cleared.value).toEqual({ agentReleaseAt: null, agentReleaseStatus: null })
    })

    it('sets assigneeAgentId + auto-initialises agentStatus=pending on create', () => {
      const result = buildProjectTaskCreateData(
        {
          title: 'Build /pricing page',
          assigneeAgentId: 'theo',
          agentInput: {
            spec: 'Build a /pricing page using the existing design system',
            context: {
              sourceDocumentId: ' doc-123 ',
              sourceDocumentSectionId: ' section-2 ',
              sourceSpecVersion: ' v4 ',
              approvalGateTaskId: ' gate-1 ',
              sourceResearchItemId: '',
              riskLevel: ' high ',
              requiredCapability: ' deploy ',
              requestedByAgentId: ' pip ',
              expectedArtifacts: [' pr ', '', ' preview-url '],
              otherContext: { keep: true },
            },
          },
          riskLevel: 'critical',
          agentEffort: 'high',
          agentModel: 'claude-sonnet-4-6',
          requiredCapability: 'deploy',
          requestedByAgentId: 'pip',
          expectedArtifacts: ['pull_request', 'deployment_url', 'test_report'],
          dependsOn: ['task-abc'],
          reviewerIds: ['reviewer-1'],
          reviewerAgentId: 'qa-release',
        },
        'project-1',
        'org-1',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual(expect.objectContaining({
        assigneeAgentId: 'theo',
        agentStatus: 'pending',
        agentInput: expect.objectContaining({ spec: 'Build a /pricing page using the existing design system' }),
        dependsOn: ['task-abc'],
        reviewerIds: ['reviewer-1'],
        reviewerAgentId: 'qa-release',
        riskLevel: 'critical',
        agentEffort: 'high',
        agentModel: 'claude-sonnet-4-6',
        requiredCapability: 'deploy',
        requestedByAgentId: 'pip',
        expectedArtifacts: ['pull_request', 'deployment_url', 'test_report'],
      }))
      expect(result.value.agentInput).toEqual({
        spec: 'Build a /pricing page using the existing design system',
        context: {
          sourceDocumentId: 'doc-123',
          sourceDocumentSectionId: 'section-2',
          sourceSpecVersion: 'v4',
          approvalGateTaskId: 'gate-1',
          riskLevel: 'high',
          requiredCapability: 'deploy',
          requestedByAgentId: 'pip',
          expectedArtifacts: ['pr', 'preview-url'],
          otherContext: { keep: true },
        },
      })
    })

    it('CREATE: accepts conservative loop review task capabilities', () => {
      const business = buildProjectTaskCreateData({
        title: 'Business Insight: lead gap',
        assigneeAgentId: 'pip',
        agentStatus: 'done',
        requiredCapability: 'business-insight-review',
      }, 'project-1', 'org-1')
      const evolution = buildProjectTaskCreateData({
        title: 'Agent Evolution Review: missing context',
        assigneeAgentId: 'pip',
        agentStatus: 'done',
        requiredCapability: 'agent-evolution-review',
      }, 'project-1', 'org-1')

      expect(business.ok).toBe(true)
      if (!business.ok) return
      expect(business.value.requiredCapability).toBe('business-insight-review')
      expect(business.value.columnId).toBe('review')
      expect(business.value.reviewStatus).toBe('pending')
      expect(evolution.ok).toBe(true)
      if (!evolution.ok) return
      expect(evolution.value.requiredCapability).toBe('agent-evolution-review')
      expect(evolution.value.columnId).toBe('review')
      expect(evolution.value.reviewStatus).toBe('pending')
    })

    it('accepts and clears agent effort/model overrides on update', () => {
      const setResult = buildProjectTaskUpdateData({
        agentEffort: 'xhigh',
        agentModel: 'gpt-5.5',
      })
      expect(setResult.ok).toBe(true)
      if (!setResult.ok) return
      expect(setResult.value).toEqual({
        agentEffort: 'xhigh',
        agentModel: 'gpt-5.5',
      })

      const clearResult = buildProjectTaskUpdateData({
        agentEffort: '',
        agentModel: null,
      })
      expect(clearResult.ok).toBe(true)
      if (!clearResult.ok) return
      expect(clearResult.value).toEqual({
        agentEffort: null,
        agentModel: null,
      })
    })

    it('rejects unknown agent effort/model overrides', () => {
      const effort = buildProjectTaskCreateData({ title: 'Bad effort', agentEffort: 'maximum' }, 'project-1', 'org-1')
      expect(effort.ok).toBe(false)
      if (!effort.ok) expect(effort.error).toMatch(/Invalid agentEffort/)

      const model = buildProjectTaskCreateData({ title: 'Bad model', agentModel: 'glm-4.7' }, 'project-1', 'org-1')
      expect(model.ok).toBe(false)
      if (!model.ok) expect(model.error).toMatch(/Invalid agentModel/)
    })

    it('CREATE: explicit gated agentStatus controls the starting column', () => {
      const result = buildProjectTaskCreateData(
        {
          title: 'Wait for approval before build',
          assigneeAgentId: 'theo',
          agentStatus: 'awaiting-input',
          agentInput: { spec: 'Do not start until Peet approves the spec.' },
        },
        'project-1',
        'org-1',
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual(expect.objectContaining({
        assigneeAgentId: 'theo',
        agentStatus: 'awaiting-input',
        columnId: 'blocked',
      }))
    })

    it('rejects invalid provenance/risk fields', () => {
      const result = buildProjectTaskCreateData(
        {
          title: 'Risky task',
          assigneeAgentId: 'theo',
          riskLevel: 'catastrophic',
          requiredCapability: 'deploy',
          agentInput: { spec: 'Ship it' },
        },
        'project-1',
        'org-1',
      )

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/Invalid riskLevel/)
    })

    it('rejects an unknown agent id', () => {
      const result = buildProjectTaskCreateData(
        { title: 't', assigneeAgentId: '1-rogue' },
        'project-1',
        'org-1',
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/Invalid assigneeAgentId/)
    })

    it('omits agent fields entirely when not provided (back-compat)', () => {
      const result = buildProjectTaskCreateData(
        { title: 'Plain human task' },
        'project-1',
        'org-1',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.assigneeAgentId).toBeUndefined()
      expect(result.value.agentStatus).toBeUndefined()
      expect(result.value.agentInput).toBeUndefined()
    })

    it('PATCH: reassigning to a new agent resets status to pending', () => {
      const result = buildProjectTaskUpdateData({ assigneeAgentId: 'maya' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual({ assigneeAgentId: 'maya', agentStatus: 'pending' })
    })

    it('PATCH: clearing the agent sets status to null', () => {
      const result = buildProjectTaskUpdateData({ assigneeAgentId: null })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual({ assigneeAgentId: null, agentStatus: null })
    })

    it('PATCH: explicit agentStatus overrides the auto-reset', () => {
      const result = buildProjectTaskUpdateData({
        assigneeAgentId: 'theo',
        agentStatus: 'in-progress',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual({ assigneeAgentId: 'theo', agentStatus: 'in-progress' })
    })

    it('PATCH: accepts provenance fields for gated work', () => {
      const result = buildProjectTaskUpdateData({
        riskLevel: 'high',
        requiredCapability: 'publish',
        requestedByAgentId: 'maya',
        expectedArtifacts: ['campaign-record', 'approval-note'],
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual({
        riskLevel: 'high',
        requiredCapability: 'publish',
        requestedByAgentId: 'maya',
        expectedArtifacts: ['campaign-record', 'approval-note'],
      })
    })

    it('PATCH: done moves to review and blocked moves to blocked when no column is supplied', () => {
      const done = buildProjectTaskUpdateData({ agentStatus: 'done' })
      expect(done.ok).toBe(true)
      if (!done.ok) return
      expect(done.value).toEqual({ agentStatus: 'done', columnId: 'review', reviewStatus: 'pending' })

      const blocked = buildProjectTaskUpdateData({ agentStatus: 'blocked' })
      expect(blocked.ok).toBe(true)
      if (!blocked.ok) return
      expect(blocked.value).toEqual({ agentStatus: 'blocked', columnId: 'blocked' })
    })

    it('PATCH: explicit column wins over agent status column automation', () => {
      const result = buildProjectTaskUpdateData({ agentStatus: 'done', columnId: 'review' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual({ agentStatus: 'done', columnId: 'review' })
    })

    it('PATCH: rejects unknown agentStatus', () => {
      const result = buildProjectTaskUpdateData({ agentStatus: 'cooked' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/Invalid agentStatus/)
    })

    it('PATCH: agentOutput must include summary', () => {
      const result = buildProjectTaskUpdateData({ agentOutput: { artifacts: [] } })
      expect(result.ok).toBe(false)
    })

    it('PATCH: validates artifact shape', () => {
      const ok = buildProjectTaskUpdateData({
        agentOutput: {
          summary: 'Built it',
          artifacts: [{ type: 'url', ref: 'https://example.com', label: 'Live site' }],
        },
      })
      expect(ok.ok).toBe(true)

      const bad = buildProjectTaskUpdateData({
        agentOutput: { summary: 's', artifacts: [{ type: 'url' }] },
      })
      expect(bad.ok).toBe(false)
    })

    it('PATCH: preserves agentOutput completedAt for task card end times', () => {
      const result = buildProjectTaskUpdateData({
        agentOutput: {
          summary: 'Built it',
          completedAt: '2026-05-22T22:58:00.000Z',
        },
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.agentOutput).toEqual({
        summary: 'Built it',
        completedAt: '2026-05-22T22:58:00.000Z',
      })
    })

    it('PATCH: moving a completed agent task back to todo requeues it for pickup', () => {
      const raw = buildProjectTaskUpdateData({ columnId: 'todo' })
      expect(raw.ok).toBe(true)
      if (!raw.ok) return

      const result = applyAgentTodoRequeue(
        { assigneeAgentId: 'theo', agentStatus: 'done' },
        raw.value,
        { columnId: 'todo' },
      )

      expect(result).toEqual({
        columnId: 'todo',
        agentStatus: 'pending',
        reviewStatus: 'changes-requested',
        agentOutput: null,
        agentConversationId: null,
        agentHeartbeatAt: null,
      })
    })

    it('PATCH: moving an agent task into progress marks it as actively in progress', () => {
      const raw = buildProjectTaskUpdateData({ columnId: 'in_progress' })
      expect(raw.ok).toBe(true)
      if (!raw.ok) return

      const result = applyAgentColumnMoveState(
        { assigneeAgentId: 'theo', agentStatus: 'pending', reviewStatus: 'pending' },
        raw.value,
        { columnId: 'in_progress' },
      )

      expect(result).toEqual({
        columnId: 'in_progress',
        agentStatus: 'in-progress',
        reviewStatus: null,
      })
    })

    it('PATCH: explicit agentStatus is respected when moving columns', () => {
      const raw = buildProjectTaskUpdateData({ columnId: 'todo', agentStatus: 'done' })
      expect(raw.ok).toBe(true)
      if (!raw.ok) return

      const result = applyAgentTodoRequeue(
        { assigneeAgentId: 'theo', agentStatus: 'done' },
        raw.value,
        { columnId: 'todo', agentStatus: 'done' },
      )

      expect(result).toEqual({ columnId: 'todo', agentStatus: 'done' })
    })

    it('PATCH: heartbeat sentinel survives the validator (route swaps it)', () => {
      const result = buildProjectTaskUpdateData({ agentHeartbeatAt: true })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.agentHeartbeatAt).toBe('__server_timestamp__')
    })

    it('PATCH: preserves spec/task linkage fields inside agentInput.context', () => {
      const result = buildProjectTaskUpdateData({
        agentInput: {
          spec: 'Implement approved spec tasks',
          context: {
            sourceDocumentId: 'spec-1',
            sourceDocumentSectionId: null,
            sourceSpecVersion: '3',
            approvalGateTaskId: 'approval-task-1',
            sourceResearchItemId: 'research-1',
          },
        },
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.agentInput).toEqual({
        spec: 'Implement approved spec tasks',
        context: {
          sourceDocumentId: 'spec-1',
          sourceDocumentSectionId: null,
          sourceSpecVersion: '3',
          approvalGateTaskId: 'approval-task-1',
          sourceResearchItemId: 'research-1',
        },
      })
    })

    it('PATCH: accepts approval gate status transitions', () => {
      const approved = buildProjectTaskUpdateData({ approvalStatus: 'approved' })
      expect(approved.ok).toBe(true)
      if (!approved.ok) return
      expect(approved.value.approvalStatus).toBe('approved')

      const rejected = buildProjectTaskUpdateData({ approvalStatus: 'rejected' })
      expect(rejected.ok).toBe(true)
      if (!rejected.ok) return
      expect(rejected.value.approvalStatus).toBe('rejected')

      const invalid = buildProjectTaskUpdateData({ approvalStatus: 'later' })
      expect(invalid.ok).toBe(false)
      if (invalid.ok) return
      expect(invalid.error).toContain('Invalid approvalStatus')
    })
  })
})
