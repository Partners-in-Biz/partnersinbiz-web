jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

import { agentOutputAdapter } from '@/lib/briefing/adapters/agentOutputAdapter'

// Freshness rules derive age from Date.now(), so pin the clock (same pattern as feed.test.ts).
const NOW = new Date('2026-06-17T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'queueMicrotask'] })
})

afterAll(() => {
  jest.useRealTimers()
})

const baseOutput = {
  orgId: 'org-1',
  projectId: 'project-1',
  taskId: 'task-1',
  assigneeAgentId: 'maya',
  summary: 'Drafted and published the newsletter.',
  artifacts: [{ type: 'url', ref: 'https://example.test/newsletter', label: 'Newsletter' }],
}

describe('agentOutputAdapter.shouldGenerate freshness rules', () => {
  it('still requires a summary, completedAt, and an assigned agent', () => {
    expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, summary: '   ', completedAt: daysAgo(1), columnId: 'review', reviewStatus: 'pending' }, 'task-1:agent-output')).toBe(false)
    expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, columnId: 'review', reviewStatus: 'pending' }, 'task-1:agent-output')).toBe(false)
    expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, assigneeAgentId: undefined, completedAt: daysAgo(1), columnId: 'review', reviewStatus: 'pending' }, 'task-1:agent-output')).toBe(false)
  })

  describe('completed / accepted output (fyi)', () => {
    it('emits approved output completed 6 days ago', () => {
      const doc = { ...baseOutput, completedAt: daysAgo(6), columnId: 'done', reviewStatus: 'approved' }
      expect(agentOutputAdapter.extractPriority(doc, 'task-1:agent-output')).toBe('fyi')
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(true)
    })

    it('does not emit approved output completed 8 days ago', () => {
      const doc = { ...baseOutput, completedAt: daysAgo(8), columnId: 'done', reviewStatus: 'approved' }
      expect(agentOutputAdapter.extractPriority(doc, 'task-1:agent-output')).toBe('fyi')
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(false)
    })

    it('does not emit output that landed in the done column 8 days ago without a review status', () => {
      expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, completedAt: daysAgo(8), columnId: 'done' }, 'task-1:agent-output')).toBe(false)
    })

    it('judges age by completedAt, not a later updatedAt touch', () => {
      expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, completedAt: daysAgo(10), updatedAt: daysAgo(1), columnId: 'done', reviewStatus: 'approved' }, 'task-1:agent-output')).toBe(false)
    })

    it('does not emit default-fyi output with an unparseable completedAt', () => {
      expect(agentOutputAdapter.shouldGenerate({ ...baseOutput, completedAt: 'not-a-date', columnId: 'in_progress' }, 'task-1:agent-output')).toBe(false)
    })
  })

  describe('review work is never age-gated', () => {
    it('keeps blocked output from a month ago (critical)', () => {
      const doc = { ...baseOutput, completedAt: daysAgo(30), columnId: 'blocked', blockedReason: 'Deploy gate closed' }
      expect(agentOutputAdapter.extractPriority(doc, 'task-1:agent-output')).toBe('critical')
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(true)
    })

    it('keeps pending-review output from a month ago (review)', () => {
      const doc = { ...baseOutput, completedAt: daysAgo(30), columnId: 'review', reviewStatus: 'pending' }
      expect(agentOutputAdapter.extractPriority(doc, 'task-1:agent-output')).toBe('review')
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(true)
    })

    it('keeps changes-requested output from a month ago (needs-peet)', () => {
      const doc = { ...baseOutput, completedAt: daysAgo(30), columnId: 'in_progress', reviewStatus: 'changes-requested' }
      expect(agentOutputAdapter.extractPriority(doc, 'task-1:agent-output')).toBe('needs-peet')
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(true)
    })

    it('still drops watcher-error blocked output', () => {
      const doc = { ...baseOutput, summary: 'Watcher error: process exited', completedAt: daysAgo(1), columnId: 'blocked', blockedReason: 'Watcher error' }
      expect(agentOutputAdapter.shouldGenerate(doc, 'task-1:agent-output')).toBe(false)
    })
  })

  it('leaves card copy and url unchanged for fresh approved output', () => {
    const item = agentOutputAdapter.toItem({ ...baseOutput, completedAt: daysAgo(1), columnId: 'done', reviewStatus: 'approved' }, 'task-1:agent-output')
    expect(item).toMatchObject({
      priority: 'fyi',
      title: 'Maya work approved',
      summary: 'Drafted and published the newsletter.. Produced 1 artifact',
      source: { type: 'agent-output', id: 'task-1:agent-output' },
      actor: { id: 'agent:maya', name: 'Maya', role: 'ai', type: 'agent' },
    })
  })
})
