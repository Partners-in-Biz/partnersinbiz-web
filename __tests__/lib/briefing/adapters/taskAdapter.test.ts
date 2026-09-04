jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

jest.mock('@/lib/software-build-evidence', () => ({
  getSoftwareBuildEvidenceRows: jest.fn(() => []),
}))

import { taskAdapter } from '@/lib/briefing/adapters/taskAdapter'

// FYI gating derives age from Date.now(), so pin the clock (same pattern as feed.test.ts).
const NOW = new Date('2026-06-17T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString()

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'queueMicrotask'] })
})

afterAll(() => {
  jest.useRealTimers()
})

const baseTask = {
  id: 'task-1',
  orgId: 'org-1',
  projectId: 'project-1',
  title: 'Write the launch post',
}

describe('taskAdapter.shouldGenerate fyi gating', () => {
  it('still skips deleted tasks and backlog tasks', () => {
    expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress', assigneeAgentId: 'maya', deleted: true, updatedAt: hoursAgo(1) }, 'task-1')).toBe(false)
    expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'backlog', assigneeAgentId: 'maya', updatedAt: hoursAgo(1) }, 'task-1')).toBe(false)
  })

  describe('fyi movement (done column, nothing to review)', () => {
    it('emits a recently completed task that has an assigned agent', () => {
      const doc = { ...baseTask, columnId: 'done', agentStatus: 'done', assigneeAgentId: 'maya', updatedAt: hoursAgo(2) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('fyi')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('emits a recently completed task that has a due date but no agent', () => {
      const doc = { ...baseTask, columnId: 'done', updatedAt: hoursAgo(2), dueDate: '2026-06-20T00:00:00.000Z' }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('fyi')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('does not emit a recently completed task with neither agent nor due date', () => {
      const doc = { ...baseTask, columnId: 'done', updatedAt: hoursAgo(2) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('fyi')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('does not emit an agent-owned completed task that was last touched 25 hours ago', () => {
      const doc = { ...baseTask, columnId: 'done', agentStatus: 'done', assigneeAgentId: 'maya', updatedAt: hoursAgo(25) }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('treats an empty assigneeAgentId as no agent', () => {
      const doc = { ...baseTask, columnId: 'done', assigneeAgentId: '  ', updatedAt: hoursAgo(1) }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('falls back to createdAt when updatedAt is missing', () => {
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'done', assigneeAgentId: 'maya', createdAt: hoursAgo(3) }, 'task-1')).toBe(true)
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'done', assigneeAgentId: 'maya', createdAt: hoursAgo(30) }, 'task-1')).toBe(false)
    })

    it('does not emit fyi movement with no usable timestamp', () => {
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'done', assigneeAgentId: 'maya' }, 'task-1')).toBe(false)
    })
  })

  describe('human progress work (in_progress / todo column, no agent)', () => {
    const daysAgo = (days: number) => hoursAgo(days * 24)

    it('emits a human in-progress task touched 3 days ago', () => {
      const doc = { ...baseTask, columnId: 'in_progress', assigneeId: 'user-1', updatedAt: daysAgo(3) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('progress')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('emits a human in-progress task touched exactly 7 days ago (boundary is inclusive)', () => {
      const doc = { ...baseTask, columnId: 'in_progress', updatedAt: daysAgo(7) }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('does not emit a human in-progress task with no agent or due date untouched for 3 weeks', () => {
      const doc = { ...baseTask, columnId: 'in_progress', assigneeId: 'user-1', updatedAt: daysAgo(21) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('progress')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('does not emit a human todo task untouched for 8 days', () => {
      const doc = { ...baseTask, columnId: 'todo', updatedAt: daysAgo(8) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('progress')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('keeps a stale human in-progress task that carries a due date', () => {
      const doc = { ...baseTask, columnId: 'in_progress', updatedAt: daysAgo(21), dueDate: '2026-06-20T00:00:00.000Z' }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps a stale in-progress task with an assigned agent', () => {
      const doc = { ...baseTask, columnId: 'in_progress', assigneeAgentId: 'maya', updatedAt: daysAgo(21) }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('never drops a task whose agent is actively working, even with no agent id or timestamp', () => {
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress', agentStatus: 'in-progress', updatedAt: daysAgo(30) }, 'task-1')).toBe(true)
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress', agentStatus: 'running' }, 'task-1')).toBe(true)
    })

    it('treats an empty assigneeAgentId as no agent for a stale progress task', () => {
      const doc = { ...baseTask, columnId: 'in_progress', assigneeAgentId: '  ', updatedAt: daysAgo(21) }
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(false)
    })

    it('falls back to createdAt when updatedAt is missing', () => {
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress', createdAt: daysAgo(2) }, 'task-1')).toBe(true)
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress', createdAt: daysAgo(20) }, 'task-1')).toBe(false)
    })

    it('does not emit an unowned progress task with no usable timestamp', () => {
      expect(taskAdapter.shouldGenerate({ ...baseTask, columnId: 'in_progress' }, 'task-1')).toBe(false)
    })

    it('still keeps a stale awaiting-input task in the same column (needs-peet is not gated)', () => {
      const doc = { ...baseTask, columnId: 'in_progress', agentStatus: 'awaiting-input', updatedAt: daysAgo(21) }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('needs-peet')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })
  })

  describe('real work is never age-gated', () => {
    const oldTimestamp = hoursAgo(24 * 20)

    it('keeps awaiting-input tasks (needs-peet)', () => {
      const doc = { ...baseTask, columnId: 'todo', agentStatus: 'awaiting-input', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('needs-peet')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps tasks with a pending approval gate (needs-peet)', () => {
      const doc = { ...baseTask, columnId: 'review', requiresApproval: true, approvalStatus: 'pending', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('needs-peet')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps human-blocked tasks (critical)', () => {
      const doc = { ...baseTask, columnId: 'blocked', agentStatus: 'blocked', blockedReason: 'Waiting for client approval', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('critical')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps agent-blocked tasks (review)', () => {
      const doc = { ...baseTask, columnId: 'blocked', agentStatus: 'blocked', assigneeAgentId: 'theo', blockedReason: 'Lint failed', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('review')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps completed agent work pending review (review)', () => {
      const doc = { ...baseTask, columnId: 'review', agentStatus: 'done', reviewStatus: 'pending', assigneeAgentId: 'pip', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('review')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps in-progress agent work (progress, agent actively running)', () => {
      const doc = { ...baseTask, columnId: 'in_progress', agentStatus: 'in-progress', assigneeAgentId: 'maya', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('progress')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })

    it('keeps urgent tasks (client-risk)', () => {
      const doc = { ...baseTask, columnId: 'done', priority: 'urgent', updatedAt: oldTimestamp }
      expect(taskAdapter.extractPriority(doc, 'task-1')).toBe('client-risk')
      expect(taskAdapter.shouldGenerate(doc, 'task-1')).toBe(true)
    })
  })

  it('leaves card copy and url unchanged for a fresh agent-owned completed task', () => {
    const item = taskAdapter.toItem({
      ...baseTask,
      columnId: 'done',
      agentStatus: 'done',
      assigneeAgentId: 'maya',
      agentOutput: { summary: 'Published the post.' },
      updatedAt: hoursAgo(1),
    }, 'task-1')
    expect(item).toMatchObject({
      priority: 'fyi',
      title: 'Completed: Write the launch post',
      summary: 'Maya is done. Result: Published the post.',
      source: { type: 'task', id: 'task-1', collectionPath: 'projects/project-1/tasks' },
      actor: { id: 'agent:maya', name: 'Maya', role: 'ai', type: 'agent' },
    })
  })
})
