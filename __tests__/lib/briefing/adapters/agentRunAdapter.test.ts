jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

import { agentRunAdapter } from '@/lib/briefing/adapters/agentRunAdapter'

// Freshness rules derive age from Date.now(), so pin the clock (same pattern as feed.test.ts).
const NOW = new Date('2026-06-17T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString()

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'queueMicrotask'] })
})

afterAll(() => {
  jest.useRealTimers()
})

const baseRun = {
  orgId: 'org-1',
  profile: 'maya-main',
  hermesRunId: 'run-1',
  requestedBy: 'user:peet',
  prompt: 'Polish the content draft',
}

describe('agentRunAdapter.shouldGenerate freshness rules', () => {
  describe('completed runs', () => {
    it('emits a run completed within the last 24 hours', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'completed', completedAt: hoursAgo(2), updatedAt: hoursAgo(2) }, 'run-1')).toBe(true)
    })

    it('does not emit a run completed 25 hours ago', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'completed', completedAt: hoursAgo(25), updatedAt: hoursAgo(25) }, 'run-1')).toBe(false)
    })

    it('prefers completedAt over updatedAt when judging completed-run age', () => {
      // Touched recently but actually finished long ago → stale.
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'completed', completedAt: hoursAgo(72), updatedAt: hoursAgo(1) }, 'run-1')).toBe(false)
    })

    it('falls back to updatedAt when completedAt is missing', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'succeeded', updatedAt: hoursAgo(3) }, 'run-1')).toBe(true)
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'succeeded', updatedAt: hoursAgo(30) }, 'run-1')).toBe(false)
    })

    it('does not emit a completed run with no usable timestamp', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'completed' }, 'run-1')).toBe(false)
    })

    it('keeps completed runs at fyi priority', () => {
      expect(agentRunAdapter.extractPriority({ ...baseRun, status: 'completed', completedAt: hoursAgo(1) }, 'run-1')).toBe('fyi')
    })
  })

  describe('running / queued / pending runs', () => {
    it('emits a running run touched within the last 48 hours', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'running', updatedAt: hoursAgo(40) }, 'run-1')).toBe(true)
    })

    it('does not emit a running run that has gone stale (no update for 49 hours)', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'running', createdAt: hoursAgo(80), updatedAt: hoursAgo(49) }, 'run-1')).toBe(false)
    })

    it('falls back to createdAt for a running run with no updatedAt', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'queued', createdAt: hoursAgo(5) }, 'run-1')).toBe(true)
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'pending', createdAt: hoursAgo(60) }, 'run-1')).toBe(false)
    })

    it('does not emit a running run with no usable timestamp', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'in_progress' }, 'run-1')).toBe(false)
    })

    it('keeps fresh running runs at progress priority', () => {
      expect(agentRunAdapter.extractPriority({ ...baseRun, status: 'running', updatedAt: hoursAgo(1) }, 'run-1')).toBe('progress')
    })
  })

  describe('failed and approval-paused runs are kept regardless of age', () => {
    it('emits a failed run from weeks ago at review priority', () => {
      const doc = { ...baseRun, status: 'failed', error: 'Tool crashed', updatedAt: hoursAgo(24 * 30) }
      expect(agentRunAdapter.shouldGenerate(doc, 'run-1')).toBe(true)
      expect(agentRunAdapter.extractPriority(doc, 'run-1')).toBe('review')
    })

    it('emits a cancelled run with no timestamps at all', () => {
      expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'cancelled' }, 'run-1')).toBe(true)
    })

    it('emits a waiting-for-approval run from weeks ago at needs-peet priority', () => {
      const doc = {
        ...baseRun,
        status: 'waiting_for_approval',
        approval: { toolName: 'shell.exec', reason: 'Needs deployment logs' },
        createdAt: hoursAgo(24 * 20),
        updatedAt: hoursAgo(24 * 20),
      }
      expect(agentRunAdapter.shouldGenerate(doc, 'run-1')).toBe(true)
      expect(agentRunAdapter.extractPriority(doc, 'run-1')).toBe('needs-peet')
    })
  })

  it('still ignores unknown statuses', () => {
    expect(agentRunAdapter.shouldGenerate({ ...baseRun, status: 'mystery', updatedAt: hoursAgo(1) }, 'run-1')).toBe(false)
  })

  it('leaves card copy and url unchanged for a fresh completed run', () => {
    const item = agentRunAdapter.toItem({ ...baseRun, status: 'completed', output: 'Updated draft.', completedAt: hoursAgo(1), updatedAt: hoursAgo(1) }, 'run-doc-1')
    expect(item).toMatchObject({
      priority: 'fyi',
      title: 'Maya finished a run',
      summary: 'Maya finished work and left output for review.',
      source: { type: 'agent-run', id: 'run-doc-1', url: '/admin/agents/maya?run=run-1' },
    })
  })
})
