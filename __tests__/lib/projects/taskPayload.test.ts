import {
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
    })
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
              otherContext: { keep: true },
            },
          },
          dependsOn: ['task-abc'],
          reviewerIds: ['reviewer-1'],
          reviewerAgentId: 'sage',
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
        reviewerAgentId: 'sage',
      }))
      expect(result.value.agentInput).toEqual({
        spec: 'Build a /pricing page using the existing design system',
        context: {
          sourceDocumentId: 'doc-123',
          sourceDocumentSectionId: 'section-2',
          sourceSpecVersion: 'v4',
          approvalGateTaskId: 'gate-1',
          otherContext: { keep: true },
        },
      })
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
  })
})
